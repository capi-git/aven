import { modelsFor } from "../models";
import {
  killChild,
  prepareCodexStorage,
  resolveCodexBinary,
  spawnChild,
  unwatchChild,
  watchChild,
} from "./child";
import {
  asRecord,
  buildThreadStartParams,
  buildTurnStartParams,
  stringField,
} from "./codexProtocol";
import { JsonRpcClient, type JsonRpcId } from "./jsonRpc";
import { assertCodexStorage } from "./codexStorage";
import { mergeStream, streamTextDelta } from "./streamText";

const INIT_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 45_000;
const TEXT_RUNTIME_MODE = "supervised" as const;
const TEXT_MODEL = "gpt-5.6-luna";
const TEXT_EFFORT = "low";

/**
 * Configuration for a text-only thread (the memory keeper): no shell, no web
 * search and no connected apps. The thread is read-only and every approval is
 * declined as well, so nothing it is asked can act on the Mac.
 */
export const CODEX_TEXT_ONLY_CONFIG: Readonly<Record<string, unknown>> = {
  "features.shell_tool": false,
  "features.apps": false,
  "features.browser_use": false,
  "features.computer_use": false,
  web_search: "disabled",
};

type LiveText = {
  rpc: JsonRpcClient;
  cwd: string;
  /** Started with `CODEX_TEXT_ONLY_CONFIG`. */
  textOnly: boolean;
  threadId: string;
  model: string;
  effort: string;
  collecting: boolean;
  output: string;
  closed: boolean;
  turnDone: (() => void) | null;
  turnFailed: ((error: Error) => void) | null;
};

/** One helper process and the queue of prompts waiting for it. */
type Lane = {
  childId: string;
  live: LiveText | null;
  turns: Promise<void>;
};

const TEXT_LANE: Lane = {
  childId: "aven-codex-text",
  live: null,
  turns: Promise.resolve(),
};
/**
 * Text-only calls run in a process of their own, so a long one (the memory
 * keeper reading a project) never holds up a title or a commit message.
 */
const TEXT_ONLY_LANE: Lane = {
  childId: "aven-codex-text-only",
  live: null,
  turns: Promise.resolve(),
};

function enqueue<T>(lane: Lane, work: () => Promise<T>): Promise<T> {
  const run = lane.turns.catch(() => undefined).then(work);
  lane.turns = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function pickTextModel(): string {
  return codexTextModel().id;
}

/** The small model background text uses, and its name for the interface. */
export function codexTextModel(): { id: string; name: string } {
  const models = modelsFor("codex");
  const luna = models.find((model) =>
    /5\.6-luna/i.test(`${model.nativeId ?? ""} ${model.name} ${model.id}`),
  );
  return luna?.nativeId
    ? { id: luna.nativeId, name: luna.name }
    : { id: TEXT_MODEL, name: "GPT-5.6 Luna" };
}

function pickTextEffort(modelId: string): string {
  const model = modelsFor("codex").find((entry) => entry.nativeId === modelId);
  const setting = model?.settings?.find(
    (entry) => entry.id === "reasoningEffort",
  );
  const options = setting?.options?.map((option) => option.value) ?? [];
  if (options.includes("low")) return "low";
  if (options.includes("none")) return "none";
  if (setting?.value && options.includes(setting.value)) return setting.value;
  return TEXT_EFFORT;
}

export async function stopCodexTextPrompt(): Promise<void> {
  await Promise.all([dropLive(TEXT_LANE), dropLive(TEXT_ONLY_LANE)]);
}

/** Start the shared Codex app-server in the background so the first prompt is fast. */
export function warmupCodexText(cwd: string): Promise<void> {
  if (!cwd || cwd === "~") return Promise.resolve();
  return enqueue(TEXT_LANE, async () => {
    await ensureLive(TEXT_LANE, cwd);
  }).catch(() => undefined);
}

/** Codex app-server turn that reuses a warm process, like Cursor text generation. */
export async function runCodexTextPrompt(input: {
  cwd: string;
  prompt: string;
  timeoutMs?: number;
  /** A thread with no shell, web search or apps; see `CODEX_TEXT_ONLY_CONFIG`. */
  textOnly?: boolean;
}): Promise<string> {
  const lane = input.textOnly ? TEXT_ONLY_LANE : TEXT_LANE;
  return enqueue(lane, () => promptOnLive(lane, input));
}

async function promptOnLive(
  lane: Lane,
  input: {
    cwd: string;
    prompt: string;
    timeoutMs?: number;
    textOnly?: boolean;
  },
): Promise<string> {
  const session = await ensureLive(lane, input.cwd, !!input.textOnly);
  session.output = "";
  session.collecting = true;
  const timeoutMs = input.timeoutMs ?? REQUEST_TIMEOUT_MS;

  try {
    const turnPromise = new Promise<void>((resolve, reject) => {
      session.turnDone = resolve;
      session.turnFailed = reject;
    });

    await session.rpc.request(
      "turn/start",
      buildTurnStartParams({
        threadId: session.threadId,
        runtimeMode: TEXT_RUNTIME_MODE,
        prompt: input.prompt,
        model: session.model || undefined,
        effort: session.effort,
      }),
      timeoutMs,
    );

    await Promise.race([
      turnPromise,
      new Promise<void>((_, reject) => {
        setTimeout(
          () => reject(new Error("Codex text generation timed out")),
          timeoutMs,
        );
      }),
    ]);

    return session.output;
  } catch (error) {
    await session.rpc
      .request("turn/interrupt", { threadId: session.threadId })
      .catch(() => undefined);
    if (session.closed) await dropLive(lane);
    throw error;
  } finally {
    session.collecting = false;
    session.turnDone = null;
    session.turnFailed = null;
    await dropLive(lane);
  }
}

async function ensureLive(
  lane: Lane,
  cwd: string,
  textOnly = false,
): Promise<LiveText> {
  const model = pickTextModel();
  const effort = pickTextEffort(model);
  const live = lane.live;
  if (live && !live.closed) {
    if (
      live.cwd === cwd &&
      live.model === model &&
      live.effort === effort &&
      live.textOnly === textOnly
    ) {
      return live;
    }
    try {
      live.model = model;
      live.effort = effort;
      live.textOnly = textOnly;
      await openThread(live, cwd);
      return live;
    } catch {
      await dropLive(lane);
    }
  }
  return startLive(lane, cwd, textOnly);
}

async function startLive(
  lane: Lane,
  cwd: string,
  textOnly = false,
): Promise<LiveText> {
  await dropLive(lane);
  const storage = await prepareCodexStorage();
  const { path } = await resolveCodexBinary();
  const sessionRef: { session: LiveText | null } = { session: null };
  const rpc = new JsonRpcClient(
    lane.childId,
    {
      onNotification: (method, params) => {
        handleNotification(sessionRef.session, method, params);
      },
      onRequest: (id, method, params) => {
        void handleServerRequest(rpc, id, method, params);
      },
    },
    { includeJsonrpc: false, label: "codex-text" },
  );

  const model = pickTextModel();
  const session: LiveText = {
    rpc,
    cwd,
    textOnly,
    threadId: "",
    model,
    effort: pickTextEffort(model),
    collecting: false,
    output: "",
    closed: false,
    turnDone: null,
    turnFailed: null,
  };
  sessionRef.session = session;

  watchChild(
    lane.childId,
    (line) => rpc.pushLine(line),
    () => {
      session.closed = true;
      if (lane.live === session) lane.live = null;
      session.turnFailed?.(new Error("Codex text generator exited"));
      session.turnDone = null;
      session.turnFailed = null;
      rpc.close(new Error("Codex text generator exited"));
    },
  );

  try {
    await spawnChild(lane.childId, path, ["app-server"], cwd);
    await rpc.request(
      "initialize",
      {
        clientInfo: {
          name: "aven-text",
          title: "Aven",
          version: "0.1.0",
        },
        capabilities: { experimentalApi: true },
      },
      INIT_TIMEOUT_MS,
    );
    await rpc.notify("initialized", undefined);
    assertCodexStorage(
      await rpc.request(
        "config/read",
        { cwd, includeLayers: false },
        INIT_TIMEOUT_MS,
      ),
      storage.home,
    );
    await openThread(session, cwd);
    lane.live = session;
    return session;
  } catch (error) {
    session.closed = true;
    rpc.close(error instanceof Error ? error : new Error(String(error)));
    unwatchChild(lane.childId);
    await killChild(lane.childId).catch(() => undefined);
    throw error;
  }
}

async function openThread(session: LiveText, cwd: string): Promise<void> {
  // Titles, commit messages, branch names and PR text are throwaway turns.
  // An ephemeral thread keeps them out of the user's saved Codex history.
  const opened = await session.rpc.request<{ thread?: { id?: string } }>(
    "thread/start",
    {
      ...buildThreadStartParams({
        cwd,
        runtimeMode: TEXT_RUNTIME_MODE,
        model: session.model || undefined,
      }),
      ephemeral: true,
      ...(session.textOnly ? { config: { ...CODEX_TEXT_ONLY_CONFIG } } : {}),
    },
    INIT_TIMEOUT_MS,
  );
  const threadId = opened.thread?.id?.trim();
  if (!threadId) throw new Error("Codex did not return a thread id");
  session.cwd = cwd;
  session.threadId = threadId;
}

async function dropLive(lane: Lane): Promise<void> {
  const current = lane.live;
  lane.live = null;
  if (current) {
    current.closed = true;
    current.rpc.close();
  }
  unwatchChild(lane.childId);
  await killChild(lane.childId).catch(() => undefined);
}

function handleNotification(
  session: LiveText | null,
  method: string,
  params: unknown,
): void {
  if (!session || !session.collecting) {
    if (session && method === "turn/completed") {
      session.turnDone?.();
      session.turnDone = null;
      session.turnFailed = null;
    }
    return;
  }

  if (method === "item/agentMessage/delta") {
    const delta = streamTextDelta(asRecord(params)?.delta);
    if (delta) session.output = mergeStream(session.output, delta);
    return;
  }

  if (method === "turn/completed") {
    const turn = asRecord(asRecord(params)?.turn);
    const status = stringField(turn, "status") ?? "completed";
    if (status === "failed") {
      const message =
        stringField(asRecord(turn?.error), "message") ?? "Codex turn failed";
      session.turnFailed?.(new Error(message));
    } else {
      session.turnDone?.();
    }
    session.turnDone = null;
    session.turnFailed = null;
  }
}

async function handleServerRequest(
  rpc: JsonRpcClient,
  id: JsonRpcId,
  method: string,
  _params: unknown,
): Promise<void> {
  if (
    method === "item/commandExecution/requestApproval" ||
    method === "item/fileChange/requestApproval"
  ) {
    await rpc.respond(id, { decision: "decline" }).catch(() => undefined);
    return;
  }
  if (method === "item/permissions/requestApproval") {
    await rpc.respond(id, { permissions: {} }).catch(() => undefined);
    return;
  }
  await rpc.respond(id, {}).catch(() => undefined);
}

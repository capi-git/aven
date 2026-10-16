import { modelsFor } from "../models";
import {
  killChild,
  resolveClaudeBinary,
  spawnChild,
  unwatchChild,
  watchChild,
  writeChild,
} from "./child";
import {
  assistantTextBlocks,
  buildClaudeSpawnArgs,
  buildClaudeUserMessage,
  parseJsonLine,
  stringField,
  turnStatusFromResult,
} from "./claudeProtocol";
import { mergeStream } from "./streamText";

const INIT_TIMEOUT_MS = 8_000;
const REQUEST_TIMEOUT_MS = 45_000;
const TEXT_MODEL = "claude-haiku-4-5";

/**
 * How a helper process is started. Titles and commit messages use Claude
 * Code's defaults; a `textOnly` call (the memory keeper) replaces the system
 * prompt and offers no tools at all, so it can only answer with text.
 */
export type ClaudeTextProfile = {
  systemPrompt?: string;
  textOnly?: boolean;
};

type LiveText = {
  cwd: string;
  /** The profile this process was started with, as a comparable key. */
  profile: string;
  collecting: boolean;
  output: string;
  closed: boolean;
  ready: boolean;
  turnDone: (() => void) | null;
  turnFailed: ((error: Error) => void) | null;
  readyDone: (() => void) | null;
};

/** One helper process and the queue of prompts waiting for it. */
type Lane = {
  childId: string;
  live: LiveText | null;
  turns: Promise<void>;
};

const TEXT_LANE: Lane = {
  childId: "aven-claude-text",
  live: null,
  turns: Promise.resolve(),
};
/**
 * Text-only calls run in a process of their own, so a long one (the memory
 * keeper reading a project) never holds up a title or a commit message.
 */
const TEXT_ONLY_LANE: Lane = {
  childId: "aven-claude-text-only",
  live: null,
  turns: Promise.resolve(),
};

function laneFor(profile: ClaudeTextProfile | undefined): Lane {
  return profile?.textOnly ? TEXT_ONLY_LANE : TEXT_LANE;
}

function pickTextModel(): string {
  return claudeTextModel().id;
}

/** The small model background text uses, and its name for the interface. */
export function claudeTextModel(): { id: string; name: string } {
  const models = modelsFor("claude");
  const haiku = models.find((model) =>
    /haiku/i.test(`${model.nativeId ?? ""} ${model.name} ${model.id}`),
  );
  return haiku?.nativeId
    ? { id: haiku.nativeId, name: haiku.name }
    : { id: TEXT_MODEL, name: "Haiku 4.5" };
}

function profileKey(profile: ClaudeTextProfile | undefined): string {
  if (!profile?.systemPrompt && !profile?.textOnly) return "";
  return JSON.stringify([profile.systemPrompt ?? "", !!profile.textOnly]);
}

export async function stopClaudeTextPrompt(): Promise<void> {
  await Promise.all([dropLive(TEXT_LANE), dropLive(TEXT_ONLY_LANE)]);
}

function enqueue<T>(lane: Lane, work: () => Promise<T>): Promise<T> {
  const run = lane.turns.catch(() => undefined).then(work);
  lane.turns = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function warmupClaudeText(cwd: string): Promise<void> {
  if (!cwd || cwd === "~") return Promise.resolve();
  return enqueue(TEXT_LANE, async () => {
    await ensureLive(TEXT_LANE, cwd);
  }).catch(() => undefined);
}

export async function runClaudeTextPrompt(input: {
  cwd: string;
  prompt: string;
  timeoutMs?: number;
  profile?: ClaudeTextProfile;
}): Promise<string> {
  const lane = laneFor(input.profile);
  return enqueue(lane, () => promptOnLive(lane, input));
}

async function promptOnLive(
  lane: Lane,
  input: {
    cwd: string;
    prompt: string;
    timeoutMs?: number;
    profile?: ClaudeTextProfile;
  },
): Promise<string> {
  const session = await ensureLive(lane, input.cwd, input.profile);
  session.output = "";
  session.collecting = true;
  const timeoutMs = input.timeoutMs ?? REQUEST_TIMEOUT_MS;

  try {
    const turnPromise = new Promise<void>((resolve, reject) => {
      session.turnDone = resolve;
      session.turnFailed = reject;
    });

    await writeChild(
      lane.childId,
      JSON.stringify(buildClaudeUserMessage({ text: input.prompt })),
    );

    await Promise.race([
      turnPromise,
      new Promise<void>((_, reject) => {
        setTimeout(
          () => reject(new Error("Claude text generation timed out")),
          timeoutMs,
        );
      }),
    ]);

    const output = session.output.trim();
    if (!output) throw new Error("Claude returned empty output.");
    return output;
  } catch (error) {
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
  profile?: ClaudeTextProfile,
): Promise<LiveText> {
  const live = lane.live;
  if (
    live &&
    !live.closed &&
    live.cwd === cwd &&
    live.profile === profileKey(profile)
  )
    return live;
  await dropLive(lane);
  return startLive(lane, cwd, profile);
}

async function startLive(
  lane: Lane,
  cwd: string,
  profile?: ClaudeTextProfile,
): Promise<LiveText> {
  const { path } = await resolveClaudeBinary();
  const session: LiveText = {
    cwd,
    profile: profileKey(profile),
    collecting: false,
    output: "",
    closed: false,
    ready: false,
    turnDone: null,
    turnFailed: null,
    readyDone: null,
  };

  watchChild(
    lane.childId,
    (line) => handleLine(session, line),
    () => {
      session.closed = true;
      if (lane.live === session) lane.live = null;
      session.turnFailed?.(new Error("Claude text generator exited"));
      session.readyDone?.();
      session.turnDone = null;
      session.turnFailed = null;
      session.readyDone = null;
    },
  );

  try {
    await spawnChild(
      lane.childId,
      path,
      buildClaudeSpawnArgs({
        isolated: true,
        model: pickTextModel(),
        ...(profile?.systemPrompt
          ? { systemPrompt: profile.systemPrompt }
          : {}),
        ...(profile?.textOnly ? { tools: [] } : {}),
      }),
      cwd,
    );
    lane.live = session;
    await waitForReady(session, INIT_TIMEOUT_MS);
    return session;
  } catch (error) {
    session.closed = true;
    unwatchChild(lane.childId);
    await killChild(lane.childId).catch(() => undefined);
    throw error;
  }
}

async function dropLive(lane: Lane): Promise<void> {
  const current = lane.live;
  lane.live = null;
  if (current) {
    current.closed = true;
    current.readyDone?.();
    current.turnFailed?.(new Error("Claude text generator stopped"));
    current.turnDone = null;
    current.turnFailed = null;
    current.readyDone = null;
  }
  unwatchChild(lane.childId);
  await killChild(lane.childId).catch(() => undefined);
}

function handleLine(session: LiveText, line: string): void {
  const rec = parseJsonLine(line);
  if (!rec) return;
  const type = stringField(rec, "type");
  if (
    type === "system" &&
    (stringField(rec, "subtype") === "init" ||
      stringField(rec, "subtype") === "initialized")
  ) {
    session.ready = true;
    session.readyDone?.();
    session.readyDone = null;
  }
  if (!session.collecting) return;
  if (type === "assistant") {
    const snapshot = assistantTextBlocks(rec).join("");
    if (snapshot) session.output = mergeStream(session.output, snapshot);
    return;
  }
  if (type === "stream_event") {
    const event = rec.event;
    if (!event || typeof event !== "object") return;
    const delta = (event as { delta?: { type?: string; text?: string } }).delta;
    if (delta?.type === "text_delta" && typeof delta.text === "string") {
      session.output = mergeStream(session.output, delta.text);
    }
    return;
  }
  if (type === "result") {
    const result = turnStatusFromResult(rec);
    if (result.status === "failed") {
      session.turnFailed?.(new Error(result.error ?? "Claude turn failed"));
    } else {
      session.turnDone?.();
    }
    session.turnDone = null;
    session.turnFailed = null;
  }
}

function waitForReady(session: LiveText, timeoutMs: number): Promise<void> {
  if (session.ready) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      session.readyDone = null;
      resolve();
    }, timeoutMs);
    session.readyDone = () => {
      clearTimeout(timer);
      if (session.closed) {
        reject(new Error("Claude text generator exited"));
        return;
      }
      resolve();
    };
  });
}

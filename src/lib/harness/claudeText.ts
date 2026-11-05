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
  /**
   * Someone is waiting for the answer ("Tidy into a brief"): no extended
   * thinking, which costs Haiku 15 seconds or more before its first word,
   * and a process of its own so background text never holds it up.
   */
  quick?: boolean;
};

type LiveText = {
  cwd: string;
  /** The profile this process was started with, as a comparable key. */
  profile: string;
  collecting: boolean;
  output: string;
  /** Called with everything written so far, while a turn is collected. */
  onText: ((text: string) => void) | null;
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

/** A quick call's process: nothing else queues ahead of it. */
const QUICK_LANE: Lane = {
  childId: "aven-claude-text-quick",
  live: null,
  turns: Promise.resolve(),
};

function laneFor(profile: ClaudeTextProfile | undefined): Lane {
  if (profile?.quick) return QUICK_LANE;
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
  if (!profile?.systemPrompt && !profile?.textOnly && !profile?.quick)
    return "";
  return JSON.stringify([
    profile.systemPrompt ?? "",
    !!profile.textOnly,
    !!profile.quick,
  ]);
}

export async function stopClaudeTextPrompt(): Promise<void> {
  await Promise.all([
    dropLive(TEXT_LANE),
    dropLive(TEXT_ONLY_LANE),
    dropLive(QUICK_LANE),
  ]);
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
  /** Everything written so far, as it streams in. */
  onText?: (text: string) => void;
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
    onText?: (text: string) => void;
  },
): Promise<string> {
  const session = await ensureLive(lane, input.cwd, input.profile);
  session.output = "";
  session.onText = input.onText ?? null;
  session.collecting = true;
  const timeoutMs = input.timeoutMs ?? REQUEST_TIMEOUT_MS;

  try {
    const turnPromise = new Promise<void>((resolve, reject) => {
      session.turnDone = resolve;
      session.turnFailed = reject;
    });
    // It quit before reading the prompt (a bad binary, a refused sign-in).
    if (session.closed) throw new Error("Claude text generator exited");

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
    session.onText = null;
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
    onText: null,
    closed: false,
    turnDone: null,
    turnFailed: null,
  };

  watchChild(
    lane.childId,
    (line) => handleLine(session, line),
    () => {
      session.closed = true;
      if (lane.live === session) lane.live = null;
      session.turnFailed?.(new Error("Claude text generator exited"));
      session.turnDone = null;
      session.turnFailed = null;
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
        ...(profile?.quick
          ? { settings: { alwaysThinkingEnabled: false } }
          : {}),
      }),
      cwd,
    );
    lane.live = session;
    // Claude Code reports init only once it has read the first message, so
    // waiting for it here only ever ran out the clock. The prompt waits in
    // the pipe until Claude reads it; an early exit fails the turn.
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
    current.turnFailed?.(new Error("Claude text generator stopped"));
    current.turnDone = null;
    current.turnFailed = null;
  }
  unwatchChild(lane.childId);
  await killChild(lane.childId).catch(() => undefined);
}

function handleLine(session: LiveText, line: string): void {
  const rec = parseJsonLine(line);
  if (!rec) return;
  const type = stringField(rec, "type");
  if (!session.collecting) return;
  const before = session.output;
  collectText(session, type, rec);
  if (session.output !== before) session.onText?.(session.output);
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

function collectText(
  session: LiveText,
  type: string | undefined,
  rec: Record<string, unknown>,
): void {
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
  }
}

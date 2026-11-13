import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { logError } from "../errors";
import { sessionPermissions } from "./sessionPermissions";

type LinePayload = { sessionId: string; line: string };
type StdoutPayload = { sessionId: string; lines: string[] } | LinePayload;
type ExitPayload = { sessionId: string; code: number | null; pid?: number };
type SsePayload = { sessionId: string; events: string[] };
type SseEndPayload = { sessionId: string; error?: string | null };

type LineHandler = (line: string) => void;
type ExitHandler = (code: number | null) => void;
type SseHandler = (data: string) => void;
type SseEndHandler = (error?: string) => void;

const lineHandlers = new Map<string, LineHandler>();
const exitHandlers = new Map<string, ExitHandler>();
const lineBuffer = new Map<string, string[]>();
const stderrHandlers = new Map<string, LineHandler>();
const sseHandlers = new Map<string, SseHandler>();
const sseEndHandlers = new Map<string, SseEndHandler>();
const sseBuffer = new Map<string, string[]>();
// Native stdout is owner-targeted. Only ids this window spawned or opened
// may buffer while unwatched; anything else would be held until the bridge is
// torn down, and a later watch of the same id would replay stale lines.
const ownedChildren = new Set<string>();
const ownedSse = new Set<string>();
const livePid = new Map<string, number>();
const pendingExit = new Map<
  string,
  Array<{ code: number | null; pid: number }>
>();

/** True when this exit belongs to the child we currently have spawned. */
export function isCurrentChildExit(
  expectedPid: number | undefined,
  exitedPid: number | undefined,
): boolean {
  if (expectedPid == null || expectedPid <= 0) return false;
  if (exitedPid == null || exitedPid <= 0) return false;
  return exitedPid === expectedPid;
}

const MAX_BUFFERED = 1000;
// The first records carry the protocol handshake (init, session id). When an
// unwatched session overflows, trim from the middle so a late watcher can
// still bind to the session.
const KEEP_FIRST_BUFFERED = 50;
const trimmedSessions = new Set<string>();
// One native write per child at a time, in call order. Each `harness_write`
// runs on its own native thread, so back-to-back writes could otherwise land
// out of order (e.g. a permission answer after the next message).
const writeQueues = new Map<string, Promise<void>>();
let bridge: Promise<UnlistenFn[]> | null = null;
let bridgeAttempt: symbol | null = null;
let users = 0;
let teardownTimer: ReturnType<typeof setTimeout> | undefined;

function pushBounded(
  map: Map<string, string[]>,
  sessionId: string,
  item: string,
) {
  const queued = map.get(sessionId) ?? [];
  queued.push(item);
  if (queued.length > MAX_BUFFERED) {
    queued.splice(KEEP_FIRST_BUFFERED, queued.length - MAX_BUFFERED);
    const key = `${map === sseBuffer ? "sse" : "stdout"}:${sessionId}`;
    if (!trimmedSessions.has(key)) {
      trimmedSessions.add(key);
      logError(
        "Agent output buffer",
        `dropped older ${map === sseBuffer ? "events" : "lines"} for ${sessionId} while nothing was watching it (kept the first ${KEEP_FIRST_BUFFERED} and last ${MAX_BUFFERED - KEEP_FIRST_BUFFERED})`,
      );
    }
  }
  map.set(sessionId, queued);
}

function ensureBridge() {
  if (bridge) return;
  // Tauri evaluates an event in every webview that subscribed to its name,
  // even when emit_to filters its listener IDs. Separate owner event names
  // avoid parsing another window's stream at all.
  const owner = getCurrentWebview().label;
  const outputOptions = { target: { kind: "Webview" as const, label: owner } };
  let failed = false;
  const installed: UnlistenFn[] = [];
  const register = (pending: Promise<UnlistenFn>) =>
    pending.then((unlisten) => {
      if (failed) {
        unlisten();
        return () => undefined;
      }
      installed.push(unlisten);
      return unlisten;
    });
  const attempt = Symbol("bridge-installation");
  bridgeAttempt = attempt;
  const installation = Promise.all([
    register(
      listen<StdoutPayload>(
        `harness-stdout:${owner}`,
        (event) => {
          const { sessionId } = event.payload;
          // Keep line boundaries for every provider protocol, including blanks.
          // Single-line payloads remain accepted by the line-oriented bridge.
          const lines =
            "lines" in event.payload
              ? event.payload.lines
              : [event.payload.line];
          let failed = false;
          let firstError: unknown;
          for (const line of lines) {
            try {
              const handler = lineHandlers.get(sessionId);
              if (handler) handler(line);
              else if (ownedChildren.has(sessionId))
                pushBounded(lineBuffer, sessionId, line);
            } catch (error) {
              // Separate native events used to continue after one callback
              // failed. Keep later protocol records (especially final results).
              if (!failed) firstError = error;
              failed = true;
            }
          }
          if (failed) throw firstError;
        },
        outputOptions,
      ),
    ),
    register(
      listen<LinePayload>(
        `harness-stderr:${owner}`,
        (event) => {
          const { sessionId, line } = event.payload;
          stderrHandlers.get(sessionId)?.(line);
        },
        outputOptions,
      ),
    ),
    register(
      listen<ExitPayload>(
        `harness-exit:${owner}`,
        (event) => {
          const { sessionId, code, pid } = event.payload;
          const handler = exitHandlers.get(sessionId);
          if (!handler || pid == null || pid <= 0) return;
          const currentPid = livePid.get(sessionId);
          if (isCurrentChildExit(currentPid, pid)) {
            livePid.delete(sessionId);
            handler(code);
            return;
          }
          if (currentPid != null) return;
          const exits = pendingExit.get(sessionId) ?? [];
          exits.push({ code, pid });
          if (exits.length > 8) exits.splice(0, exits.length - 8);
          pendingExit.set(sessionId, exits);
        },
        outputOptions,
      ),
    ),
    register(
      listen<SsePayload>(
        `harness-sse:${owner}`,
        (event) => {
          const { sessionId, events } = event.payload;
          let failed = false;
          let firstError: unknown;
          for (const data of events) {
            try {
              // Look up per event: a handler may unwatch mid-batch.
              const handler = sseHandlers.get(sessionId);
              if (handler) handler(data);
              else if (ownedSse.has(sessionId))
                pushBounded(sseBuffer, sessionId, data);
            } catch (error) {
              if (!failed) firstError = error;
              failed = true;
            }
          }
          if (failed) throw firstError;
        },
        outputOptions,
      ),
    ),
    register(
      listen<SseEndPayload>(
        `harness-sse-end:${owner}`,
        (event) => {
          const { sessionId, error } = event.payload;
          sseEndHandlers.get(sessionId)?.(error ?? undefined);
        },
        outputOptions,
      ),
    ),
  ]).catch((error: unknown) => {
    failed = true;
    installed.splice(0).forEach((unlisten) => unlisten());
    if (bridgeAttempt === attempt) {
      bridge = null;
      bridgeAttempt = null;
    }
    throw error;
  });
  void installation.catch(() => undefined);
  bridge = installation;
}

function teardownBridge() {
  const pending = bridge;
  bridge = null;
  bridgeAttempt = null;
  lineHandlers.clear();
  exitHandlers.clear();
  lineBuffer.clear();
  stderrHandlers.clear();
  sseHandlers.clear();
  sseEndHandlers.clear();
  sseBuffer.clear();
  ownedChildren.clear();
  ownedSse.clear();
  livePid.clear();
  pendingExit.clear();
  trimmedSessions.clear();
  void pending?.then((fns) => fns.forEach((fn) => fn())).catch(() => undefined);
}

export function startHarnessBridge(): () => void {
  users += 1;
  if (teardownTimer) {
    clearTimeout(teardownTimer);
    teardownTimer = undefined;
  }
  ensureBridge();
  return () => {
    users -= 1;
    if (users > 0) return;
    users = 0;
    teardownTimer = setTimeout(() => {
      teardownTimer = undefined;
      if (users === 0) teardownBridge();
    }, 0);
  };
}

export async function acquireHarnessBridge(): Promise<() => void> {
  const release = startHarnessBridge();
  const installation = bridge;
  try {
    await installation;
    return release;
  } catch (error) {
    release();
    throw error;
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    users = 0;
    if (teardownTimer) {
      clearTimeout(teardownTimer);
      teardownTimer = undefined;
    }
    teardownBridge();
  });
}

export function watchChild(
  sessionId: string,
  onLine: LineHandler,
  onExit: ExitHandler,
  onStderr?: LineHandler,
) {
  const queued = lineBuffer.get(sessionId);
  lineBuffer.delete(sessionId);
  lineHandlers.set(sessionId, onLine);
  exitHandlers.set(sessionId, onExit);
  if (onStderr) stderrHandlers.set(sessionId, onStderr);
  if (queued) queued.forEach(onLine);
}

export function unwatchChild(sessionId: string) {
  lineHandlers.delete(sessionId);
  exitHandlers.delete(sessionId);
  lineBuffer.delete(sessionId);
  ownedChildren.delete(sessionId);
  stderrHandlers.delete(sessionId);
  pendingExit.delete(sessionId);
  trimmedSessions.delete(`stdout:${sessionId}`);
}

export function watchSse(
  sessionId: string,
  onData: SseHandler,
  onEnd?: SseEndHandler,
) {
  const queued = sseBuffer.get(sessionId);
  sseBuffer.delete(sessionId);
  sseHandlers.set(sessionId, onData);
  if (onEnd) sseEndHandlers.set(sessionId, onEnd);
  if (queued) queued.forEach(onData);
}

export function unwatchSse(sessionId: string) {
  sseHandlers.delete(sessionId);
  sseEndHandlers.delete(sessionId);
  sseBuffer.delete(sessionId);
  ownedSse.delete(sessionId);
  trimmedSessions.delete(`sse:${sessionId}`);
}

export async function spawnChild(
  sessionId: string,
  command: string,
  args: string[],
  cwd: string,
): Promise<void> {
  livePid.delete(sessionId);
  pendingExit.delete(sessionId);
  ownedChildren.add(sessionId);
  // A chat with rules of its own (a bot's or a teammate's) starts with
  // Aven's sandboxed browser, and one that only reads never has Aven save a
  // page for it. Said as the agent starts, before it holds the browser's
  // credential: a later bind from the window can fail or be skipped.
  const permissions = sessionPermissions(sessionId);
  const pid = await invoke<number>("harness_spawn", {
    sessionId,
    command,
    args,
    cwd,
    ...(permissions ? { browserSandboxed: true } : {}),
    ...(permissions?.readOnly ? { browserReadOnly: true } : {}),
  });
  if (typeof pid !== "number" || pid <= 0) return;
  livePid.set(sessionId, pid);
  const exits = pendingExit.get(sessionId);
  pendingExit.delete(sessionId);
  const exited = exits?.find((event) => event.pid === pid);
  if (!exited) return;
  livePid.delete(sessionId);
  exitHandlers.get(sessionId)?.(exited.code);
}

/** Prepare Aven's provider history without changing the shared Codex history. */
export function prepareCodexStorage(threadId?: string): Promise<{
  home: string;
  resumePath?: string;
}> {
  return invoke("harness_prepare_codex_storage", { threadId });
}

export function writeChild(sessionId: string, line: string): Promise<void> {
  const previous = writeQueues.get(sessionId);
  const send = () => invoke<void>("harness_write", { sessionId, line });
  // A failed earlier write is reported to its own caller; later writes still go.
  const write = previous ? previous.then(send, send) : send();
  writeQueues.set(sessionId, write);
  const release = () => {
    if (writeQueues.get(sessionId) === write) writeQueues.delete(sessionId);
  };
  void write.then(release, release);
  return write;
}

export function killChild(sessionId: string): Promise<void> {
  livePid.delete(sessionId);
  pendingExit.delete(sessionId);
  unwatchChild(sessionId);
  return invoke("harness_kill", { sessionId });
}

export function killAllChildren(): Promise<void> {
  lineHandlers.clear();
  exitHandlers.clear();
  lineBuffer.clear();
  stderrHandlers.clear();
  sseHandlers.clear();
  sseEndHandlers.clear();
  sseBuffer.clear();
  ownedChildren.clear();
  ownedSse.clear();
  livePid.clear();
  pendingExit.clear();
  trimmedSessions.clear();
  return invoke("harness_kill_all");
}

export function resolveCursorBinary(): Promise<{ path: string }> {
  return invoke("harness_resolve_cursor");
}

export function resolveCodexBinary(): Promise<{ path: string }> {
  return invoke("harness_resolve_codex");
}

export function resolveOpenCodeBinary(): Promise<{ path: string }> {
  return invoke("harness_resolve_opencode");
}

export function resolveClaudeBinary(): Promise<{ path: string }> {
  return invoke("harness_resolve_claude");
}

export function resolvePiBinary(): Promise<{ path: string }> {
  return invoke("harness_resolve_pi");
}

export function resolveOmpBinary(): Promise<{ path: string }> {
  return invoke("harness_resolve_omp");
}

export function resolveFxBinary(): Promise<{ path: string }> {
  return invoke("harness_resolve_fx");
}

export function resolveGrokBinary(): Promise<{ path: string }> {
  return invoke("harness_resolve_grok");
}

export function freeHarnessPort(): Promise<number> {
  return invoke("harness_free_port");
}

export function harnessHttp(input: {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}): Promise<{ status: number; body: string }> {
  return invoke("harness_http", input);
}

export function openHarnessSse(
  sessionId: string,
  url: string,
  headers?: Record<string, string>,
): Promise<void> {
  ownedSse.add(sessionId);
  return invoke("harness_sse_open", { sessionId, url, headers });
}

export function closeHarnessSse(sessionId: string): Promise<void> {
  unwatchSse(sessionId);
  return invoke("harness_sse_close", { sessionId });
}

export function execChild(
  command: string,
  args: string[],
  cwd?: string,
): Promise<string> {
  return invoke("harness_exec", { command, args, cwd });
}

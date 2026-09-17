import { releaseTerminalScreen } from "./workspaceTransfers";
import { invoke } from "@tauri-apps/api/core";
import { listenerGroup } from "./listenerGroup";
import { listen } from "@tauri-apps/api/event";

type DataPayload = { id: string; data: string };
type ExitPayload = { id: string; code: number | null };

type DataHandler = (data: Uint8Array) => void;
type ExitHandler = (code: number | null) => void;

const dataHandlers = new Map<string, DataHandler>();
const exitHandlers = new Map<string, ExitHandler>();
const dataBuffer = new Map<string, Uint8Array[]>();
const dataBufferBytes = new Map<string, number>();
/** PTYs this window opened. Global `pty-data` still fires for every terminal
 * in the process; decoding those in a window that never mounted them was
 * megabytes of base64 work and a 256KB replay buffer per stranger id. */
const openedPtys = new Set<string>();
// Explicit Run clicks queue one command until this terminal's native PTY exists.
// In-memory only: reopening the application never replays a saved run command.
const initialCommands = new Map<string, string>();
export function queueTerminalCommand(id: string, command: string): void {
  if (!command.trim() || command.includes("\0"))
    throw new Error("Enter a valid command.");
  initialCommands.set(id, command);
}

/**
 * Replay budget for a PTY whose view is not mounted. Chunks arrive at up to
 * 32KB each, so a count-based cap let one unsubscribed terminal retain
 * megabytes; bound the bytes instead. Whole chunks are dropped oldest-first.
 */
const MAX_BUFFERED_BYTES = 256 * 1024;
const MAX_BUFFERED = 200;
let bridge: ReturnType<typeof listenerGroup> | null = null;
let users = 0;
let teardownTimer: ReturnType<typeof setTimeout> | undefined;

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Leading chunks to drop to bring a replay buffer back within budget, and the
 * byte total that remains. Never drops the newest chunk, even when that chunk
 * alone exceeds the budget — replaying something beats replaying nothing.
 */
export function trimReplay(
  sizes: number[],
  bytes: number,
): { drop: number; bytes: number } {
  let drop = 0;
  let left = bytes;
  while (
    drop < sizes.length - 1 &&
    (left > MAX_BUFFERED_BYTES || sizes.length - drop > MAX_BUFFERED)
  ) {
    left -= sizes[drop];
    drop += 1;
  }
  return { drop, bytes: left };
}

function pushBuffered(id: string, chunk: Uint8Array) {
  const queued = dataBuffer.get(id) ?? [];
  queued.push(chunk);
  const trimmed = trimReplay(
    queued.map((entry) => entry.byteLength),
    (dataBufferBytes.get(id) ?? 0) + chunk.byteLength,
  );
  if (trimmed.drop > 0) queued.splice(0, trimmed.drop);
  dataBuffer.set(id, queued);
  dataBufferBytes.set(id, trimmed.bytes);
}

function clearBuffered(id: string) {
  dataBuffer.delete(id);
  dataBufferBytes.delete(id);
}

function ensureBridge() {
  if (bridge) return;
  const pending = listenerGroup([
    listen<DataPayload>("pty-data", (event) => {
      const { id, data } = event.payload;
      const handler = dataHandlers.get(id);
      if (!handler && !openedPtys.has(id)) return;
      const chunk = decodeBase64(data);
      if (handler) handler(chunk);
      else pushBuffered(id, chunk);
    }),
    listen<ExitPayload>("pty-exit", (event) => {
      const { id, code } = event.payload;
      exitHandlers.get(id)?.(code);
    }),
  ]);
  bridge = pending;
  void pending.ready.catch(() => {
    if (bridge === pending) bridge = null;
  });
}

function retain() {
  users += 1;
  if (teardownTimer) {
    clearTimeout(teardownTimer);
    teardownTimer = undefined;
  }
  ensureBridge();
}

function release() {
  users = Math.max(0, users - 1);
  if (users > 0 || !bridge) return;
  const pending = bridge;
  teardownTimer = setTimeout(() => {
    teardownTimer = undefined;
    if (users > 0) return;
    if (bridge === pending) bridge = null;
    pending.dispose();
  }, 500);
}

export async function spawnPty(
  id: string,
  cwd: string,
  cols: number,
  rows: number,
): Promise<void> {
  try {
    await invoke("pty_spawn", { id, cwd, cols, rows, reuseExisting: true });
    const command = initialCommands.get(id);
    initialCommands.delete(id);
    if (command) await writePty(id, command.replace(/\r?\n/g, "\r") + "\r");
  } catch (error) {
    initialCommands.delete(id);
    throw error;
  }
}

export async function writePty(id: string, data: string): Promise<void> {
  await invoke("pty_write", { id, data });
}

export async function resizePty(
  id: string,
  cols: number,
  rows: number,
): Promise<void> {
  await invoke("pty_resize", { id, cols, rows });
}

export async function getPtyStatus(
  id: string,
): Promise<{ foreground: string | null }> {
  return invoke<{ foreground: string | null }>("pty_status", { id });
}

export async function killPty(id: string): Promise<void> {
  releaseTerminalScreen(id);
  initialCommands.delete(id);
  dataHandlers.delete(id);
  exitHandlers.delete(id);
  openedPtys.delete(id);
  clearBuffered(id);
  await invoke("pty_kill", { id }).catch(() => undefined);
}

export async function killAllPtys(): Promise<void> {
  initialCommands.clear();
  dataHandlers.clear();
  exitHandlers.clear();
  openedPtys.clear();
  dataBuffer.clear();
  dataBufferBytes.clear();
  await invoke("pty_kill_all").catch(() => undefined);
}

export function subscribePty(
  id: string,
  onData: DataHandler,
  onExit: ExitHandler,
): () => void {
  retain();
  openedPtys.add(id);
  dataHandlers.set(id, onData);
  exitHandlers.set(id, onExit);
  const queued = dataBuffer.get(id);
  if (queued) {
    clearBuffered(id);
    for (const chunk of queued) onData(chunk);
  }
  return () => {
    if (dataHandlers.get(id) === onData) dataHandlers.delete(id);
    if (exitHandlers.get(id) === onExit) exitHandlers.delete(id);
    release();
  };
}

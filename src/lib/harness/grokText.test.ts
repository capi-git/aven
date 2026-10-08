import { afterEach, beforeEach, expect, it, vi } from "vitest";

const SESSION = "550e8400-e29b-41d4-a716-446655440000";

const sent: string[] = [];
let onLine: ((line: string) => void) | undefined;
let onExit: (() => void) | undefined;
const execChild = vi.fn(async (..._args: unknown[]) => "");
const killChild = vi.fn(async (..._args: unknown[]) => undefined);

vi.mock("./child", () => ({
  resolveGrokBinary: async () => ({ path: "/fake/grok" }),
  execChild,
  spawnChild: async () => undefined,
  killChild,
  unwatchChild: () => undefined,
  watchChild: (
    _id: string,
    line: (value: string) => void,
    exit: () => void,
  ) => {
    onLine = line;
    onExit = exit;
  },
  writeChild: async (_id: string, line: string) => {
    sent.push(line);
  },
}));

const { runGrokTextPrompt, stopGrokTextPrompt, warmupGrokText } =
  await import("./grokText");

function outbound(method: string) {
  return sent
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .find((message) => message.method === method);
}

function reply(method: string, result: unknown) {
  const request = outbound(method);
  onLine?.(JSON.stringify({ jsonrpc: "2.0", id: request?.id, result }));
}

async function waitFor(predicate: () => boolean, label: string) {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function openTextSession(sessionId = SESSION) {
  await waitFor(() => !!outbound("initialize"), "initialize");
  reply("initialize", {});
  await waitFor(() => !!outbound("session/new"), "session/new");
  reply("session/new", { sessionId });
  await waitFor(() => !!outbound("session/set_model"), "session/set_model");
  reply("session/set_model", {});
  await waitFor(() => !!outbound("session/set_mode"), "session/set_mode");
  reply("session/set_mode", {});
}

function deleteArgs(id = SESSION) {
  return ["/fake/grok", ["--no-auto-update", "sessions", "delete", id], "/repo"];
}

beforeEach(() => {
  sent.length = 0;
  onLine = undefined;
  onExit = undefined;
  execChild.mockClear();
  killChild.mockClear();
});

afterEach(async () => {
  await stopGrokTextPrompt();
});

it("deletes the temporary session after the provider has stopped", async () => {
  const result = runGrokTextPrompt({
    cwd: "/repo",
    prompt: "Title this",
    timeoutMs: 1_000,
  });
  await openTextSession();
  await waitFor(() => !!outbound("session/prompt"), "session/prompt");
  onLine?.(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: SESSION,
        update: { sessionUpdate: "agent_message", content: "Hello" },
      },
    }),
  );
  reply("session/prompt", {});

  await expect(result).resolves.toBe("Hello");
  expect(execChild).toHaveBeenCalledTimes(1);
  expect(execChild).toHaveBeenCalledWith(...deleteArgs());
  expect(killChild.mock.invocationCallOrder.at(-1)).toBeLessThan(
    execChild.mock.invocationCallOrder[0],
  );
});

it("deletes the temporary session when generation fails", async () => {
  const result = runGrokTextPrompt({
    cwd: "/repo",
    prompt: "Title this",
    timeoutMs: 1_000,
  });
  const rejected = expect(result).rejects.toThrow("Generation failed");
  await openTextSession();
  await waitFor(() => !!outbound("session/prompt"), "session/prompt");
  onLine?.(
    JSON.stringify({
      jsonrpc: "2.0",
      id: outbound("session/prompt")?.id,
      error: { message: "Generation failed" },
    }),
  );
  await rejected;
  expect(execChild).toHaveBeenCalledTimes(1);
  expect(execChild).toHaveBeenCalledWith(...deleteArgs());
});

it("cleans up a warmed session even if the provider exited first", async () => {
  const warmup = warmupGrokText("/repo");
  await openTextSession();
  await warmup;
  onExit?.();
  await stopGrokTextPrompt();
  expect(execChild).toHaveBeenCalledWith(...deleteArgs());
});

it("does not pass an invalid provider session id to the cleanup command", async () => {
  const warmup = warmupGrokText("/repo");
  await openTextSession("--all");
  await warmup;
  await stopGrokTextPrompt();
  expect(execChild).not.toHaveBeenCalled();
});


it("preserves history if the provider could still be writing after a failed kill", async () => {
  const warmup = warmupGrokText("/repo");
  await openTextSession();
  await warmup;
  killChild.mockRejectedValueOnce(new Error("kill failed"));
  await stopGrokTextPrompt();
  expect(execChild).not.toHaveBeenCalled();
});

it("cleans history after an observed exit even when killing the retired child fails", async () => {
  const warmup = warmupGrokText("/repo");
  await openTextSession();
  await warmup;
  onExit?.();
  killChild.mockRejectedValueOnce(new Error("already exited"));
  await stopGrokTextPrompt();
  expect(execChild).toHaveBeenCalledWith(...deleteArgs());
});

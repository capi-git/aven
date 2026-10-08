import { afterEach, beforeEach, expect, it, vi } from "vitest";

type HttpRequest = { url: string; method: string; body?: string };

const harnessHttp = vi.fn<(request: HttpRequest) => Promise<unknown>>();
let onLine: ((line: string) => void) | undefined;
let finishPrompt: ((response: { status: number; body: string }) => void) | null;

vi.mock("./child", () => ({
  resolveOpenCodeBinary: async () => ({ path: "/fake/opencode" }),
  execChild: async () => "1.20.0",
  freeHarnessPort: async () => 4096,
  spawnChild: async () => {
    onLine?.("opencode server listening on http://127.0.0.1:4096");
  },
  killChild: async () => undefined,
  unwatchChild: () => undefined,
  watchChild: (_id: string, line: (value: string) => void) => {
    onLine = line;
  },
  harnessHttp,
  closeHarnessSse: async () => undefined,
  openHarnessSse: async () => undefined,
  watchSse: () => () => undefined,
}));

const { runOpenCodeTextPrompt, stopOpenCodeTextPrompt } = await import(
  "./opencodeText"
);

const DELETE_URL = "http://127.0.0.1:4096/session/text_session?directory=%2Frepo";

async function waitFor(predicate: () => boolean, label: string) {
  for (let i = 0; i < 200; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

beforeEach(() => {
  onLine = undefined;
  finishPrompt = null;
  harnessHttp.mockReset();
  harnessHttp.mockImplementation(async (request) => {
    if (request.method === "POST" && request.url.includes("/session?")) {
      return { status: 200, body: JSON.stringify({ id: "text_session" }) };
    }
    if (request.url.includes("/message")) {
      return new Promise((resolve) => {
        finishPrompt = resolve;
      });
    }
    return { status: 200, body: "true" };
  });
});

afterEach(async () => {
  await stopOpenCodeTextPrompt();
});

function deletes() {
  return harnessHttp.mock.calls.filter(
    ([request]) => request.method === "DELETE",
  );
}

it("deletes the generated-text session after a successful prompt", async () => {
  const result = runOpenCodeTextPrompt({ cwd: "/repo", prompt: "Title this" });
  await waitFor(() => !!finishPrompt, "prompt");
  finishPrompt?.({
    status: 200,
    body: JSON.stringify({ info: {}, parts: [{ type: "text", text: "Hello" }] }),
  });
  await expect(result).resolves.toBe("Hello");
  expect(deletes()).toEqual([
    [expect.objectContaining({ method: "DELETE", url: DELETE_URL })],
  ]);
});

it("deletes the generated-text session when the provider returns an error", async () => {
  const result = runOpenCodeTextPrompt({ cwd: "/repo", prompt: "Title this" });
  await waitFor(() => !!finishPrompt, "prompt");
  finishPrompt?.({
    status: 200,
    body: JSON.stringify({ info: { error: { message: "Generation failed" } } }),
  });
  await expect(result).rejects.toThrow("Generation failed");
  expect(deletes()).toEqual([
    [expect.objectContaining({ method: "DELETE", url: DELETE_URL })],
  ]);
});

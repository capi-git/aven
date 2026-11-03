import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execChild: vi.fn(async (_path: string, _args: string[], _cwd: string) => ""),
  killChild: vi.fn(async (_id: string) => {}),
  setHarnessModels: vi.fn(),
  spawnChild: vi.fn(async (_id: string) => {}),
  unwatchChild: vi.fn(),
  watchChild: vi.fn(),
  writeChild: vi.fn(async (_id: string, _line: string) => {}),
}));

vi.mock("../fs", () => ({ homeDir: vi.fn(async () => "/home/test") }));
vi.mock("../models", () => ({ setHarnessModels: mocks.setHarnessModels }));
vi.mock("./child", () => ({
  execChild: mocks.execChild,
  killChild: mocks.killChild,
  resolveCursorBinary: vi.fn(async () => ({ path: "/fake/cursor-agent" })),
  spawnChild: mocks.spawnChild,
  unwatchChild: mocks.unwatchChild,
  watchChild: mocks.watchChild,
  writeChild: mocks.writeChild,
}));
import { refreshCursorCatalog } from "./cursorCatalog";

type Request = { id: number; method: string; params?: unknown };

/** Every ACP request the probe wrote, in order. */
function requests(): Request[] {
  return mocks.writeChild.mock.calls.map(
    ([, line]) => JSON.parse(line) as Request,
  );
}

/** Answer a probe request through the watched child's output. */
function reply(probeId: string, id: number, result: unknown) {
  const onLine = mocks.watchChild.mock.calls.find(
    ([watched]) => watched === probeId,
  )![1] as (line: string) => void;
  onLine(JSON.stringify({ jsonrpc: "2.0", id, result }));
}

const listed = {
  models: [
    { value: "gpt-5", name: "GPT-5" },
    { value: "sonnet-4.5", name: "Claude Sonnet 4.5" },
  ],
};

/** A probe that answers every method except an authentication request. */
function answerAcp(answers: Record<string, unknown>) {
  mocks.writeChild.mockImplementation(async (id, line) => {
    const request = JSON.parse(line) as Request;
    if (request.method in answers)
      reply(id, request.id, answers[request.method]);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "debug").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

it("lists models over ACP without ever asking Cursor to log in", async () => {
  answerAcp({ initialize: {}, "cursor/list_available_models": listed });
  await refreshCursorCatalog();

  // `authenticate` with `cursor_login` opens a browser sign-in; a catalog
  // refresh in the background must never trigger it.
  expect(requests().map((request) => request.method)).toEqual([
    "initialize",
    "cursor/list_available_models",
  ]);
  expect(mocks.setHarnessModels).toHaveBeenCalledExactlyOnceWith(
    "cursor",
    expect.arrayContaining([
      expect.objectContaining({ id: "cursor:gpt-5", name: "GPT-5" }),
      expect.objectContaining({ id: "cursor:sonnet-4.5" }),
    ]),
  );
  expect(mocks.execChild).not.toHaveBeenCalled();
  const probeId = mocks.spawnChild.mock.calls[0][0];
  expect(mocks.killChild).toHaveBeenCalledExactlyOnceWith(probeId);
});

it("falls back to the CLI listing when ACP has no credentials to list with", async () => {
  mocks.writeChild.mockImplementation(async (id, line) => {
    const request = JSON.parse(line) as Request;
    if (request.method === "initialize") reply(id, request.id, {});
    // Not signed in: ACP refuses the listing instead of prompting.
    const onLine = mocks.watchChild.mock.calls.find(
      ([watched]) => watched === id,
    )![1] as (line: string) => void;
    if (request.method === "cursor/list_available_models")
      onLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32000, message: "Not authenticated" },
        }),
      );
  });
  mocks.execChild.mockResolvedValue(
    "gpt-5 - GPT-5 (default)\nsonnet-4.5 - Claude Sonnet 4.5\n",
  );
  await refreshCursorCatalog();

  expect(requests().some((request) => request.method === "authenticate")).toBe(
    false,
  );
  expect(mocks.execChild).toHaveBeenCalledWith(
    "/fake/cursor-agent",
    ["--list-models"],
    "/home/test",
  );
  expect(mocks.setHarnessModels).toHaveBeenCalledExactlyOnceWith(
    "cursor",
    expect.arrayContaining([expect.objectContaining({ id: "cursor:gpt-5" })]),
  );
});

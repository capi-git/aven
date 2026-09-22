import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HarnessId } from "./session";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  steer: vi.fn(),
}));
vi.mock("./agentBrowser", () => ({
  prepareAgentBrowserPrompt: mocks.prepare,
}));
vi.mock("./harness/registry", () => ({
  steerHarnessTurn: mocks.steer,
  getHarness: (id: string) => ({
    commands: { rawSlashCommands: id === "omp" },
  }),
}));

import { steerManagedTurn } from "./managedSteering";

beforeEach(() => {
  mocks.prepare
    .mockReset()
    .mockImplementation(
      async (text: string) =>
        `<supermono-browser>Scoped browser guidance</supermono-browser>\n\n${text}`,
    );
  mocks.steer.mockReset().mockResolvedValue(undefined);
});

const input = (harness: HarnessId = "codex", text = "Inspect the preview") => ({
  harness,
  sessionId: "worker",
  cwd: "/repo/worktree",
  model: `${harness}:model`,
  modelSettings: { effort: "high" },
  text,
});

describe("managed browser steering", () => {
  it.each(["codex", "claude"] as const)(
    "refreshes browser binding and forwards guidance on each %s follow-up",
    async (harness) => {
      const first = input(harness);
      const second = input(harness, "Now inspect the changed page");
      await steerManagedTurn(first, () => true);
      await steerManagedTurn(second, () => true);
      expect(mocks.prepare).toHaveBeenCalledTimes(2);
      expect(mocks.prepare).toHaveBeenNthCalledWith(1, first.text, {
        sessionId: first.sessionId,
        cwd: first.cwd,
      });
      expect(mocks.steer).toHaveBeenNthCalledWith(2, {
        ...second,
        text: expect.stringContaining(
          "</supermono-browser>\n\nNow inspect the changed page",
        ),
      });
    },
  );

  it("waits for binding and does not steer a replacement turn", async () => {
    let resolve!: (text: string) => void;
    mocks.prepare.mockReturnValueOnce(
      new Promise<string>((done) => {
        resolve = done;
      }),
    );
    let current = true;
    const steering = steerManagedTurn(input(), () => current);
    expect(mocks.steer).not.toHaveBeenCalled();
    current = false;
    resolve("Prepared guidance");
    await expect(steering).rejects.toThrow("turn changed");
    expect(mocks.steer).not.toHaveBeenCalled();
  });

  it.each([
    ["/workflow inspect @README.md", "/workflow inspect @README.md"],
    [
      "/omp:compact preserve browser context",
      "/compact preserve browser context",
    ],
  ])(
    "preserves the native slash command %s without a browser prefix",
    async (text, expected) => {
      const request = input("omp", text);
      await steerManagedTurn(request, () => true);
      expect(mocks.prepare).not.toHaveBeenCalled();
      expect(mocks.steer).toHaveBeenCalledWith({ ...request, text: expected });
    },
  );

  it("still supplies browser guidance for non-native slash text", async () => {
    const request = input("codex", "/review the preview");
    await steerManagedTurn(request, () => true);
    expect(mocks.prepare).toHaveBeenCalled();
    expect(mocks.steer).toHaveBeenCalledWith({
      ...request,
      text: expect.stringContaining("<supermono-browser>"),
    });
  });

  it("forwards an unavailable-browser notice without silently dropping it", async () => {
    const unavailable =
      "<supermono-browser>In-app browser controls are unavailable. Do not switch browsers.</supermono-browser>\n\nInspect the preview";
    mocks.prepare.mockResolvedValueOnce(unavailable);
    await steerManagedTurn(input(), () => true);
    expect(mocks.steer).toHaveBeenCalledWith({ ...input(), text: unavailable });
  });
});

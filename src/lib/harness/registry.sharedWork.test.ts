import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportDevServer, resetDevPreviews } from "../devPreviews";
import { localDevAddress } from "../devServerUrls";
import type { HarnessId } from "../session";
import {
  installSharedWorkSessions,
  resetSharedWork,
  sharedWorkTurns,
  type SharedWorkSession,
} from "../sharedWork";
import {
  resetSharedWorkDeliveryState,
  SHARED_WORK_TAG,
} from "../sharedWorkNote";
import { harnessDescriptor } from "./descriptors";
import { resetProjectMemoryDeliveryState } from "./projectMemoryDelivery";
import {
  compactHarnessContext,
  registerHarness,
  resetHarnessIdlePark,
  sendHarnessTurn,
  steerHarnessTurn,
  type HarnessAdapter,
} from "./registry";
import type { HarnessEvent, SendTurnInput, SteerTurnInput } from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(async () => undefined),
}));

const SITE = "/Users/me/site";
let chats: Record<string, SharedWorkSession>;

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  resetDevPreviews();
  resetSharedWork();
  resetSharedWorkDeliveryState();
  resetProjectMemoryDeliveryState();
  chats = {};
  installSharedWorkSessions((id) => chats[id]);
});

afterEach(() => {
  resetHarnessIdlePark();
  resetDevPreviews();
  resetSharedWork();
  resetSharedWorkDeliveryState();
  vi.unstubAllGlobals();
});

function adapter(
  id: HarnessId,
  extra: Partial<HarnessAdapter> = {},
): HarnessAdapter & {
  sendTurn: ReturnType<typeof vi.fn>;
  steerTurn: ReturnType<typeof vi.fn>;
} {
  const sendTurn = vi.fn(async (_input: SendTurnInput) => {});
  const steerTurn = vi.fn(async (_input: SteerTurnInput) => {});
  const registered = {
    id,
    descriptor: harnessDescriptor(id),
    live: true,
    sendTurn,
    steerTurn,
    async cancelTurn() {},
    respondApproval() {},
    async stopSession() {},
    async forgetSession() {},
    bindSession() {},
    ...extra,
  };
  registerHarness(registered);
  return registered as never;
}

function chat(id: string, harness: HarnessId) {
  chats[id] = {
    harness,
    title: id === "first" ? "Start the site" : "Fix the header",
    project: SITE,
    cwd: SITE,
    runtimeMode: "supervised",
  };
}

function server() {
  reportDevServer({
    project: SITE,
    cwd: SITE,
    address: localDevAddress("http://localhost:5173/")!,
    source: "terminal",
    sourceId: "terminal:t1",
    placement: "terminal",
  });
}

const send = (
  sessionId: string,
  text: string,
  extra: Partial<SendTurnInput> = {},
) =>
  sendHarnessTurn({
    harness: chats[sessionId].harness,
    sessionId,
    cwd: SITE,
    model: "",
    runtimeMode: "supervised",
    text,
    onEvent: () => {},
    ...extra,
  });

const NOTE_START = `<${SHARED_WORK_TAG}>\nLive from Aven`;

describe("shared-work note in the send path", () => {
  it.each<HarnessId>(["claude", "codex", "cursor", "opencode", "pi"])(
    "%s receives it ahead of the message, once per change",
    async (harness) => {
      const provider = adapter(harness);
      chat("chat", harness);
      server();
      await send("chat", "Fix the header");
      const first = provider.sendTurn.mock.calls[0][0].text as string;
      expect(first.startsWith(NOTE_START)).toBe(true);
      expect(first).toContain(
        "Dev server running: http://localhost:5173/ (started in the user's terminal).",
      );
      expect(first.endsWith("</aven-shared-work>\n\nFix the header")).toBe(
        true,
      );
      if (harness === "codex")
        expect(first).toContain(
          "Your sandbox may not reach localhost:5173; ask the user before starting another server.",
        );
      else expect(first).not.toContain("sandbox");

      await send("chat", "And the footer");
      expect(provider.sendTurn.mock.calls[1][0].text).toBe("And the footer");
    },
  );

  it("puts project memory first, then the note, then the message", async () => {
    const provider = adapter("cursor");
    chat("chat", "cursor");
    server();
    await send("chat", "Hello", {
      projectMemory: {
        text: "<aven-project-memory>\nUse pnpm.\n</aven-project-memory>",
        revision: "r1",
      },
    });
    const text = provider.sendTurn.mock.calls[0][0].text as string;
    expect(text.startsWith("<aven-project-memory>\nUse pnpm.")).toBe(true);
    expect(text.indexOf("</aven-project-memory>")).toBeLessThan(
      text.indexOf(NOTE_START),
    );
    expect(text.endsWith("</aven-shared-work>\n\nHello")).toBe(true);
  });

  it("tracks each turn and the files it edits from tool events", async () => {
    let during: ReturnType<typeof sharedWorkTurns> = [];
    adapter("claude", {
      sendTurn: vi.fn(async (input: SendTurnInput) => {
        input.onEvent({
          type: "tool.started",
          callId: "e1",
          title: "Edit src/App.tsx",
          kind: "edit",
          paths: [`${SITE}/src/App.tsx`],
        } satisfies HarnessEvent);
        during = sharedWorkTurns();
      }),
    });
    chat("chat", "claude");
    await send("chat", "Edit it");
    expect(during).toMatchObject([
      { sessionId: "chat", running: 1, files: [`${SITE}/src/App.tsx`] },
    ]);
    expect(sharedWorkTurns()).toMatchObject([
      { sessionId: "chat", running: 0 },
    ]);
  });

  it("tells a chat what another is editing, and a steer carries a change", async () => {
    let release = () => {};
    const first = adapter("claude", {
      sendTurn: vi.fn(
        (input: SendTurnInput) =>
          new Promise<void>((resolve) => {
            input.onEvent({
              type: "tool.started",
              callId: "e1",
              title: "Edit src/App.tsx",
              kind: "edit",
              paths: [`${SITE}/src/App.tsx`],
            });
            release = resolve;
          }),
      ),
    });
    const second = adapter("codex");
    chat("first", "claude");
    chat("second", "codex");
    const running = send("first", "Rework the app");
    await vi.waitFor(() => expect(first.sendTurn).toHaveBeenCalled());
    await send("second", "Tidy up");
    expect(second.sendTurn.mock.calls[0][0].text).toContain(
      "Other agents here: Claude in “Start the site” is working, editing src/App.tsx.",
    );

    server();
    await steerHarnessTurn({
      harness: "codex",
      sessionId: "second",
      cwd: SITE,
      model: "",
      text: "Also this",
    });
    const steered = second.steerTurn.mock.calls[0][0].text as string;
    expect(steered.startsWith(NOTE_START)).toBe(true);
    expect(steered).toContain("http://localhost:5173/");
    expect(steered.endsWith("\n\nAlso this")).toBe(true);
    release();
    await running;
  });

  it("gives it again when the send fails or after compaction", async () => {
    const provider = adapter("cursor", {
      compactContext: vi.fn(async () => {}),
    });
    chat("chat", "cursor");
    server();
    provider.sendTurn.mockRejectedValueOnce(new Error("offline"));
    await expect(send("chat", "One")).rejects.toThrow("offline");
    await send("chat", "Two");
    expect(provider.sendTurn.mock.calls[1][0].text).toContain(NOTE_START);
    await send("chat", "Three");
    expect(provider.sendTurn.mock.calls[2][0].text).toBe("Three");
    await compactHarnessContext({
      harness: "cursor",
      sessionId: "chat",
      cwd: SITE,
      model: "",
      runtimeMode: "supervised",
      onEvent: () => {},
    });
    await send("chat", "Four");
    expect(provider.sendTurn.mock.calls[3][0].text).toContain(NOTE_START);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  setDockLeadDecided,
  setDockTeamNeeds,
  syncDockBadge,
} from "./dockBadge";
import { newSession, type Session } from "./session";
import { NO_LEAD_DECIDED } from "./teamAttention";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

function asking(id: string): Session {
  return {
    ...newSession("claude", "/Users/me/site"),
    id,
    blocks: [
      {
        id: "a",
        role: "assistant",
        text: "",
        approval: { requestId: 1 },
      } as unknown as Session["blocks"][number],
    ],
  };
}

const lastCount = () =>
  (vi.mocked(invoke).mock.calls.at(-1)?.[1] as { count: number } | undefined)
    ?.count;

describe("the Dock badge", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
    setDockTeamNeeds(new Set());
    setDockLeadDecided(NO_LEAD_DECIDED);
  });

  it("counts the chats asking you, each once", () => {
    syncDockBadge([asking("one")]);
    expect(lastCount()).toBe(1);
    syncDockBadge([asking("one"), asking("two")]);
    expect(lastCount()).toBe(2);
    syncDockBadge([]);
    expect(lastCount()).toBe(0);
  });
});

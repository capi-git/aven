import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  setDockAvosNeeds,
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
    setDockAvosNeeds(0);
  });

  it("counts what each Avos needs you for with the chats asking you", () => {
    syncDockBadge([asking("one")]);
    expect(lastCount()).toBe(1);
    setDockAvosNeeds(2);
    syncDockBadge([asking("one")]);
    expect(lastCount()).toBe(3);
    setDockAvosNeeds(0);
    syncDockBadge([]);
    expect(lastCount()).toBe(0);
  });
});

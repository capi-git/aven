// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => false,
}));
const store = vi.hoisted(() => ({ searchSessions: vi.fn() }));
vi.mock("./sessionStore", async (original) => ({
  ...(await original<typeof import("./sessionStore")>()),
  searchSessions: store.searchSessions,
}));

import { searchPaletteChats } from "./paletteAgents";
import { saveScheduledRun } from "./scheduledAgents";

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  });
});

it("leaves an automation run's own chat out of the palette's chat search", async () => {
  saveScheduledRun({
    id: "run-1",
    scheduleId: "brief",
    name: "Morning briefing",
    project: "/work/site",
    sessionId: "run-chat",
    status: "completed",
    summary: "",
    startedAt: 1,
    inAutomations: true,
  });
  const hit = (sessionId: string) => ({
    sessionId,
    cwd: "/work/site",
    harness: "claude",
    title: sessionId,
    updatedAt: 1,
  });
  store.searchSessions.mockResolvedValue({
    hits: [hit("run-chat"), hit("mine"), hit("mine")],
  });
  const chats = await searchPaletteChats("briefing");
  expect(chats.map((chat) => chat.id)).toEqual(["mine"]);
});

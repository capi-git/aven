// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatStatusWord } from "../lib/chatStatus";
import { newSession, type Session } from "../lib/session";
import { NO_LEAD_DECIDED } from "../lib/teamAttention";
import type { TeamRun } from "../lib/teamRuns";
import { resetWorkBoardFeed, workBoardFeed } from "../lib/workBoardFeed";
import { useWorkBoardPublisher } from "./useWorkBoardPublisher";

let root: Root;
let container: HTMLDivElement;
const NO_TEAMS: readonly TeamRun[] = [];
const statuses: Record<string, ChatStatusWord> = { a: "working" };
const busy = new Set(["a"]);

function Host({
  enabled,
  sessions,
}: {
  enabled: boolean;
  sessions: Session[];
}) {
  useWorkBoardPublisher({
    enabled,
    sessions,
    inFlightIds: busy,
    leadDecided: NO_LEAD_DECIDED,
    statuses,
    teams: NO_TEAMS,
  });
  return null;
}

const working = (text: string): Session => ({
  ...newSession("claude", "/work/site"),
  id: "a",
  busy: true,
  blocks: [
    { id: "u", role: "user", text: "Go", startedAt: 1 },
    { id: "r", role: "assistant", text },
  ],
});

async function render(enabled: boolean, sessions: Session[]) {
  await act(async () =>
    root.render(createElement(Host, { enabled, sessions })),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetWorkBoardFeed();
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  resetWorkBoardFeed();
  vi.unstubAllGlobals();
});

describe("useWorkBoardPublisher", () => {
  it("publishes nothing while no board is on screen", async () => {
    const before = workBoardFeed();
    await render(false, [working("Hel")]);
    expect(workBoardFeed()).toBe(before);
  });

  it("publishes the chats as rows, and nothing again for a streamed reply", async () => {
    await render(true, [working("Hel")]);
    const published = workBoardFeed();
    expect(published.chats).toEqual([
      expect.objectContaining({ id: "a", doing: "Writing a reply" }),
    ]);
    expect(published.statuses).toBe(statuses);
    // The reply grows: the session is new, but nothing a card shows moved.
    await render(true, [working("Hello there")]);
    await render(true, [working("Hello there, here is the plan")]);
    expect(workBoardFeed()).toBe(published);
  });
});

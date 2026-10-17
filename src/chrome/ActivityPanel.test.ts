// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActivityPanel,
  activityOutcomeLabel,
  activitySections,
  type ActivityPanelProps,
} from "./ActivityPanel";
import {
  type ActivityEntry,
  getActivitySnapshot,
  recordActivity,
  type ActivityOutcome,
} from "../lib/activity";
import {
  createLiveSessionStore,
  LiveSessionsContext,
} from "../lib/liveSessions";
import { saveRace } from "../lib/race";
import type { TeamRun } from "../lib/teamRuns";
import { newSession } from "../lib/session";

let host: HTMLDivElement;
let root: Root;
const open = vi.fn<(entry: unknown) => boolean | Promise<boolean>>();
const openSession = vi.fn<(id: string) => boolean | Promise<boolean>>();
function record(id: string, outcome: ActivityOutcome, read = false) {
  recordActivity(
    {
      id,
      sessionId: id,
      outcome,
      title: id,
      summary: `${id} detail`,
      harness: "codex",
      model: "codex:test",
      cwd: "/tmp/project",
    },
    read,
  );
}
async function mount(
  sessions: ReturnType<typeof newSession>[] = [],
  options: Pick<ActivityPanelProps, "theme" | "onClose"> = {},
) {
  await act(async () =>
    root.render(
      createElement(ActivityPanel, {
        sessions,
        onOpen: open,
        onOpenSession: openSession,
        ...options,
      }),
    ),
  );
}
function button(name: string) {
  const found = [...host.querySelectorAll("button")].find(
    (node) =>
      node.getAttribute("aria-label") === name || node.textContent === name,
  );
  if (!found) throw new Error(`Missing button ${name}`);
  return found;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  getActivitySnapshot();
  open.mockReset().mockReturnValue(true);
  openSession.mockReset().mockReturnValue(true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("Activity panel", () => {
  it("shows a running team as one row, and leaves its members' turns out", async () => {
    saveRace({
      id: "r1",
      project: "/tmp/project",
      root: "/tmp/project",
      base: "a".repeat(40),
      prompt: "Fix the login loop",
      createdAt: 0,
      uncommitted: false,
      untracked: false,
      state: "running",
      origin: { sessionId: "chat", blockId: "msg" },
      lanes: ["l0", "l1"].map((sessionId, slot) => ({
        sessionId,
        harness: slot ? ("codex" as const) : ("claude" as const),
        model: "m",
        label: slot ? "Codex · GPT-5" : "Claude Code · Opus",
        path: `/data/races/r1/${slot}`,
        branch: `aven/race/r1-${slot}`,
      })),
    });
    recordActivity(
      {
        id: "l0:turn:t:completed",
        sessionId: "l0",
        outcome: "completed",
        title: "Race · Claude",
        summary: "Done.",
        harness: "claude",
        model: "m",
        cwd: "/tmp/project",
        team: { id: "race:r1", kind: "race", member: true },
      },
      true,
    );
    const lane = (id: string) => ({
      ...newSession("claude", "/tmp/project"),
      id,
      title: `Race · ${id}`,
      busy: true,
      blocks: [
        { id: `${id}-u`, role: "user" as const, text: "Go", startedAt: 1 },
      ],
    });
    const lanes = [lane("l0"), lane("l1")];
    await act(async () =>
      root.render(
        createElement(
          LiveSessionsContext.Provider,
          { value: createLiveSessionStore(lanes) },
          createElement(ActivityPanel, {
            sessions: lanes,
            onOpen: open,
            onOpenSession: openSession,
          }),
        ),
      ),
    );
    const running = host.querySelector<HTMLElement>('[aria-label="Running"]')!;
    expect(running.querySelector("h3")?.textContent).toBe("Running1");
    const row = running.querySelector("[data-activity-team='race:r1']")!;
    expect(row.textContent).toContain("Fix the login loop");
    expect(row.textContent).toContain("Racing · 0 of 2 done · 2 agents");
    // The lane's own turn is its team's, so Finished does not list it.
    expect(host.querySelector('[aria-label="Finished"]')).toBeNull();
    await act(async () => button("Open Fix the login loop").click());
    expect(openSession).toHaveBeenCalledWith("chat");
  });
  it("updates the shared workspace palette and closes without changing activity", async () => {
    record("Saved result", "completed");
    const close = vi.fn();
    await mount([], {
      theme: {
        mode: "dark",
        accent: "#7ab6df",
        background: "#253542",
        text: "#f0f4f7",
      },
      onClose: close,
    });
    const panel = host.querySelector<HTMLElement>(".activity-panel")!;
    expect(panel.classList.contains("toolbar-panel")).toBe(true);
    expect(panel.style.getPropertyValue("--toolbar-panel-bg")).toBe("#253542");
    expect(panel.style.getPropertyValue("--toolbar-panel-text")).toBe(
      "#f0f4f7",
    );
    await mount([], {
      theme: {
        mode: "light",
        accent: "#446a89",
        background: "#f2f6f9",
        text: "#1c2832",
      },
      onClose: close,
    });
    expect(panel.dataset.theme).toBe("light");
    expect(panel.style.getPropertyValue("--toolbar-panel-bg")).toBe("#f2f6f9");
    expect(panel.style.getPropertyValue("--toolbar-panel-accent")).toBe(
      "#446a89",
    );
    await act(async () => button("Close activity").click());
    expect(close).toHaveBeenCalledOnce();
    expect(getActivitySnapshot()[0].readAt).toBeNull();
    expect(open).not.toHaveBeenCalled();
    expect(openSession).not.toHaveBeenCalled();
  });
  it("separates actual running tasks, actionable failures and finished outcomes", async () => {
    record("finished", "completed");
    record("failed", "failed");
    record("read failure", "failed", true);
    record("approval", "approval");
    const running = {
      ...newSession("claude", "/tmp/project"),
      id: "running",
      title: "Working task",
      busy: true,
    };
    await mount([running]);
    expect(
      host.querySelector('[aria-label="Needs you"]')?.textContent,
    ).toContain("failed");
    expect(
      host.querySelector('[aria-label="Needs you"]')?.textContent,
    ).toContain("approval");
    expect(
      host.querySelector('[aria-label="Finished"]')?.textContent,
    ).toContain("read failure");
    expect(host.querySelector('[aria-label="Running"]')?.textContent).toContain(
      "Working task",
    );
    await act(async () => button("Open Working task").click());
    expect(openSession).toHaveBeenCalledWith("running");
  });

  it("lists optional questions as running while keeping their request actionable", async () => {
    record("optional", "question");
    const optional = {
      ...newSession("codex", "/tmp/project"),
      id: "optional",
      title: "Parallel work",
      busy: true,
      pendingQuestion: { requestId: 7, questions: [], blocking: false },
    };
    await mount([
      optional,
      {
        ...newSession("claude", "/tmp/project"),
        title: "Blocking question",
        busy: true,
        pendingQuestion: { requestId: 8, questions: [] },
      },
    ]);
    const running = host.querySelector('[aria-label="Running"]')!;
    expect(running.textContent).toContain("Parallel work");
    expect(running.textContent).not.toContain("Blocking question");
    expect(
      host.querySelector('[aria-label="Needs you"]')?.textContent,
    ).toContain("optional");
  });
  it("keeps failed navigation unread and acknowledges successful presentation only", async () => {
    record("Result", "completed");
    open.mockReturnValue(false);
    await mount();
    await act(async () => button("Open Result: Finished").click());
    expect(getActivitySnapshot()[0].readAt).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "could not be opened",
    );
    open.mockReturnValue(true);
    await act(async () => button("Open Result: Finished").click());
    expect(open).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "Result", sessionId: "Result" }),
    );
    expect(getActivitySnapshot()[0].readAt).not.toBeNull();
  });
  it("waits for async restoration instead of marking read on click", async () => {
    record("Restored", "completed");
    let restored!: (value: boolean) => void;
    open.mockReturnValue(
      new Promise<boolean>((resolve) => {
        restored = resolve;
      }),
    );
    await mount();
    await act(async () => button("Open Restored: Finished").click());
    expect(getActivitySnapshot()[0].readAt).toBeNull();
    await act(async () => restored(true));
    expect(getActivitySnapshot()[0].readAt).not.toBeNull();
  });
  it("offers explicit read controls and clears finished while retaining unresolved input", async () => {
    record("Question", "question");
    record("Done", "completed");
    await mount();
    await act(async () => button("Mark Question as read").click());
    expect(
      host.querySelector('[aria-label="Needs you"]')?.textContent,
    ).toContain("Question");
    await act(async () => button("Mark all read").click());
    expect(getActivitySnapshot().every((entry) => entry.readAt !== null)).toBe(
      true,
    );
    await act(async () => button("Clear finished").click());
    expect(getActivitySnapshot().map((entry) => entry.id)).toEqual([
      "Question",
    ]);
  });
});

describe("teams waiting on you", () => {
  const paused = (since: number): TeamRun => ({
    id: "discuss:d1",
    kind: "discuss",
    key: "d1",
    origin: { sessionId: "a" },
    project: "/tmp/project",
    title: "Cache the lookups?",
    status: "needs-you",
    progress: "Round 1 of 2",
    need: {
      sessionId: "b",
      kind: "paused",
      text: "Paused when its window reloaded.",
      since,
    },
    members: [],
    startedAt: 0,
    updatedAt: 0,
  });
  const entry = (patch: Partial<ActivityEntry>): ActivityEntry => ({
    id: "b:team:d1:paused:5",
    sessionId: "b",
    outcome: "failed",
    title: "Review",
    summary: "Discussion paused · Paused when its window reloaded.",
    cwd: "/tmp/project",
    harness: "codex",
    model: "",
    createdAt: 5,
    readAt: null,
    resolvedAt: null,
    team: { id: "discuss:d1", kind: "discuss", need: true },
    ...patch,
  });

  it("lists one while it waits, read or not, as the Dock and Home count it", () => {
    const read = entry({ readAt: 6 });
    expect(activitySections([read], [paused(5)]).needsYou).toEqual([read]);
    // Already waiting when Aven started: no entry, still listed.
    const [live] = activitySections([], [paused(5)]).needsYou;
    expect(live).toMatchObject({
      sessionId: "b",
      title: "Cache the lookups?",
      summary: "Paused when its window reloaded.",
    });
    expect(activityOutcomeLabel(live)).toBe("Needs you");
    // Once it no longer waits, its entry is history.
    expect(activitySections([read], []).needsYou).toEqual([]);
  });
});

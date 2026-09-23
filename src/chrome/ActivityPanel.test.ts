// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityPanel, type ActivityPanelProps } from "./ActivityPanel";
import {
  getActivitySnapshot,
  recordActivity,
  type ActivityOutcome,
} from "../lib/activity";
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

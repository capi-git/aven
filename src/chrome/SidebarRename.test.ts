// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatSessionTitle } from "../lib/session";
import { resolveModel } from "../lib/models";
import { Sidebar } from "./Sidebar";

// Keep native services out of these menu/input interaction tests.
vi.mock("../hooks/useProjectDiffStats", () => ({
  useProjectDiffStats: () => null,
}));
vi.mock("../hooks/useGitFileStatuses", () => ({
  useGitFileStatuses: () => ({ files: new Map(), dirs: new Map() }),
}));
vi.mock("./SidebarUpdate", () => ({ SidebarUpdateFooter: () => null }));
vi.mock("./FileTree", () => ({ FileTree: () => null }));

let container: HTMLDivElement;
let root: Root;
let props: ComponentProps<typeof Sidebar>;

function render() {
  root.render(createElement(Sidebar, props));
}

function card(): HTMLElement {
  return container.querySelector('[data-session-card="session-1"]')!;
}

function pressKey(target: HTMLElement, key: string) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  act(() => target.dispatchEvent(event));
  return event;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
    clear: () => stored.clear(),
  });
  props = {
    cwd: "/workspace/project",
    open: true,
    sessions: [
      {
        id: "session-1",
        cwd: "/workspace/project",
        harness: "codex",
        model: "",
        runtimeMode: "supervised",
        title: formatSessionTitle("codex", "Original conversation"),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
    busySessionIds: new Set(["session-1"]),
    approvalSessionIds: new Set(),
    activeSessionId: "session-1",
    status: "idle",
    pending: false,
    tab: "sessions",
    filesSearchOpen: false,
    onSelectSession: vi.fn(),
    onRenameSession: vi.fn((id: string, title: string) => {
      props = {
        ...props,
        sessions: props.sessions.map((session) =>
          session.id === id
            ? { ...session, title: formatSessionTitle(session.harness, title) }
            : session,
        ),
      };
      render();
    }),
    onOpenFile: vi.fn(),
    onTabChange: vi.fn(),
    onFilesSearchOpenChange: vi.fn(),
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("sidebar orchestration card", () => {
  it.each([false, true])(
    "keeps agents inside a distinct lead card (pinned=%s)",
    (pinned) => {
      props.onArchiveSession = vi.fn();
      const lead = {
        ...props.sessions[0],
        pinned,
        orchestration: {
          status: "active" as const,
          live: true,
          tasks: [
            {
              sessionId: "worker-a",
              title: "Build settings",
              harness: "codex" as const,
              model: "codex:worker-a",
              status: "running" as const,
            },
            {
              sessionId: "worker-b",
              title: "Review changes",
              harness: "claude" as const,
              model: "claude:worker-b",
              status: "running" as const,
              needsInput: true,
            },
            {
              sessionId: "worker-c",
              title: "Check types",
              harness: "codex" as const,
              model: "codex:worker-c",
              status: "completed" as const,
            },
          ],
        },
      };
      props.sessions = [
        lead,
        { ...props.sessions[0], id: "unrelated" },
        {
          ...props.sessions[0],
          id: "worker-a",
          orchestrationLeadId: lead.id,
        },
      ];
      act(() => render());
      expect(container.querySelectorAll("[data-session-card]")).toHaveLength(2);
      expect(card().dataset.orchestrationCard).toBe("true");
      // The lead card carries the sidebar's ordinary active treatment.
      expect(card().className).toContain("bg-content/10");
      // The lead names its own model, like every agent row beneath it.
      expect(card().textContent).toContain(
        resolveModel(lead.harness, lead.model).name,
      );
      expect(card().textContent).not.toContain("Orchestrator");
      expect(card().textContent).toContain("3 agents");
      expect(card().textContent).toContain("1/3 done");
      expect(card().textContent).toContain("Build settings");
      expect(card().textContent).toContain("Needs input");
      const archive = card().querySelector<HTMLButtonElement>(
        '[aria-label^="Archive "]',
      )!;
      expect(card().querySelectorAll('[aria-label^="Archive "]')).toHaveLength(
        1,
      );
      act(() => archive.click());
      expect(props.onArchiveSession).toHaveBeenCalledExactlyOnceWith(
        lead.id,
        true,
      );
      expect(props.onSelectSession).not.toHaveBeenCalled();
      // A collapsed row stays one line; the model rides along in the tooltip.
      expect(
        card()
          .querySelector('[data-orchestration-agent="worker-a"] button')
          ?.getAttribute("title"),
      ).toContain("codex:worker-a");
      expect(
        card().querySelectorAll("[data-orchestration-agent]"),
      ).toHaveLength(3);
      const normal = container.querySelector<HTMLElement>(
        '[data-session-card="unrelated"]',
      )!;
      expect(normal.hasAttribute("data-orchestration-card")).toBe(false);
      expect(normal.querySelector("[data-orchestration-agent]")).toBeNull();
      // Working the agents list is not a request to open the lead's tab: the
      // row expands in place and the card stays where it is.
      const agentRow = card().querySelector<HTMLButtonElement>(
        '[data-orchestration-agent="worker-a"] button',
      )!;
      expect(card().hasAttribute("role")).toBe(false);
      for (const action of card().querySelectorAll('button, [role="button"]')) {
        expect(
          action.parentElement?.closest('button, [role="button"]'),
        ).toBeNull();
      }
      const selection = card().querySelector<HTMLElement>(
        "[data-session-select]",
      )!;
      act(() => selection.focus());
      expect(document.activeElement).toBe(selection);
      expect(pressKey(selection, "Enter").defaultPrevented).toBe(true);
      expect(props.onSelectSession).toHaveBeenCalledWith(lead.id);
      vi.mocked(props.onSelectSession).mockClear();
      expect(pressKey(agentRow, "Enter").defaultPrevented).toBe(false);
      expect(props.onSelectSession).not.toHaveBeenCalled();
      const wasOpen = agentRow.getAttribute("aria-expanded");
      act(() => agentRow.click());
      expect(props.onSelectSession).not.toHaveBeenCalled();
      expect(
        card()
          .querySelector('[data-orchestration-agent="worker-a"] button')
          ?.getAttribute("aria-expanded"),
      ).not.toBe(wasOpen);
      // A blocked agent stays expanded while it needs the lead's attention.
      expect(
        card()
          .querySelector('[data-orchestration-agent="worker-b"] button')
          ?.getAttribute("aria-expanded"),
      ).toBe("true");
      props.approvalSessionIds = new Set([lead.id]);
      act(() => render());
      expect(card().className).toContain("border-dashed");
      expect(card().textContent).toContain("Needs input");
    },
  );

  it("renders saved worker details without claiming the workers are running", () => {
    props.busySessionIds = new Set();
    props.sessions[0].orchestration = {
      status: "active",
      tasks: [
        {
          sessionId: "worker",
          title: "Saved task",
          harness: "codex",
          model: "codex:test",
          status: "running",
        },
      ],
    };
    act(() => render());
    expect(card().textContent).toContain("Saved task");
    expect(card().textContent).toContain("Saved");
    expect(card().textContent).not.toContain("Working");
    expect(card().querySelector(".motion-safe\\:animate-pulse")).toBeNull();
  });
});

describe("orchestration in other workspace lists", () => {
  it.each(["project", "standalone"])(
    "groups workers in the inactive %s list",
    (kind) => {
      const lead = {
        ...props.sessions[0],
        id: "other-lead",
        cwd: "/workspace/other",
        orchestration: {
          status: "active" as const,
          tasks: [
            {
              sessionId: "other-worker",
              title: "Worker task",
              harness: "codex" as const,
              model: "codex:test",
              status: "running" as const,
            },
          ],
        },
      };
      const sessions = [
        lead,
        {
          ...lead,
          id: "other-worker",
          orchestration: undefined,
          orchestrationLeadId: lead.id,
        },
      ];
      if (kind === "project") {
        props.recents = [{ path: "/workspace/other", lastOpened: 1 }];
        props.projectSessions = { "/workspace/other": sessions };
        props.onSelectProjectSession = vi.fn();
      } else {
        props.standaloneSessions = sessions;
        props.onOpenStandalone = vi.fn();
      }
      act(() => render());
      if (kind === "project")
        act(() =>
          container
            .querySelector<HTMLButtonElement>(
              '[aria-label="Expand other tasks"]',
            )!
            .click(),
        );
      const other = container.querySelector<HTMLElement>(
        '[data-session-card="other-lead"]',
      )!;
      expect(other).not.toBeNull();
      expect(other.querySelectorAll("[data-orchestration-agent]")).toHaveLength(
        1,
      );
      expect(
        container.querySelector('[data-session-card="other-worker"]'),
      ).toBeNull();
      act(() =>
        other
          .querySelector<HTMLButtonElement>("[data-session-select]")!
          .click(),
      );
      if (kind === "project")
        expect(props.onSelectProjectSession).toHaveBeenCalledExactlyOnceWith(
          "/workspace/other",
          lead.id,
        );
      else expect(props.onSelectSession).toHaveBeenCalledWith(lead.id);
    },
  );
});

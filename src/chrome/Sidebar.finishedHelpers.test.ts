// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SessionSummary } from "../lib/sessionStore";
import { Sidebar, type SidebarProps } from "./Sidebar";

vi.mock("./TitleBar", () => ({
  DevModeSlot: () => null,
  TabVisitNav: () => null,
}));
vi.mock("./PersonalWorkspaceSwitcher", () => ({
  PersonalWorkspaceSwitcher: () => null,
  WorkspaceProfileIcon: () => null,
}));
vi.mock("./PersonalProjectRow", () => ({ PersonalProjectRow: () => null }));
vi.mock("./SidebarUpdate", () => ({ SidebarUpdateFooter: () => null }));
vi.mock("./SettingsRail", () => ({ SettingsNav: () => null }));

type Helper = NonNullable<SessionSummary["orchestration"]>["tasks"][number];
type Status = Helper["status"];

const cwd = "/tmp/sidebar-helpers";
const helper = (
  sessionId: string,
  status: Status,
  needsInput = false,
): Helper => ({
  sessionId,
  title: `${sessionId} changes`,
  harness: "claude",
  model: "opus",
  status,
  needsInput,
});

const chat = (id: string, helpers: Helper[]): SessionSummary => ({
  id,
  cwd,
  harness: "claude",
  model: "opus",
  runtimeMode: "supervised",
  title: `Chat ${id}`,
  createdAt: 1,
  updatedAt: 2,
  additions: 0,
  deletions: 0,
  orchestration: { status: "active", mode: "helpers", tasks: helpers },
});

let container: HTMLDivElement;
let root: Root;
let props: SidebarProps;

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
    clear: () => stored.clear(),
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  props = {
    cwd,
    open: true,
    sessions: [],
    busySessionIds: new Set(),
    approvalSessionIds: new Set(),
    status: "idle",
    pending: false,
    onSelectSession: vi.fn(),
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const draw = (patch: Partial<SidebarProps>) =>
  act(async () => root.render(createElement(Sidebar, { ...props, ...patch })));

const family = (id: string) =>
  container.querySelector<HTMLElement>(`[data-helper-family='${id}']`)!;
const rows = (id: string) =>
  [...family(id).querySelectorAll<HTMLElement>("[data-helper-row]")].map(
    (row) => row.dataset.helperRow,
  );
it("shows a helper while it works, waits, needs you or failed; finished ones leave", async () => {
  await draw({
    sessions: [
      chat("a", [
        helper("run", "running"),
        helper("ask", "completed", true),
        helper("bad", "failed"),
        helper("next", "queued"),
        helper("done", "completed"),
        helper("stop", "cancelled"),
      ]),
    ],
  });
  expect(rows("a")).toEqual(["run", "ask", "bad", "next"]);
  expect(container.textContent).not.toContain("finished");
});

it("leaves no helper rows once every helper finished", async () => {
  await draw({
    sessions: [
      chat("a", [helper("one", "completed"), helper("two", "cancelled")]),
    ],
  });
  expect(rows("a")).toEqual([]);
  expect(family("a").querySelector(".personal-helper-rows")).toBeNull();
});

it("keeps the row of a finished helper that is in front", async () => {
  const sessions = [
    chat("a", [helper("f", "completed"), helper("g", "completed")]),
  ];
  await draw({ sessions, activeSessionId: "f" });
  expect(rows("a")).toEqual(["f"]);
  await draw({ sessions, activeSessionId: "a" });
  expect(rows("a")).toEqual([]);
});

it("drops a helper's row when it finishes", async () => {
  await draw({ sessions: [chat("a", [helper("w", "running")])] });
  expect(rows("a")).toEqual(["w"]);
  await draw({ sessions: [chat("a", [helper("w", "completed")])] });
  expect(rows("a")).toEqual([]);
});

it("opens a helper's chat on click, as before", async () => {
  const onSelectSession = vi.fn();
  await draw({
    sessions: [chat("a", [helper("w", "running")])],
    onSelectSession,
  });
  await act(async () =>
    family("a")
      .querySelector<HTMLButtonElement>("[data-helper-row='w']")!
      .click(),
  );
  expect(onSelectSession).toHaveBeenCalled();
  expect(onSelectSession.mock.calls[0]![0]).toBe("w");
});

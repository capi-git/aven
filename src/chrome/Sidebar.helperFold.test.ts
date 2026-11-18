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
const fold = (id: string) =>
  family(id).querySelector<HTMLButtonElement>(`[data-helper-fold='${id}']`);

it("shows a helper while it works, waits, needs you or failed, and folds the finished ones", async () => {
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
  expect(fold("a")?.textContent).toBe("2 finished");
  expect(fold("a")?.getAttribute("aria-expanded")).toBe("false");
  // The working one shows its grey mark at its end; the asking one, Needs you.
  const run = family("a").querySelector("[data-helper-row='run']")!;
  expect(run.querySelector(".agent-mark")?.getAttribute("data-agent")).toBe(
    "working",
  );
  expect(run.querySelector(".agent-mark")?.hasAttribute("data-tone")).toBe(
    false,
  );
  expect(
    family("a").querySelector("[data-helper-row='ask'] [data-chat-status]")
      ?.textContent,
  ).toBe("Needs you");
});

it("says how many helpers finished when all of them did, and opens and closes them", async () => {
  await draw({
    sessions: [
      chat("b", [helper("one", "completed"), helper("two", "completed")]),
    ],
  });
  expect(rows("b")).toEqual([]);
  expect(fold("b")?.textContent).toBe("2 helpers · finished");
  await act(async () => fold("b")!.click());
  expect(fold("b")?.getAttribute("aria-expanded")).toBe("true");
  expect(rows("b")).toEqual(["one", "two"]);
  await act(async () => fold("b")!.click());
  expect(fold("b")?.getAttribute("aria-expanded")).toBe("false");
  expect(rows("b")).toEqual([]);
});

it("says one helper alone", async () => {
  await draw({ sessions: [chat("c", [helper("solo", "completed")])] });
  expect(fold("c")?.textContent).toBe("1 helper · finished");
});

it("shows no fold until a helper finishes", async () => {
  await draw({ sessions: [chat("d", [helper("live", "running")])] });
  expect(fold("d")).toBeNull();
  expect(rows("d")).toEqual(["live"]);
});

it("remembers an open fold for the session, after the row is drawn again", async () => {
  await draw({
    sessions: [chat("e", [helper("e1", "completed"), helper("e2", "failed")])],
  });
  await act(async () => fold("e")!.click());
  await act(async () => root.unmount());
  root = createRoot(container);
  await draw({
    sessions: [chat("e", [helper("e1", "completed"), helper("e2", "failed")])],
  });
  expect(fold("e")?.getAttribute("aria-expanded")).toBe("true");
  expect(rows("e")).toEqual(["e2", "e1"]);
});

it("opens the family of a finished helper that is in front", async () => {
  const sessions = [
    chat("f", [helper("f1", "completed"), helper("f2", "completed")]),
  ];
  await draw({ sessions, activeSessionId: "f" });
  expect(rows("f")).toEqual([]);
  await draw({ sessions, activeSessionId: "f2" });
  expect(fold("f")?.getAttribute("aria-expanded")).toBe("true");
  expect(
    family("f")
      .querySelector("[data-helper-row='f2']")
      ?.getAttribute("aria-current"),
  ).toBe("true");
  // It can still be closed by hand.
  await act(async () => fold("f")!.click());
  expect(rows("f")).toEqual([]);
});

it("opens a finished helper's chat on click, as before", async () => {
  await draw({ sessions: [chat("g", [helper("g1", "completed")])] });
  await act(async () => fold("g")!.click());
  await act(async () =>
    family("g")
      .querySelector<HTMLButtonElement>("[data-helper-row='g1']")!
      .click(),
  );
  expect(props.onSelectSession).toHaveBeenCalledWith("g1");
});

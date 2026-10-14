// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

type Handler = (event: { payload: unknown }) => void;
const native = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  unlistened: [] as string[],
  emit: vi.fn(async () => {}),
}));
function subscribe(event: string, handler: Handler) {
  native.handlers.set(event, handler);
  return Promise.resolve(() => {
    native.unlistened.push(event);
  });
}
vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, handler: Handler) => subscribe(event, handler),
  emit: native.emit,
}));
vi.mock("../lib/windowMenuEvents", () => ({
  listenInThisWindow: (event: string, handler: Handler) =>
    subscribe(event, handler),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main" }),
}));
vi.mock("../lib/updater", () => ({ runUpdateFlow: vi.fn() }));
vi.mock("../lib/uiScale", async (original) => ({
  ...(await original<typeof import("../lib/uiScale")>()),
  applyUiScale: vi.fn(async () => {}),
}));

import { NOTIFICATION_CLICK_EVENT } from "../lib/notifications";
import type { Session } from "../lib/session";
import {
  useWorkspaceShortcuts,
  type WorkspaceActions,
} from "./useWorkspaceShortcuts";

function fakeActions(): WorkspaceActions {
  const action = () => vi.fn();
  return {
    onNew: action(),
    onReopenClosedTab: vi.fn(async () => {}),
    onArchiveFocusedSession: action(),
    onCloseOtherTabs: action(),
    onClosePane: action(),
    onNext: action(),
    onPrev: action(),
    onVisitBack: action(),
    onVisitForward: action(),
    onActivate: action(),
    onSplit: action(),
    onFocusDir: action(),
    onToggleSidebar: action(),
    onToggleInspector: action(),
    onGoToFile: action(),
    onFindInProject: action(),
    onOpenSearch: action(),
    onOpenPalette: action(),
    onOpenInbox: action(),
    onOpenAutomations: action(),
    onOpenNotes: action(),
    pickProject: vi.fn(async () => {}),
    onNewTerminal: action(),
    onNewTerminalTab: action(),
    onToggleProjectTerminal: action(),
    onNavigateSessionList: action(),
    onNavigateProjectList: action(),
    openSettings: action(),
    onOpenApprovalSession: vi.fn(async () => true),
  };
}

const flag = (current: boolean) => ({ current });
let utility: { current: boolean };
let views: Parameters<typeof useWorkspaceShortcuts>[0]["utilityViews"];
let returned: { readonly current: WorkspaceActions };
let root: Root;
let host: HTMLElement;
let now = 1_000;

function Harness(props: { actions: WorkspaceActions }) {
  returned = useWorkspaceShortcuts({
    actions: props.actions,
    utilityViews: views,
    workspaceVisibleRef: flag(true),
    whatsNewVersionRef: { current: null },
    sessionsRef: { current: [{ id: "known" } as Session] },
  });
  return null;
}

async function render(actions: WorkspaceActions) {
  await act(async () => root.render(createElement(Harness, { actions })));
}

function press(key: string, mods: KeyboardEventInit = {}) {
  // Past the 80 ms repeat guard unless a test holds the clock.
  now += 1_000;
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      metaKey: true,
      bubbles: true,
      ...mods,
    }),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(performance, "now").mockImplementation(() => now);
  native.handlers.clear();
  native.unlistened = [];
  native.emit.mockClear();
  utility = flag(false);
  views = {
    settingsOpenRef: utility,
    searchViewOpenRef: flag(false),
    inboxViewOpenRef: flag(false),
    automationsViewOpenRef: flag(false),
    notesViewOpenRef: flag(false),
    filePickerOpenRef: flag(false),
    closeUtilityViews: vi.fn(),
    restoreReturnFocus: vi.fn(),
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("routes keys to the latest actions", async () => {
  const first = fakeActions();
  await render(first);
  press("p");
  expect(first.onGoToFile).toHaveBeenCalledTimes(1);
  press(",");
  expect(first.openSettings).toHaveBeenCalledTimes(1);
  press("k", { shiftKey: true });
  expect(first.onOpenSearch).toHaveBeenCalledTimes(1);

  const next = fakeActions();
  await render(next);
  press("p");
  expect(next.onGoToFile).toHaveBeenCalledTimes(1);
  expect(first.onGoToFile).toHaveBeenCalledTimes(1);
  expect(returned.current).toBe(next);
});

it("routes menu commands, and ignores the same command repeated within 80 ms", async () => {
  const actions = fakeActions();
  await render(actions);
  native.handlers.get("open_settings")!({ payload: undefined });
  expect(actions.openSettings).toHaveBeenCalledTimes(1);

  // A menu accelerator and its keydown can both arrive for one press.
  now += 1_000;
  native.handlers.get("new_tab")!({ payload: undefined });
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "t", metaKey: true, bubbles: true }),
  );
  expect(actions.onNew).toHaveBeenCalledTimes(1);
});

it("closes an open utility instead of the focused pane", async () => {
  const actions = fakeActions();
  await render(actions);
  utility.current = true;
  press("w");
  expect(actions.onClosePane).not.toHaveBeenCalled();
  expect(views.closeUtilityViews).toHaveBeenCalledTimes(1);
  expect(views.restoreReturnFocus).toHaveBeenCalledTimes(1);

  utility.current = false;
  press("w");
  expect(actions.onClosePane).toHaveBeenCalledTimes(1);
});

it("opens a clicked notification's chat in the window that has it", async () => {
  const actions = fakeActions();
  await render(actions);
  native.handlers.get(NOTIFICATION_CLICK_EVENT)!({ payload: "known" });
  expect(native.emit).toHaveBeenCalledWith(
    "monocode:notification-route-claim",
    "known",
  );
  expect(actions.onOpenApprovalSession).toHaveBeenCalledWith("known");
});

it("stops listening when the workspace goes away", async () => {
  await render(fakeActions());
  const events = [...native.handlers.keys()];
  act(() => root.unmount());
  await act(async () => {});
  expect(native.unlistened.sort()).toEqual(events.sort());
  root = createRoot(host);
});

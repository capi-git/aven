// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadWorkspaceTheme } from "../lib/workspaceThemes";
import { Sidebar, type SidebarProps } from "./Sidebar";

vi.mock("../lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/platform")>()),
  HAS_NATIVE_GLASS: true,
  IS_MAC: true,
}));
const idleUpdate = vi.hoisted(() => ({ phase: "idle", currentVersion: "0.1.41" }));
vi.mock("../lib/updater", () => ({
  readAppVersion: vi.fn().mockResolvedValue("0.1.41"),
  getUpdaterSnapshot: () => idleUpdate,
  subscribeUpdater: () => () => {},
  startAutomaticUpdates: () => () => {},
}));

let root: Root;
let container: HTMLDivElement;
const noop = () => {};
const props: SidebarProps = {
  cwd: "~",
  open: true,
  sessions: [],
  busySessionIds: new Set(),
  approvalSessionIds: new Set(),
  status: "idle",
  pending: false,
  onSelectSession: noop,
  onOpenFile: noop,
  tab: "sessions",
  onTabChange: noop,
  filesSearchOpen: false,
  onFilesSearchOpenChange: noop,
  onSelectProfile: noop,
};

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function button(label: string) {
  return document.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  )!;
}
async function click(target: HTMLElement) {
  await act(async () => {
    target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    target.click();
  });
}
function menu() {
  return document.querySelector<HTMLElement>('[role="menu"][aria-label="Switch workspace"]');
}

describe("sidebar workspace navigation", () => {
  it("switches profiles from the heading without changing appearance", async () => {
    const select = vi.fn();
    const before = loadWorkspaceTheme("personal");
    await act(async () => root.render(createElement(Sidebar, { ...props, onSelectProfile: select })));
    const trigger = button("Switch workspace, Personal");
    await click(trigger);
    expect(menu()).not.toBeNull();
    expect(menu()!.querySelectorAll('[role="menuitemradio"]')).toHaveLength(2);
    expect(document.querySelector('[aria-label^="Customize"]')).toBeNull();
    expect(document.querySelector('input[type="color"]')).toBeNull();
    const work = [...menu()!.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes("Work"))!;
    await click(work);
    expect(select).toHaveBeenCalledExactlyOnceWith("work");
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(loadWorkspaceTheme("personal")).toEqual(before);
    await act(async () => root.render(createElement(Sidebar, { ...props, activeProfileId: "work", onSelectProfile: select })));
    expect(button("Switch workspace, Work")).not.toBeNull();
  });

  it("closes when the heading is clicked again after pointer focus returns", async () => {
    await act(async () => root.render(createElement(Sidebar, props)));
    const trigger = button("Switch workspace, Personal");
    await click(trigger);
    expect(menu()).not.toBeNull();
    await act(async () => trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    await act(async () => trigger.focus());
    await act(async () => trigger.click());
    expect(menu()).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("exposes labeled Notes and Inbox shortcuts with current-page state and optional Notes", async () => {
    const notes = vi.fn(), inbox = vi.fn();
    const current = { ...props, onOpenNotes: notes, onOpenInbox: inbox, notesActive: true };
    await act(async () => root.render(createElement(Sidebar, current)));
    const library = container.querySelector('nav[aria-label="Library"]')!;
    const actions = [...library.querySelectorAll<HTMLButtonElement>("button")];
    expect(actions.map((item) => item.textContent)).toEqual(["Notes", "Inbox"]);
    expect(actions[0].getAttribute("aria-current")).toBe("page");
    expect(actions[1].title).toContain("GitHub");
    await click(actions[0]); await click(actions[1]);
    expect(notes).toHaveBeenCalledOnce(); expect(inbox).toHaveBeenCalledOnce();
    await act(async () => root.render(createElement(Sidebar, { ...current, notesEnabled: false, notesActive: false, inboxActive: true })));
    expect(library.querySelectorAll("button")).toHaveLength(1);
    expect(library.querySelector("button")?.getAttribute("aria-current")).toBe("page");
  });

  it("keeps appearance in Settings and clears the switcher when the sidebar hides", async () => {
    const section = vi.fn();
    await act(async () => root.render(createElement(Sidebar, props)));
    await click(button("Switch workspace, Personal"));
    expect(menu()).not.toBeNull();
    await act(async () => root.render(createElement(Sidebar, { ...props, open: false })));
    expect(menu()).toBeNull();
    await act(async () => root.render(createElement(Sidebar, { ...props, settingsOpen: true, onSelectSettingsSection: section, onCloseSettings: noop, onOpenInbox: noop, onOpenNotes: noop })));
    expect(container.querySelector('nav[aria-label="Library"]')).toBeNull();
    const appearance = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === "Appearance")!;
    await click(appearance);
    expect(section).toHaveBeenCalledExactlyOnceWith("appearance");
  });
});

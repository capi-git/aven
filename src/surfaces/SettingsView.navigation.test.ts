// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsView } from "./SettingsView";
import {
  loadFollowUpBehavior,
  loadNotesEnabled,
  type SettingsSectionId,
} from "../lib/settings";
import {
  loadWorkspaceTheme,
  saveWorkspaceTheme,
  useActivateWorkspaceTheme,
} from "../lib/workspaceThemes";

vi.mock("../lib/platform", async (original) => ({
  ...(await original<typeof import("../lib/platform")>()),
  IS_MAC: true,
  HAS_NATIVE_GLASS: true,
}));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke: vi.fn(async (command: string) => {
    if (command === "linear_status") return { connected: false };
    if (command === "notification_permission") return "unsupported";
    return undefined;
  }),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setZoom: vi.fn().mockResolvedValue(undefined) }),
}));
const idleUpdate = vi.hoisted(() => ({
  phase: "current",
  currentVersion: "0.1.80",
}));
vi.mock("../lib/updater", () => ({
  getUpdaterSnapshot: () => idleUpdate,
  subscribeUpdater: () => () => {},
  runUpdateFlow: vi.fn().mockResolvedValue(idleUpdate),
  installPendingUpdate: vi.fn().mockResolvedValue(idleUpdate),
}));
vi.mock("../lib/sounds", async (original) => ({
  ...(await original<typeof import("../lib/sounds")>()),
  playCue: vi.fn(),
}));

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();
const onSection = vi.fn();
const noop = () => {};
let externalSelectSection: (section: SettingsSectionId) => void;

function ControlledSettings({
  initial = "general",
}: {
  initial?: SettingsSectionId;
}) {
  const [section, setSection] = useState(initial);
  externalSelectSection = setSection;
  useActivateWorkspaceTheme("work");
  return createElement(SettingsView, {
    section,
    workspaceName: "Work",
    onSelectSection: (next) => {
      onSection(next);
      setSection(next);
    },
    cwd: "/fixture/project",
    sessions: [],
    besideRail: false,
    onClose,
    onOpenSession: noop,
    onArchiveSession: noop,
    onDeleteSession: noop,
    onOpenWhatsNew: noop,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  });
  saveWorkspaceTheme("work", {
    preference: "dark",
    opacity: 0.7,
    blur: 12,
    colors: {
      dark: { background: "#112233", accent: "#446688", highlight: "#aabbcc" },
    },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.documentElement.classList.remove(
    "theme-light",
    "match-workspace-panels",
  );
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(initial: SettingsSectionId = "general") {
  await act(async () =>
    root.render(createElement(ControlledSettings, { initial })),
  );
}

function searchInput() {
  return container.querySelector<HTMLInputElement>(
    'input[aria-label="Search settings"]',
  )!;
}

async function search(value: string) {
  const input = searchInput();
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}

async function key(target: HTMLElement, value: string) {
  await act(async () =>
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: value,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
}

async function click(target: HTMLElement) {
  expect(target).not.toBeNull();
  await act(async () => {
    target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    target.click();
  });
}

async function section(name: string) {
  await click(
    container.querySelector<HTMLButtonElement>(
      `nav[aria-label="Settings sections"] button[aria-label="${name}"]`,
    )!,
  );
}

function result(label: string) {
  return [
    ...container.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Settings search results"] button',
    ),
  ].find((button) => button.querySelector("strong")?.textContent === label)!;
}

describe("settings navigation", () => {
  it("opens a searched category and places keyboard focus at the requested setting", async () => {
    await mount();
    await search("match sidebars");
    await click(result("Match sidebars to workspace"));
    expect(onSection).toHaveBeenLastCalledWith("appearance");
    expect(container.querySelector("h1")?.textContent).toBe("Appearance");
    expect(searchInput().value).toBe("");
    expect(
      container.querySelector('[aria-label="Settings search results"]'),
    ).toBeNull();
    const destination = container.querySelector<HTMLElement>(
      "#setting-match-sidebars-to-workspace",
    )!;
    expect(destination).not.toBeNull();
    expect(
      document.activeElement === destination ||
        destination.contains(document.activeElement),
    ).toBe(true);
    // happy-dom permits focus on an ordinary div; real browsers require a
    // focusable element or an explicit programmatic tabindex destination.
    expect(
      document.activeElement?.matches(
        "button, input, select, textarea, a[href], [tabindex]",
      ),
    ).toBe(true);
    expect(destination.dataset.searchMatch).toBe("true");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("resets category scrolling but preserves the current position while editing search", async () => {
    await mount();
    const scroll = container.querySelector<HTMLElement>(".settings-scroll")!;
    scroll.scrollTop = 650;
    await search("color");
    expect(scroll.scrollTop).toBe(650);
    await section("Appearance");
    expect(scroll.scrollTop).toBe(0);
    scroll.scrollTop = 240;
    await section("General");
    expect(scroll.scrollTop).toBe(0);
    expect(container.querySelector("h1")?.textContent).toBe("General");
  });

  it("dismisses search when the external sidebar changes category without reviving an old focus destination", async () => {
    await mount();
    await search("match sidebars");
    await act(async () => externalSelectSection("appearance"));
    expect(container.querySelector("h1")?.textContent).toBe("Appearance");
    expect(searchInput().value).toBe("");
    expect(
      container.querySelector('[aria-label="Settings search results"]'),
    ).toBeNull();

    await search("follow-up behavior");
    await click(result("Follow-up behavior"));
    const destination = container.querySelector<HTMLElement>(
      "#setting-follow-up-behavior",
    )!;
    expect(
      document.activeElement === destination ||
        destination.contains(document.activeElement),
    ).toBe(true);
    expect(destination.dataset.searchMatch).toBe("true");

    await act(async () => externalSelectSection("appearance"));
    await act(async () => externalSelectSection("general"));
    const revisited = container.querySelector<HTMLElement>(
      "#setting-follow-up-behavior",
    )!;
    expect(revisited.dataset.searchMatch).toBeUndefined();
    expect(
      document.activeElement === revisited ||
        revisited.contains(document.activeElement),
    ).toBe(false);
    expect(
      container.querySelector<HTMLElement>(".settings-scroll")?.scrollTop,
    ).toBe(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("reaches custom search destinations as well as ordinary setting rows", async () => {
    await mount();
    for (const [label, category, id] of [
      ["Version", "General", "setting-version"],
      ["Linear API key", "General", "setting-linear-api-key"],
      ["Workspace palette", "Appearance", "setting-workspace-palette"],
      ["Workspace colors", "Appearance", "setting-workspace-colors"],
      ["Chat background", "Appearance", "setting-chat-background"],
      ["Keybindings", "Keybindings", "setting-keybindings"],
      ["Providers", "Providers", "setting-providers"],
      ["Archived projects", "Archive", "setting-archived-projects"],
      ["Archived conversations", "Archive", "setting-archived-conversations"],
    ]) {
      await search(label);
      await click(result(label));
      expect(container.querySelector("h1")?.textContent, label).toBe(category);
      const destination = container.querySelector<HTMLElement>(`#${id}`)!;
      expect(destination, label).not.toBeNull();
      expect(
        document.activeElement === destination ||
          destination.contains(document.activeElement),
        label,
      ).toBe(true);
      expect(
        document.activeElement?.matches(
          "button, input, select, textarea, a[href], [tabindex]",
        ),
        label,
      ).toBe(true);
    }
    expect(onClose).not.toHaveBeenCalled();
  });

  it("moves down into search results and uses Escape to clear search before closing", async () => {
    await mount();
    const input = await search("theme");
    await key(input, "ArrowDown");
    const first = container.querySelector<HTMLButtonElement>(
      '[aria-label="Settings search results"] button',
    )!;
    expect(document.activeElement).toBe(first);
    await key(first, "Escape");
    expect(searchInput().value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(onClose).not.toHaveBeenCalled();
    await key(input, "Escape");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("dismisses search on an outside pointer click while leaving Settings and the category open", async () => {
    await mount();
    await search("theme");
    const heading = container.querySelector<HTMLElement>("h1")!;
    await click(heading);
    expect(searchInput().value).toBe("");
    expect(
      container.querySelector('[aria-label="Settings search results"]'),
    ).toBeNull();
    expect(heading.textContent).toBe("General");
    expect(onSection).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("dismisses search before Settings when keyboard focus has moved outside the results", async () => {
    await mount();
    await search("theme");
    const setting = container.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Notes"]',
    )!;
    // Moving with the keyboard does not fire an outside pointer event.
    setting.focus();
    await key(setting, "Escape");
    expect(searchInput().value).toBe("");
    expect(document.activeElement).toBe(searchInput());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps focus in search when dismissing a new query after opening an earlier result", async () => {
    await mount();
    await search("follow-up behavior");
    await click(result("Follow-up behavior"));
    const earlierDestination = container.querySelector<HTMLElement>(
      "#setting-follow-up-behavior",
    )!;
    expect(earlierDestination.dataset.searchMatch).toBe("true");

    const input = await search("theme");
    await key(input, "Escape");
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(earlierDestination.dataset.searchMatch).toBeUndefined();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("leaves Escape to an open dialog before dismissing Settings", async () => {
    await mount();
    await search("theme");
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.tabIndex = -1;
    document.body.append(dialog);
    try {
      await key(dialog, "Escape");
      expect(searchInput().value).toBe("theme");
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      dialog.remove();
    }
    await key(searchInput(), "Escape");
    expect(searchInput().value).toBe("");
    expect(onClose).not.toHaveBeenCalled();
    await key(searchInput(), "Escape");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("announces unmatched searches without changing category or saved values", async () => {
    await mount();
    const before = loadWorkspaceTheme("work");
    await search("notarealsettingxyz");
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "No matching settings",
    );
    expect(
      container.querySelectorAll(
        '[aria-label="Settings search results"] button',
      ),
    ).toHaveLength(0);
    expect(container.querySelector("h1")?.textContent).toBe("General");
    expect(onSection).not.toHaveBeenCalled();
    expect(loadWorkspaceTheme("work")).toEqual(before);
  });

  it("retains saved task behavior and workspace appearance across category navigation", async () => {
    await mount();
    const notes = container.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Notes"]',
    )!;
    expect(notes.getAttribute("aria-checked")).toBe("true");
    await click(notes);
    expect(loadNotesEnabled()).toBe(false);
    const steer = [
      ...container.querySelectorAll<HTMLButtonElement>(
        '[role="radiogroup"][aria-label="Follow-up behavior"] [role="radio"]',
      ),
    ].find((button) => button.textContent === "Steer")!;
    await click(steer);
    expect(loadFollowUpBehavior()).toBe("steer");
    await section("Appearance");
    await click(
      container.querySelector<HTMLButtonElement>(
        '[role="switch"][aria-label="Match sidebars to workspace"]',
      )!,
    );
    const appearance = loadWorkspaceTheme("work");
    expect(appearance.matchPanels).toBe(true);
    expect(appearance.colors?.dark?.background).toBe("#112233");
    await section("Keybindings");
    await section("General");
    expect(
      container
        .querySelector('[role="switch"][aria-label="Notes"]')
        ?.getAttribute("aria-checked"),
    ).toBe("false");
    expect(loadFollowUpBehavior()).toBe("steer");
    await section("Appearance");
    expect(loadWorkspaceTheme("work")).toEqual(appearance);
    expect(
      container
        .querySelector(
          '[role="switch"][aria-label="Match sidebars to workspace"]',
        )
        ?.getAttribute("aria-checked"),
    ).toBe("true");
  });
});

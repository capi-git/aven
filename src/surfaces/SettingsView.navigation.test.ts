// @vitest-environment happy-dom
import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsView } from "./SettingsView";
import { SettingsNav } from "../chrome/SettingsRail";
import {
  loadFollowUpBehavior,
  loadNotesEnabled,
  loadBrowserMemorySaver,
  saveBrowserMemorySaver,
  subscribeBrowserMemorySaver,
  type SettingsSectionId,
} from "../lib/settings";
import { loadGitFinishBehavior } from "../lib/gitPreference";
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
  developmentBuild: false,
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
  showToolbar,
  besideRail = false,
}: {
  initial?: SettingsSectionId;
  showToolbar?: boolean;
  besideRail?: boolean;
}) {
  const [section, setSection] = useState(initial);
  externalSelectSection = setSection;
  useActivateWorkspaceTheme("work");
  const onSelect = (next: SettingsSectionId) => {
    onSection(next);
    setSection(next);
  };
  const view = createElement(SettingsView, {
    section,
    workspaceName: "Work",
    onSelectSection: onSelect,
    cwd: "/fixture/project",
    sessions: [],
    besideRail,
    showToolbar,
    onClose,
    onOpenSession: noop,
    onArchiveSession: noop,
    onDeleteSession: noop,
    onOpenWhatsNew: noop,
  });
  if (!besideRail) return view;
  // Beside the rail, the app's project rail hosts the navigation and search,
  // wired to the same section callback as the settings page.
  return createElement(
    Fragment,
    null,
    createElement(
      "aside",
      { "data-testid": "project-rail" },
      createElement(SettingsNav, {
        section,
        onSelect,
        onClose: () => onClose(),
      }),
    ),
    view,
  );
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

async function mount(
  initial: SettingsSectionId = "general",
  besideRail = false,
) {
  await act(async () =>
    root.render(createElement(ControlledSettings, { initial, besideRail })),
  );
}

function searchInput() {
  const inputs = container.querySelectorAll<HTMLInputElement>(
    'input[aria-label="Search settings"]',
  );
  expect(inputs).toHaveLength(1);
  return inputs[0];
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

function sectionList() {
  return container.querySelector<HTMLElement>(
    'nav[aria-label="Settings sections"]',
  );
}

function resultList() {
  return container.querySelector<HTMLElement>(
    'nav[aria-label="Settings search results"]',
  );
}

async function section(name: string) {
  await click(
    sectionList()!.querySelector<HTMLButtonElement>(
      `button[aria-label="${name}"]`,
    )!,
  );
}

function result(label: string) {
  return [
    ...container.querySelectorAll<HTMLButtonElement>(
      'nav[aria-label="Settings search results"] button',
    ),
  ].find(
    (button) =>
      button.querySelector(".settings-nav__label")?.textContent === label,
  )!;
}

function focusIsWithin(element: HTMLElement) {
  return (
    document.activeElement === element ||
    element.contains(document.activeElement)
  );
}

describe("settings navigation", () => {
  it("retains its own toolbar and close action when no host supplies one", async () => {
    await mount("appearance");
    const toolbar = container.querySelector(".settings-toolbar")!;
    expect(toolbar).not.toBeNull();
    expect(
      toolbar.querySelector(".settings-breadcrumb")?.textContent,
    ).toContain("Appearance");
    await click(
      toolbar.querySelector<HTMLButtonElement>(
        'button[aria-label="Close settings"]',
      )!,
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    "omits the hosted toolbar while preserving settings navigation and Escape with besideRail=%s",
    async (besideRail) => {
      await act(async () =>
        root.render(
          createElement(ControlledSettings, {
            initial: "general",
            showToolbar: false,
            besideRail,
          }),
        ),
      );
      expect(container.querySelector(".settings-toolbar")).toBeNull();
      expect(
        container.querySelector('button[aria-label="Close settings"]'),
      ).toBeNull();
      expect(
        container.querySelector('[role="region"][aria-label="Settings"]'),
      ).not.toBeNull();
      expect(container.querySelector("h1")?.textContent).toBe("General");
      // Exactly one navigation: the page's own, or the rail's beside it.
      expect(
        container.querySelectorAll('nav[aria-label="Settings sections"]'),
      ).toHaveLength(1);
      expect(
        container.querySelector(
          '[role="region"][aria-label="Settings"] nav[aria-label="Settings sections"]',
        ) === null,
      ).toBe(besideRail);

      await section("Appearance");
      expect(onSection).toHaveBeenLastCalledWith("appearance");
      expect(container.querySelector("h1")?.textContent).toBe("Appearance");
      expect(
        sectionList()
          ?.querySelector('[aria-current="page"]')
          ?.getAttribute("aria-label"),
      ).toBe("Appearance");
      await key(searchInput(), "Escape");
      expect(onClose).toHaveBeenCalledOnce();
    },
  );

  it("describes source rebuilds rather than automatic releases in Aven Dev", async () => {
    idleUpdate.developmentBuild = true;
    try {
      await mount();
      const version = container.querySelector("#setting-version")!;
      expect(version.textContent).toContain("Rebuild and restart this preview");
      expect(version.textContent).toContain("Development info");
      expect(version.textContent).not.toContain(
        "Updates download automatically",
      );
      expect(version.textContent).not.toContain("Check for updates");
    } finally {
      idleUpdate.developmentBuild = false;
    }
  });

  it("groups the sections under five labels in order", async () => {
    await mount();
    expect(
      [...sectionList()!.querySelectorAll(".settings-nav__group")].map(
        (group) => group.textContent,
      ),
    ).toEqual(["Personal", "Agents", "Coding", "Integrations", "Archived"]);
    expect(
      [...sectionList()!.querySelectorAll("button")].map((button) =>
        button.getAttribute("aria-label"),
      ),
    ).toEqual([
      "General",
      "Appearance",
      "Notifications",
      "Keyboard shortcuts",
      "Provider setup",
      "Providers & models",
      "Tasks & review",
      "Skills & tools",
      "Git",
      "Connections",
      "Browser",
      "Archive",
    ]);
  });

  it.each([false, true])(
    "opens a searched category and places keyboard focus at the requested setting with besideRail=%s",
    async (besideRail) => {
      await mount("general", besideRail);
      await search("match sidebars");
      await click(result("Match sidebars to workspace"));
      expect(onSection).toHaveBeenLastCalledWith("appearance");
      expect(container.querySelector("h1")?.textContent).toBe("Appearance");
      expect(searchInput().value).toBe("");
      expect(resultList()).toBeNull();
      expect(sectionList()).not.toBeNull();
      const destination = container.querySelector<HTMLElement>(
        "#setting-match-sidebars-to-workspace",
      )!;
      expect(destination).not.toBeNull();
      expect(focusIsWithin(destination)).toBe(true);
      // happy-dom permits focus on an ordinary div; real browsers require a
      // focusable element or an explicit programmatic tabindex destination.
      expect(
        document.activeElement?.matches(
          "button, input, select, textarea, a[href], [tabindex]",
        ),
      ).toBe(true);
      expect(destination.dataset.searchMatch).toBe("true");
      expect(onClose).not.toHaveBeenCalled();
    },
  );

  it("finds the Git setting for a pull request search and focuses its row", async () => {
    await mount();
    await search("pull request");
    const git = result("When an agent finishes");
    expect(git).toBeDefined();
    expect(git.querySelector("small")?.textContent).toBe("Git");
    await click(git);
    expect(onSection).toHaveBeenLastCalledWith("git");
    expect(container.querySelector("h1")?.textContent).toBe("Git");
    const row = container.querySelector<HTMLElement>(
      "#setting-when-an-agent-finishes",
    )!;
    expect(row).not.toBeNull();
    expect(focusIsWithin(row)).toBe(true);
    expect(row.dataset.searchMatch).toBe("true");

    const select = () =>
      container.querySelector<HTMLButtonElement>(
        '#setting-when-an-agent-finishes [role="combobox"][aria-label="When an agent finishes"]',
      )!;
    expect(select().textContent).toBe("Follow the project");
    await key(select(), "End");
    await key(select(), "Enter");
    expect(loadGitFinishBehavior()).toBe("pr");
    expect(localStorage.getItem("aven.gitFinishBehavior")).toBe("pr");
    await section("General");
    await section("Git");
    expect(select().textContent).toBe("Open a pull request");
    await key(select(), "Home");
    await key(select(), "Enter");
    expect(localStorage.getItem("aven.gitFinishBehavior")).toBeNull();
    expect(select().textContent).toBe("Follow the project");
  });

  it("resets category scrolling but preserves the current position while editing search", async () => {
    await mount();
    const scroll = container.querySelector<HTMLElement>(".settings-scroll")!;
    scroll.scrollTop = 650;
    const input = await search("color");
    expect(scroll.scrollTop).toBe(650);
    await key(input, "Escape");
    expect(scroll.scrollTop).toBe(650);
    await section("Appearance");
    expect(scroll.scrollTop).toBe(0);
    scroll.scrollTop = 240;
    await section("General");
    expect(scroll.scrollTop).toBe(0);
    expect(container.querySelector("h1")?.textContent).toBe("General");
  });

  it("keeps an unpicked search when the external sidebar changes category without reviving an old focus destination", async () => {
    await mount();
    await search("follow-up behavior");
    await click(result("Follow-up behavior"));
    const destination = container.querySelector<HTMLElement>(
      "#setting-follow-up-behavior",
    )!;
    expect(focusIsWithin(destination)).toBe(true);
    expect(destination.dataset.searchMatch).toBe("true");

    await act(async () => externalSelectSection("appearance"));
    await act(async () => externalSelectSection("tasks"));
    const revisited = container.querySelector<HTMLElement>(
      "#setting-follow-up-behavior",
    )!;
    expect(revisited.dataset.searchMatch).toBeUndefined();
    expect(focusIsWithin(revisited)).toBe(false);
    expect(
      container.querySelector<HTMLElement>(".settings-scroll")?.scrollTop,
    ).toBe(0);

    // An unpicked query stays put across an external change and names no
    // destination until a result is picked.
    await search("match sidebars");
    await act(async () => externalSelectSection("appearance"));
    expect(container.querySelector("h1")?.textContent).toBe("Appearance");
    expect(searchInput().value).toBe("match sidebars");
    expect(resultList()).not.toBeNull();
    const unpicked = container.querySelector<HTMLElement>(
      "#setting-match-sidebars-to-workspace",
    )!;
    expect(unpicked.dataset.searchMatch).toBeUndefined();
    expect(focusIsWithin(unpicked)).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("reaches custom search destinations as well as ordinary setting rows", async () => {
    await mount();
    for (const [label, category, id] of [
      ["Version", "General", "setting-version"],
      ["Memory saver", "Browser", "setting-memory-saver"],
      ["Linear API key", "Connections", "setting-linear-api-key"],
      ["Agent connections", "Connections", "setting-agent-connections"],
      ["Workspace colors", "Appearance", "setting-workspace-colors"],
      ["Chat background", "Appearance", "setting-chat-background"],
      ["Keybindings", "Keyboard shortcuts", "setting-keybindings"],
      ["Providers", "Providers & models", "setting-providers"],
      ["When an agent finishes", "Git", "setting-when-an-agent-finishes"],
      ["Archived projects", "Archive", "setting-archived-projects"],
      ["Archived conversations", "Archive", "setting-archived-conversations"],
    ]) {
      await search(label);
      await click(result(label));
      expect(container.querySelector("h1")?.textContent, label).toBe(category);
      const destination = container.querySelector<HTMLElement>(`#${id}`)!;
      expect(destination, label).not.toBeNull();
      expect(focusIsWithin(destination), label).toBe(true);
      expect(
        document.activeElement?.matches(
          "button, input, select, textarea, a[href], [tabindex]",
        ),
        label,
      ).toBe(true);
    }
    expect(onClose).not.toHaveBeenCalled();
  });

  it("refocuses a setting picked again from a new search", async () => {
    await mount();
    await search("follow-up behavior");
    await click(result("Follow-up behavior"));
    const destination = () =>
      container.querySelector<HTMLElement>("#setting-follow-up-behavior")!;
    expect(focusIsWithin(destination())).toBe(true);

    await search("follow-up behavior");
    expect(focusIsWithin(destination())).toBe(false);
    await click(result("Follow-up behavior"));
    expect(focusIsWithin(destination())).toBe(true);
    expect(destination().dataset.searchMatch).toBe("true");
  });

  it("moves down into search results and uses Escape to clear search before closing", async () => {
    await mount();
    const input = await search("theme");
    await key(input, "ArrowDown");
    const first = container.querySelector<HTMLButtonElement>(
      'nav[aria-label="Settings search results"] button',
    )!;
    expect(document.activeElement).toBe(first);
    await key(first, "Escape");
    expect(searchInput().value).toBe("");
    expect(resultList()).toBeNull();
    expect(document.activeElement).toBe(input);
    expect(onClose).not.toHaveBeenCalled();
    await key(input, "Escape");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("replaces the section list with results until the query is cleared, without outside-click dismissal", async () => {
    await mount("appearance");
    const input = await search("theme");
    expect(sectionList()).toBeNull();
    const results = resultList()!;
    expect(results).not.toBeNull();
    const buttons = results.querySelectorAll("button");
    expect(buttons.length).toBeGreaterThan(0);
    expect(results.querySelector('[role="status"]')?.textContent).toBe(
      `${buttons.length} ${buttons.length === 1 ? "setting" : "settings"}`,
    );

    // Pointer presses elsewhere no longer dismiss the results.
    const heading = container.querySelector<HTMLElement>("h1")!;
    await click(heading);
    expect(input.value).toBe("theme");
    expect(resultList()).not.toBeNull();
    expect(heading.textContent).toBe("Appearance");

    await search("");
    expect(resultList()).toBeNull();
    expect(
      sectionList()
        ?.querySelector('[aria-current="page"]')
        ?.getAttribute("aria-label"),
    ).toBe("Appearance");
    expect(onSection).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("clears rail search results with Escape before the hosted Settings closes", async () => {
    await mount("general", true);
    const input = await search("theme");
    await key(input, "ArrowDown");
    const first = resultList()!.querySelector<HTMLButtonElement>("button")!;
    expect(document.activeElement).toBe(first);
    await key(first, "Escape");
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(onClose).not.toHaveBeenCalled();

    await search("theme");
    await key(input, "Escape");
    expect(input.value).toBe("");
    expect(sectionList()).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await key(input, "Escape");
    expect(onClose).toHaveBeenCalledOnce();
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
    expect(container.querySelector("h1")?.textContent).toBe("Tasks & review");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("clears open search results before closing when Escape comes from the page", async () => {
    await mount("tasks", true);
    await search("theme");
    const row = container.querySelector<HTMLElement>(
      "#setting-follow-up-behavior",
    )!;
    row.focus();
    await key(row, "Escape");
    expect(searchInput().value).toBe("");
    expect(sectionList()).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await key(row, "Escape");
    expect(onClose).toHaveBeenCalledOnce();
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
        'nav[aria-label="Settings search results"] button',
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
    await section("Tasks & review");
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
    await section("Keyboard shortcuts");
    await section("Git");
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

  it("explains memory saver, retains the opt-out, and reflects changes from another window", async () => {
    await mount("browser");
    const toggle = () =>
      container.querySelector<HTMLButtonElement>(
        '[role="switch"][aria-label="Memory saver"]',
      )!;
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    expect(
      container.querySelector("#setting-memory-saver")?.textContent,
    ).toContain(
      "Keep your three most recent browser tabs ready. Older inactive tabs can sleep after five minutes and reload when reopened. Pages in use stay awake.",
    );
    await click(toggle());
    expect(loadBrowserMemorySaver()).toBe(false);
    await section("Appearance");
    await section("Browser");
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    await act(async () => saveBrowserMemorySaver(true));
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    localStorage.setItem("aven.browserMemorySaver", "0");
    await act(async () =>
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "aven.browserMemorySaver",
          newValue: "0",
        }),
      ),
    );
    expect(toggle().getAttribute("aria-checked")).toBe("false");

    const listener = vi.fn();
    const unsubscribe = subscribeBrowserMemorySaver(listener);
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
    expect(listener).not.toHaveBeenCalled();
    await act(async () => {
      localStorage.removeItem("aven.browserMemorySaver");
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    unsubscribe();
    await act(async () => saveBrowserMemorySaver(false));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

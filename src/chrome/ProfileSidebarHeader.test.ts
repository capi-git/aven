// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WORKSPACE_PROFILES } from "../lib/workspaceProfiles";
import { ProfileSidebarHeader, SEARCH_KEYS } from "./ProfileSidebarHeader";

type Props = ComponentProps<typeof ProfileSidebarHeader>;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const everything = (patch: Partial<Props> = {}): Props => ({
  profile: DEFAULT_WORKSPACE_PROFILES[0],
  onOpenHome: vi.fn(),
  onMenuChange: vi.fn(),
  showNewSession: true,
  onNewSession: vi.fn(),
  showSearch: true,
  onSearch: vi.fn(),
  showNotes: true,
  onOpenNotes: vi.fn(),
  showInbox: true,
  onOpenInbox: vi.fn(),
  showAutomations: true,
  onOpenAutomations: vi.fn(),
  ...patch,
});

const render = (props: Props) =>
  act(async () => root.render(createElement(ProfileSidebarHeader, props)));

describe("the workspace row", () => {
  it("opens Home from the name, the workspace menu from its chevron and a new chat from +", async () => {
    const props = everything({ homeActive: true });
    await render(props);
    const header = host.querySelector(".personal-profile-header")!;
    const [home, picker, add] = [
      ...header.querySelectorAll<HTMLButtonElement>("button"),
    ];
    expect(home.getAttribute("aria-label")).toBe("Home, Personal workspace");
    expect(home.textContent).toBe("Personal");
    expect(home.getAttribute("aria-current")).toBe("page");
    expect(picker.getAttribute("aria-label")).toBe(
      "Switch workspace, Personal",
    );
    expect(picker.getAttribute("aria-haspopup")).toBe("menu");
    expect(add.getAttribute("aria-label")).toBe("New chat without a project");
    expect(add.title).toBe("New chat");

    await act(async () => home.click());
    expect(props.onOpenHome).toHaveBeenCalledOnce();
    await act(async () => picker.click());
    expect(props.onMenuChange).toHaveBeenCalledWith(picker);
    await act(async () => add.click());
    expect(props.onNewSession).toHaveBeenCalledOnce();

    // The menu also opens from the name with the arrow keys, anchored on the
    // chevron, as a menu button's would.
    await act(async () => {
      home.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    expect(props.onMenuChange).toHaveBeenLastCalledWith(picker);
  });

  it("marks Home only while it is on screen and holds New chat while one starts", async () => {
    await render(everything({ startingNewSession: true }));
    const home = host.querySelector<HTMLButtonElement>(
      ".personal-profile-name",
    )!;
    expect(home.hasAttribute("aria-current")).toBe(false);
    const add = host.querySelector<HTMLButtonElement>(".personal-profile-new")!;
    expect(add.disabled).toBe(true);
    expect(add.title).toBe("Starting…");
  });

  it("opens the workspace's actions on right-click of its name or chevron", async () => {
    const onWorkspaceMenu = vi.fn();
    const props = everything({ onWorkspaceMenu });
    await render(props);
    for (const target of host.querySelectorAll<HTMLButtonElement>(
      ".personal-profile-name, .personal-profile-picker",
    )) {
      await act(async () => {
        target.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: 12,
            clientY: 34,
          }),
        );
      });
    }
    expect(onWorkspaceMenu).toHaveBeenCalledTimes(2);
    expect(onWorkspaceMenu).toHaveBeenCalledWith(12, 34);
  });
});

describe("Search and the pinned tiles", () => {
  const tiles = () => [
    ...host.querySelectorAll<HTMLButtonElement>(
      'nav[aria-label="Library"] > button',
    ),
  ];
  const search = () =>
    host.querySelector<HTMLButtonElement>("button.personal-search-field");

  it("pins Notes, Inbox and Automations as a row of tiles, named by their labels", async () => {
    await render(everything({ notesActive: true }));
    const buttons = tiles();
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Notes",
      "Inbox",
      "Automations",
    ]);
    for (const button of buttons) {
      // The name is the accessible name and leads the tooltip, but only the
      // icon is drawn.
      const name = button.textContent!;
      expect(button.title.startsWith(`${name}:`)).toBe(true);
      expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
        "true",
      );
      expect(button.querySelector("span")?.className).toBe("sr-only");
    }
    expect(
      buttons.map((button) => button.getAttribute("aria-current")),
    ).toEqual(["page", null, null]);
    expect(buttons[1].title).toContain("GitHub");
    expect(buttons[2].title).toContain("schedule");
  });

  it("puts Search above the tiles as a field, with its real keys, ⇧⌘K (⌘K is the palette)", async () => {
    const props = everything({ searchActive: true });
    await render(props);
    const field = search()!;
    expect(field.getAttribute("aria-label")).toBe("Search");
    expect(field.textContent).toContain("Search");
    expect(field.querySelector("kbd")?.textContent).toBe(SEARCH_KEYS);
    expect(field.getAttribute("aria-keyshortcuts")).toMatch(/Shift\+.*K/);
    expect(field.title).toContain(SEARCH_KEYS);
    expect(field.getAttribute("aria-current")).toBe("page");
    // The field comes right after the workspace's row, then the tiles.
    expect(field.previousElementSibling?.className).toBe(
      "personal-profile-header",
    );
    expect(field.nextElementSibling?.getAttribute("aria-label")).toBe(
      "Library",
    );
    await act(async () => field.click());
    expect(props.onSearch).toHaveBeenCalledOnce();
  });

  it("counts unread automation runs in a small badge on its tile, and speaks the count", async () => {
    await render(everything({ automationsUnread: 3 }));
    const automations = tiles()[2];
    expect(
      automations.querySelector(".personal-library-count")?.textContent,
    ).toBe("3");
    expect(automations.textContent).toBe("Automations3, 3 new");
    await render(everything({ automationsUnread: 0 }));
    expect(tiles()[2].querySelector(".personal-library-count")).toBeNull();
    expect(tiles()[2].textContent).toBe("Automations");
    await render(everything({ automationsUnread: 140 }));
    expect(
      tiles()[2].querySelector(".personal-library-count")?.textContent,
    ).toBe("99+");
  });

  it("runs each tile's action and leaves out tiles that are off", async () => {
    const props = everything();
    await render(props);
    for (const button of tiles()) await act(async () => button.click());
    expect(props.onOpenNotes).toHaveBeenCalledOnce();
    expect(props.onOpenInbox).toHaveBeenCalledOnce();
    expect(props.onOpenAutomations).toHaveBeenCalledOnce();
    await render(everything({ showNotes: false, showInbox: false }));
    expect(tiles().map((button) => button.textContent)).toEqual([
      "Automations",
    ]);
    await render(
      everything({
        showSearch: false,
        showNotes: false,
        showInbox: false,
        showAutomations: false,
      }),
    );
    expect(host.querySelector('nav[aria-label="Library"]')).toBeNull();
    expect(search()).toBeNull();
  });

  it("puts every control in the Tab order, top to bottom", async () => {
    await render(everything());
    const order = [...host.querySelectorAll<HTMLButtonElement>("button")];
    expect(
      order.map(
        (button) => button.getAttribute("aria-label") ?? button.textContent,
      ),
    ).toEqual([
      "Home, Personal workspace",
      "Switch workspace, Personal",
      "New chat without a project",
      "Search",
      "Notes",
      "Inbox",
      "Automations",
    ]);
    for (const button of order) {
      expect(button.tabIndex).not.toBe(-1);
      expect(button.disabled).toBe(false);
    }
  });

  it("draws a preview page with the same field and tiles and no controls", () => {
    const preview = document.createElement("div");
    preview.innerHTML = renderToStaticMarkup(
      createElement(ProfileSidebarHeader, everything({ preview: true })),
    );
    expect(preview.querySelector("button")).toBeNull();
    expect(
      [...preview.querySelectorAll(".personal-library-tile")].map(
        (tile) => tile.textContent,
      ),
    ).toEqual(["Notes", "Inbox", "Automations"]);
    expect(preview.querySelector(".personal-search-field")).not.toBeNull();
    expect(preview.querySelector(".personal-profile-name")?.textContent).toBe(
      "Personal",
    );
    expect(preview.querySelector(".personal-profile-new")).not.toBeNull();
  });
});

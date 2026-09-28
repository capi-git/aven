// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { WorkspaceMenuPanelContent } from "./WorkspaceMenuPanel";

it("focuses enabled actions and navigates past unavailable destinations", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const select = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(WorkspaceMenuPanelContent, {
          snapshot: {
            title: "Open workspace",
            theme: {
              mode: "light",
              background: "#faf4e6",
              accent: "#8f6b25",
              text: "#181818",
            },
            items: [
              { id: "editor", label: "Editor" },
              { id: "folder", label: "Folder", disabled: true },
              { id: "terminal", label: "Terminal" },
            ],
          },
          onSelect: select,
          onClose: vi.fn(),
        }),
      ),
    );
    expect(host.querySelector("input")).toBeNull();
    expect(document.activeElement?.textContent).toBe("Editor");
    await act(async () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
    );
    expect(document.activeElement?.textContent).toBe("Terminal");
    await act(async () =>
      (document.activeElement as HTMLButtonElement).click(),
    );
    expect(select).toHaveBeenCalledExactlyOnceWith("terminal");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("searches labels and paths, keeps caret keys, and opens only enabled filtered results", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const select = vi.fn();
  const close = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(WorkspaceMenuPanelContent, {
          snapshot: {
            title: "Recent tabs",
            compact: true,
            searchable: true,
            theme: { mode: "dark", accent: "#99bbdd" },
            items: [
              {
                id: "app",
                label: "App.tsx",
                description: "src/workspace",
                separatorBefore: true,
              },
              { id: "test", label: "App.test.tsx", description: "tests" },
              { id: "settings", label: "Settings.tsx", disabled: true },
              { id: "browser", label: "Browser" },
            ],
          },
          onSelect: select,
          onClose: close,
        }),
      ),
    );
    const input = host.querySelector<HTMLInputElement>("input")!;
    const type = async (value: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    const key = async (value: string) => {
      const event = new KeyboardEvent("keydown", {
        key: value,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => document.activeElement?.dispatchEvent(event));
      return event;
    };
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("aria-label")).toBe("Search Recent tabs");
    expect(host.querySelector('[role="status"]')?.textContent).toBe("4 items");
    await type(" APP src ");
    expect(host.querySelectorAll('[role="menuitem"]')).toHaveLength(1);
    expect(host.querySelector('[role="menuitem"]')?.textContent).toContain(
      "App.tsx",
    );
    expect(host.querySelector('[role="separator"]')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toBe("1 of 4");
    expect((await key("Home")).defaultPrevented).toBe(false);
    expect((await key("End")).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(input);
    for (const options of [{ metaKey: true }, { isComposing: true }]) {
      const event = new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
        ...options,
      });
      await act(async () => input.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(input);
    }
    await key("ArrowDown");
    expect(document.activeElement?.getAttribute("role")).toBe("menuitem");
    await key("ArrowUp");
    expect(document.activeElement).toBe(input);
    await key("Enter");
    expect(select).toHaveBeenCalledExactlyOnceWith("app");

    await type("settings");
    await key("Enter");
    await key("ArrowDown");
    expect(select).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(input);
    await type("missing");
    expect(host.querySelector('[role="status"]')?.textContent).toBe("0 of 4");
    expect(host.querySelector(".workspace-menu-panel-empty")?.textContent).toBe(
      "No matches",
    );
    await key("Escape");
    expect(close).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("keeps an empty Recent menu searchable and reports its empty state", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        createElement(WorkspaceMenuPanelContent, {
          snapshot: {
            title: "Recent tabs",
            compact: true,
            searchable: true,
            theme: { mode: "dark", accent: "#99bbdd" },
            items: [],
          },
          onSelect: vi.fn(),
          onClose: vi.fn(),
        }),
      ),
    );
    expect(document.activeElement).toBe(host.querySelector("input"));
    expect(host.querySelector('[role="status"]')?.textContent).toBe("0 items");
    expect(host.querySelector(".workspace-menu-panel-empty")?.textContent).toBe(
      "No recent tabs",
    );
    expect(host.querySelectorAll('[role="menuitem"]')).toHaveLength(0);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("renders compact grouped choices with theme colors, checks, shortcuts, and disabled keyboard skipping", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const select = vi.fn();
  const close = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(WorkspaceMenuPanelContent, {
          snapshot: {
            title: "Tab actions",
            compact: true,
            theme: {
              mode: "light",
              background: "#f4ead4",
              accent: "#756129",
              text: "#231d12",
            },
            items: [
              { id: "pin", label: "Pin tab", checked: true },
              {
                id: "focus",
                label: "Focus tab",
                disabled: true,
                separatorBefore: true,
              },
              {
                id: "close-tab",
                label: "Close tab",
                shortcut: "⌘W",
                danger: true,
              },
            ],
          },
          onSelect: select,
          onClose: close,
        }),
      ),
    );
    expect(host.querySelector("header")).toBeNull();
    expect(
      host
        .querySelector<HTMLElement>(".toolbar-panel")
        ?.style.getPropertyValue("--toolbar-panel-bg"),
    ).toBe("#f4ead4");
    expect(
      host
        .querySelector('[role="menuitemcheckbox"]')
        ?.getAttribute("aria-checked"),
    ).toBe("true");
    expect(host.querySelectorAll('[role="separator"]')).toHaveLength(1);
    expect(
      host.querySelector(".workspace-menu-panel-shortcut")?.textContent,
    ).toBe("⌘W");
    expect(
      host.querySelector(".workspace-menu-panel-item-danger")?.textContent,
    ).toBe("Close tab⌘W");
    expect(document.activeElement?.textContent).toBe("Pin tab");
    const key = async (value: string) =>
      act(async () =>
        document.activeElement?.dispatchEvent(
          new KeyboardEvent("keydown", { key: value, bubbles: true }),
        ),
      );
    await key("ArrowDown");
    expect(document.activeElement?.textContent).toBe("Close tab⌘W");
    await key("ArrowDown");
    expect(document.activeElement?.textContent).toBe("Pin tab");
    await key("End");
    expect(document.activeElement?.textContent).toBe("Close tab⌘W");
    await key("Home");
    expect(document.activeElement?.textContent).toBe("Pin tab");
    await key("ArrowUp");
    expect(document.activeElement?.textContent).toBe("Close tab⌘W");
    await act(async () =>
      (host.querySelectorAll("button")[1] as HTMLButtonElement).click(),
    );
    expect(select).not.toHaveBeenCalled();
    await key("Escape");
    expect(close).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("focuses the menu itself when every action is unavailable", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        createElement(WorkspaceMenuPanelContent, {
          snapshot: {
            title: "Unavailable actions",
            compact: true,
            theme: { mode: "dark", accent: "#99bbdd" },
            items: [{ id: "disabled", label: "Unavailable", disabled: true }],
          },
          onSelect: vi.fn(),
          onClose: vi.fn(),
        }),
      ),
    );
    expect(document.activeElement?.getAttribute("role")).toBe("menu");
    await act(async () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
    );
    expect(document.activeElement?.getAttribute("role")).toBe("menu");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

// @vitest-environment happy-dom
import { act, createElement, Fragment, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Modal, ModalPanel } from "./Modal";
import { Popover } from "./Popover";

let root: Root;
let container: HTMLDivElement;
let opener: HTMLButtonElement;
const close = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  opener = document.createElement("button");
  opener.textContent = "Open dialog";
  container = document.createElement("div");
  document.body.append(opener, container);
  opener.focus();
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  opener.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function button(label: string, within: ParentNode = document) {
  return [...within.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) =>
      element.textContent === label ||
      element.getAttribute("aria-label") === label,
  )!;
}

async function key(value: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key: value,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  await act(async () => {
    document.activeElement!.dispatchEvent(event);
  });
  return event;
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.focus();
    element.click();
  });
}

function Single({ children }: { children?: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return open
    ? createElement(Modal, {
        title: "Preferences",
        onClose: () => {
          close();
          setOpen(false);
        },
        children,
      })
    : null;
}

describe("modal keyboard ownership", () => {
  it("wraps Tab both ways and restores the opener when closed", async () => {
    await act(async () =>
      root.render(
        createElement(Single, {
          children: createElement(
            Fragment,
            null,
            createElement("input", { "aria-label": "Name" }),
            createElement("button", null, "Save"),
          ),
        }),
      ),
    );
    const first = button("Close");
    const last = button("Save");
    expect(document.activeElement).toBe(first);
    await key("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(last);
    await key("Tab");
    expect(document.activeElement).toBe(first);
    await key("Tab");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Name");
    await key("Escape");
    expect(close).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("excludes disabled controls, hidden ancestors, inert regions, and collapsed details", async () => {
    await act(async () =>
      root.render(
        createElement(Single, {
          children: createElement(
            Fragment,
            null,
            createElement("button", null, "Usable"),
            createElement("button", { disabled: true }, "Disabled"),
            createElement(
              "button",
              { disabled: true, tabIndex: 0 },
              "Disabled tabindex",
            ),
            createElement(
              "fieldset",
              { disabled: true },
              createElement("input", { "aria-label": "Disabled by fieldset" }),
            ),
            createElement(
              "div",
              { style: { display: "none" } },
              createElement("button", null, "Hidden wrapper"),
            ),
            createElement(
              "div",
              { style: { visibility: "hidden" } },
              createElement("button", null, "Invisible wrapper"),
            ),
            createElement(
              "div",
              { hidden: true },
              createElement("button", null, "Hidden"),
            ),
            createElement(
              "div",
              { inert: true },
              createElement("button", null, "Inert"),
            ),
            createElement(
              "div",
              { "aria-hidden": true },
              createElement("button", null, "ARIA hidden"),
            ),
            createElement("button", { tabIndex: -1 }, "Programmatic only"),
            createElement(
              "details",
              null,
              createElement("summary", { tabIndex: 0 }, "More"),
              createElement("button", null, "Collapsed"),
            ),
          ),
        }),
      ),
    );
    await key("Tab");
    expect(document.activeElement).toBe(button("Usable"));
    await key("Tab");
    expect(document.activeElement?.tagName).toBe("SUMMARY");
    await key("Tab");
    expect(document.activeElement).toBe(button("Close"));
    await key("Tab", { shiftKey: true });
    expect(document.activeElement?.tagName).toBe("SUMMARY");
  });

  it("closes only the top nested modal and returns through both openers", async () => {
    const innerClose = vi.fn();
    function Nested() {
      const [outer, setOuter] = useState(true);
      const [inner, setInner] = useState(false);
      return outer
        ? createElement(Modal, {
            title: "Parent",
            onClose: () => {
              close();
              setOuter(false);
            },
            children: createElement(
              Fragment,
              null,
              createElement(
                "button",
                { onClick: () => setInner(true) },
                "Open nested",
              ),
              inner
                ? createElement(Modal, {
                    title: "Child",
                    onClose: () => {
                      innerClose();
                      setInner(false);
                    },
                    children: createElement("button", null, "Child action"),
                  })
                : null,
            ),
          })
        : null;
    }
    await act(async () => root.render(createElement(Nested)));
    const trigger = button("Open nested");
    await click(trigger);
    const panels = document.querySelectorAll('[role="dialog"]');
    expect(panels).toHaveLength(2);
    expect(panels[1].contains(document.activeElement)).toBe(true);
    await key("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(button("Child action"));
    await key("Escape");
    expect(innerClose).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.activeElement).toBe(trigger);
    await key("Escape");
    expect(close).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(opener);
  });

  it("keeps a portaled picker in the dialog's tab order and lets Escape dismiss it first", async () => {
    const dismiss = vi.fn();
    function WithPicker() {
      const trigger = useRef<HTMLButtonElement>(null);
      const [open, setOpen] = useState(false);
      return createElement(Single, {
        children: createElement(
          Fragment,
          null,
          createElement(
            "button",
            { ref: trigger, onClick: () => setOpen(true) },
            "Options",
          ),
          open
            ? createElement(
                Popover,
                {
                  anchor: trigger,
                  layer: 91,
                  role: "menu",
                  onDismiss: (reason) => {
                    dismiss(reason);
                    setOpen(false);
                    trigger.current?.focus();
                  },
                },
                createElement("input", {
                  "aria-label": "Option one",
                  autoFocus: true,
                }),
                createElement("input", { "aria-label": "Option two" }),
              )
            : null,
        ),
      });
    }
    await act(async () => root.render(createElement(WithPicker)));
    await click(button("Options"));
    const first = document.querySelector<HTMLInputElement>(
      '[aria-label="Option one"]',
    )!;
    const second = document.querySelector<HTMLInputElement>(
      '[aria-label="Option two"]',
    )!;
    expect(document.activeElement).toBe(first);
    expect(document.querySelector(".modal-panel")!.contains(first)).toBe(false);
    await key("Tab");
    expect(document.activeElement).toBe(second);
    await key("Tab");
    expect(document.activeElement).toBe(button("Close"));
    await key("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(second);
    await key("Escape");
    expect(dismiss).toHaveBeenCalledExactlyOnceWith("escape");
    expect(close).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button("Options"));
    await key("Escape");
    expect(close).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(opener);
  });

  it("preserves child autofocus and respects handled Escape or IME composition", async () => {
    await act(async () =>
      root.render(
        createElement(Single, {
          children: createElement("input", {
            autoFocus: true,
            "aria-label": "Compose",
            onKeyDown: (event) => {
              if (event.key === "Escape") event.preventDefault();
            },
          }),
        }),
      ),
    );
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Compose");
    await key("Escape");
    expect(close).not.toHaveBeenCalled();
    button("Close").focus();
    await key("Escape", { isComposing: true });
    expect(close).not.toHaveBeenCalled();
    await key("Escape");
    expect(close).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(opener);
  });

  it("does not steal focus when a background modal is removed", async () => {
    function Pair({ first }: { first: boolean }) {
      return createElement(
        Fragment,
        null,
        first
          ? createElement(Modal, {
              title: "Background",
              onClose: vi.fn(),
              children: "Background",
            })
          : null,
        createElement(Modal, {
          title: "Foreground",
          onClose: vi.fn(),
          children: createElement("button", null, "Active"),
        }),
      );
    }
    await act(async () => root.render(createElement(Pair, { first: true })));
    button("Active").focus();
    await act(async () => root.render(createElement(Pair, { first: false })));
    expect(document.activeElement).toBe(button("Active"));
  });

  it("ignores a hidden later dialog and unrelated hidden popovers", async () => {
    await act(async () =>
      root.render(
        createElement(
          Fragment,
          null,
          createElement(Single),
          createElement(
            "div",
            { hidden: true },
            createElement(ModalPanel, {
              title: "Hidden",
              onClose: vi.fn(),
              children: "Hidden",
            }),
            createElement("div", { "data-popover-side": "bottom" }, "Not open"),
          ),
        ),
      ),
    );
    const visible = [...document.querySelectorAll(".modal-panel")].find(
      (panel) => panel.querySelector("h2")?.textContent === "Preferences",
    )!;
    expect(document.activeElement).toBe(button("Close", visible));
    await key("Escape");
    expect(close).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(opener);
  });
});

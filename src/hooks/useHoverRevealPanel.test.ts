// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  useHoverRevealPanel,
  type HoverRevealPanelOptions,
} from "./useHoverRevealPanel";

let latest: ReturnType<typeof useHoverRevealPanel>;
let root: Root;
let container: HTMLDivElement;
let props: HoverRevealPanelOptions;
const observers: {
  emit: MutationCallback;
  disconnect: ReturnType<typeof vi.fn>;
}[] = [];
function Harness(options: HoverRevealPanelOptions) {
  latest = useHoverRevealPanel(options);
  return createElement(
    "div",
    null,
    createElement(
      "button",
      { ...latest.edgeHandlers, "data-edge": true },
      "Reveal panel",
    ),
    createElement(
      "aside",
      {
        ...latest.panelHandlers,
        hidden: !latest.visible,
        "data-open": latest.visible,
        "data-panel": true,
      },
      createElement("input", { "aria-label": "Panel input" }),
    ),
    createElement("button", { "data-outside": true }, "Outside"),
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
    new DOMRect(0, 0, 100, 100),
  ] as unknown as DOMRectList);
  observers.length = 0;
  vi.stubGlobal(
    "MutationObserver",
    class {
      disconnect = vi.fn();
      observe = vi.fn();
      constructor(public emit: MutationCallback) {
        observers.push(this);
      }
    },
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  props = { pinned: false };
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document
    .querySelectorAll("[data-test-portal]")
    .forEach((node) => node.remove());
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(patch: Partial<HoverRevealPanelOptions> = {}) {
  props = { ...props, ...patch };
  await act(async () => root.render(createElement(Harness, props)));
}
function element(selector: string) {
  return container.querySelector<HTMLElement>(selector)!;
}
function enter(selector: string) {
  act(() =>
    element(selector).dispatchEvent(
      new PointerEvent("pointerover", {
        bubbles: true,
        pointerType: "mouse",
        relatedTarget: document.body,
      }),
    ),
  );
}
function leave(selector: string) {
  act(() =>
    element(selector).dispatchEvent(
      new PointerEvent("pointerout", {
        bubbles: true,
        pointerType: "mouse",
        relatedTarget: document.body,
      }),
    ),
  );
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
async function reveal() {
  enter("[data-edge]");
  await advance(90);
}
async function mutation(node: HTMLElement, added: boolean) {
  await act(async () => {
    const record = {
      type: "childList",
      target: document.body,
      addedNodes: added ? [node] : [],
      removedNodes: added ? [] : [node],
    } as unknown as MutationRecord;
    for (const observer of observers.filter(
      (row) => !row.disconnect.mock.calls.length,
    ))
      observer.emit([record], {} as MutationObserver);
  });
}

describe("temporary hover panels", () => {
  it("has no idle timers or global mutation observer while closed", async () => {
    await render();
    await advance(30_000);
    expect(latest.visible).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(observers).toHaveLength(0);
  });

  it("ignores brief edge passes, then reveals and closes with bounded delays", async () => {
    await render();
    enter("[data-edge]");
    await advance(50);
    leave("[data-edge]");
    await advance(100);
    expect(latest.visible).toBe(false);
    await reveal();
    expect(latest.revealed).toBe(true);
    expect(props.pinned).toBe(false);
    leave("[data-edge]");
    await advance(179);
    expect(latest.visible).toBe(true);
    await advance(1);
    expect(latest.visible).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
  });

  it("keeps the panel open while crossing from the edge into its content", async () => {
    await render();
    await reveal();
    leave("[data-edge]");
    await advance(40);
    enter("[data-panel]");
    await advance(500);
    expect(latest.visible).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    leave("[data-panel]");
    await advance(180);
    expect(latest.visible).toBe(false);
  });

  it("starts a zero-delay close after pointer leave without waiting for a timer", async () => {
    await render({ enterDelay: 45, leaveDelay: 0 });
    enter("[data-edge]");
    await advance(45);
    await act(async () => {
      leave("[data-edge]");
      enter("[data-panel]");
    });
    expect(latest.visible).toBe(true);
    await act(async () => leave("[data-panel]"));
    expect(latest.visible).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts closing the panel before the owner re-renders", async () => {
    await render({ leaveDelay: 0 });
    await reveal();
    enter("[data-panel]");
    await act(async () => {
      element("[data-panel]").dispatchEvent(
        new PointerEvent("pointerout", {
          bubbles: true,
          pointerType: "mouse",
          relatedTarget: document.body,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
      expect(element("[data-panel]").dataset.open).toBe("false");
      expect(latest.visible).toBe(true);
    });
    expect(latest.visible).toBe(false);
    expect(element("[data-panel]").dataset.open).toBe("false");
  });

  it("reopens a panel whose early close had not committed", async () => {
    await render({ enterDelay: 45, leaveDelay: 0 });
    await reveal();
    enter("[data-panel]");
    await act(async () => {
      element("[data-panel]").dispatchEvent(
        new PointerEvent("pointerout", {
          bubbles: true,
          pointerType: "mouse",
          relatedTarget: document.body,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
      element("[data-edge]").dispatchEvent(
        new PointerEvent("pointerover", {
          bubbles: true,
          pointerType: "mouse",
          relatedTarget: document.body,
        }),
      );
      expect(element("[data-panel]").dataset.open).toBe("false");
      await vi.advanceTimersByTimeAsync(45);
    });
    expect(latest.visible).toBe(true);
    expect(element("[data-panel]").dataset.open).toBe("true");
  });

  it("cancels a queued zero-delay close when the pointer re-enters", async () => {
    await render({ leaveDelay: 0 });
    await reveal();
    await act(async () => {
      leave("[data-edge]");
      enter("[data-panel]");
      leave("[data-panel]");
      enter("[data-panel]");
    });
    expect(latest.visible).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not extend a pending close for repeated focus observations", async () => {
    await render();
    await reveal();
    leave("[data-edge]");
    await advance(100);
    await act(async () => element("[data-outside]").focus());
    await advance(80);
    expect(latest.visible).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, 180])(
    "retains keyboard focus after pointer leave with a %i ms close delay",
    async (leaveDelay) => {
      await render({ leaveDelay });
      await reveal();
      leave("[data-edge]");
      enter("[data-panel]");
      act(() =>
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
        ),
      );
      await act(async () => element("input").focus());
      leave("[data-panel]");
      await advance(500);
      expect(latest.revealed).toBe(true);
      await act(async () => element("[data-outside]").focus());
      await advance(180);
      expect(latest.visible).toBe(false);
    },
  );

  it.each(["button", "input", "autofocus"])(
    "closes a hover peek after leaving a pointer-focused %s without an outside click",
    async (target) => {
      await render();
      await reveal();
      leave("[data-edge]");
      enter("[data-panel]");
      const control =
        target === "button"
          ? document.createElement("button")
          : element("input");
      if (target === "button") element("[data-panel]").appendChild(control);
      await act(async () => {
        if (target !== "autofocus")
          control.dispatchEvent(
            new PointerEvent("pointerdown", {
              bubbles: true,
              pointerType: "mouse",
            }),
          );
        control.focus();
      });
      leave("[data-panel]");
      await advance(179);
      expect(latest.visible).toBe(true);
      await advance(1);
      expect(latest.visible).toBe(false);
      expect(document.activeElement).not.toBe(control);
      expect(props.pinned).toBe(false);
    },
  );

  it("keeps keyboard edge entry open until focus leaves", async () => {
    await render();
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      ),
    );
    await act(async () => element("[data-edge]").focus());
    expect(latest.visible).toBe(true);
    await advance(500);
    expect(latest.visible).toBe(true);
    await act(async () => element("[data-outside]").focus());
    await advance(180);
    expect(latest.visible).toBe(false);
  });

  it("closes after an input blurs to the body even without a subsequent focusin", async () => {
    await render();
    await reveal();
    leave("[data-edge]");
    await act(async () => element("input").focus());
    await act(async () => element("input").blur());
    await advance(180);
    expect(latest.visible).toBe(false);
  });

  it.each([0, 180])(
    "keeps portalled menus usable with a %i ms close delay",
    async (leaveDelay) => {
      await render({ leaveDelay });
      await reveal();
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.dataset.testPortal = "true";
      document.body.appendChild(menu);
      await mutation(menu, true);
      leave("[data-edge]");
      await advance(500);
      expect(latest.revealed).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      act(() =>
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        ),
      );
      expect(latest.visible).toBe(true);
      menu.remove();
      await mutation(menu, false);
      await advance(180);
      expect(latest.visible).toBe(false);
    },
  );

  it("closes after a real React portal menu when React omits the panel pointer-leave event", async () => {
    const syntheticLeave = vi.fn();
    function PortalHarness() {
      latest = useHoverRevealPanel({ pinned: false });
      const [menuOpen, setMenuOpen] = useState(false);
      return createElement(
        "div",
        null,
        createElement(
          "button",
          { ...latest.edgeHandlers, "data-edge": true },
          "Reveal",
        ),
        createElement(
          "aside",
          {
            ...latest.panelHandlers,
            hidden: !latest.visible,
            "data-panel": true,
            onPointerLeave: (event) => {
              syntheticLeave();
              latest.panelHandlers.onPointerLeave?.(event);
            },
          },
          createElement(
            "button",
            { "data-open-menu": true, onClick: () => setMenuOpen(true) },
            "Menu",
          ),
          menuOpen
            ? createPortal(
                createElement(
                  "div",
                  { role: "menu", "data-test-portal": true },
                  createElement(
                    "button",
                    { onClick: () => setMenuOpen(false) },
                    "Choose action",
                  ),
                ),
                document.body,
              )
            : null,
        ),
      );
    }
    await act(async () => root.render(createElement(PortalHarness)));
    await reveal();
    leave("[data-edge]");
    enter("[data-panel]");
    await act(async () => element("[data-open-menu]").click());
    const menu = document.querySelector<HTMLElement>("[data-test-portal]")!;
    await mutation(menu, true);
    const from = element("[data-open-menu]");
    await act(async () => {
      from.dispatchEvent(
        new PointerEvent("pointerout", {
          bubbles: true,
          pointerType: "mouse",
          relatedTarget: menu,
        }),
      );
      menu.dispatchEvent(
        new PointerEvent("pointerover", {
          bubbles: true,
          pointerType: "mouse",
          relatedTarget: from,
        }),
      );
    });
    // The portal belongs to the aside in React's tree, but is outside its DOM.
    expect(syntheticLeave).not.toHaveBeenCalled();
    await advance(500);
    expect(latest.revealed).toBe(true);
    await act(async () =>
      menu.querySelector<HTMLButtonElement>("button")!.click(),
    );
    await mutation(menu, false);
    await advance(179);
    expect(latest.revealed).toBe(true);
    await advance(1);
    expect(latest.visible).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("dismisses a focused temporary panel on Escape without changing pinned state", async () => {
    await render();
    await reveal();
    await act(async () => element("input").focus());
    act(() =>
      element("input").dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(latest.visible).toBe(false);
    expect(document.activeElement).not.toBe(element("input"));
    await render({ pinned: true });
    act(() => latest.dismiss());
    expect(latest.visible).toBe(true);
    expect(latest.revealed).toBe(false);
  });

  it.each(["blur", "hidden"])(
    "cancels pending and visible peeks on %s",
    async (cause) => {
      await render();
      enter("[data-edge]");
      const trigger = () =>
        act(() => {
          if (cause === "blur") window.dispatchEvent(new Event("blur"));
          else {
            vi.spyOn(document, "visibilityState", "get").mockReturnValue(
              "hidden",
            );
            document.dispatchEvent(new Event("visibilitychange"));
          }
        });
      trigger();
      await advance(500);
      expect(latest.visible).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
      await reveal();
      trigger();
      expect(latest.visible).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("reveals on hover with stale hidden visibility and still dismisses on a new hide event", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await render();
    enter("[data-edge]");
    await advance(89);
    expect(latest.visible).toBe(false);
    await advance(1);
    expect(latest.revealed).toBe(true);
    // Hover must not steal keyboard focus from the workspace.
    expect(document.activeElement).not.toBe(element("[data-edge]"));
    expect(document.activeElement).not.toBe(element("input"));

    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(latest.visible).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    enter("[data-edge]");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await advance(500);
    expect(latest.visible).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("discards a peek on pin/unpin and cancels work on disable and unmount", async () => {
    await render();
    await reveal();
    await render({ pinned: true });
    expect(latest.visible).toBe(true);
    expect(latest.revealed).toBe(false);
    await render({ pinned: false });
    expect(latest.visible).toBe(false);
    enter("[data-edge]");
    await render({ enabled: false });
    await advance(500);
    expect(latest.visible).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await render({ enabled: true });
    enter("[data-edge]");
    await act(async () => root.render(null));
    expect(vi.getTimerCount()).toBe(0);
  });
});

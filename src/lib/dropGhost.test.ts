// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureDropGhost } from "./dropGhost";
import { MOTION_ROOT_ATTRIBUTE } from "./motion";
import { DOCK_EASE, DOCK_TWEEN_MS } from "./paneDock";

let shell: HTMLElement;
let item: HTMLElement;
let animate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.documentElement.setAttribute(MOTION_ROOT_ATTRIBUTE, "full");
  shell = document.createElement("div");
  shell.className = "personal-shell";
  item = document.createElement("div");
  item.className = "aven-tab personal-title-tab";
  item.dataset.active = "true";
  item.innerHTML =
    '<div class="aven-tab-motion" data-sortable-motion style="transform: translate(300px, 120px)"><button class="aven-tab-button">Add sign-up flow</button></div>';
  shell.append(item);
  document.body.append(shell);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    left: 400,
    top: 180,
    width: 220,
    height: 26,
    right: 620,
    bottom: 206,
    x: 400,
    y: 180,
    toJSON() {},
  } as DOMRect);
  animate = vi.fn(() => ({ onfinish: null, cancel: vi.fn() }));
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: animate,
  });
});

afterEach(() => {
  shell.remove();
  document.documentElement.removeAttribute(MOTION_ROOT_ATTRIBUTE);
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as { animate?: unknown }).animate;
});

describe("the drop ghost", () => {
  it("fades the tab out where it was let go, 150ms", () => {
    const ghost = captureDropGhost(item)!;
    // Taking the drop first puts the tab back in its strip.
    item.querySelector<HTMLElement>("[data-sortable-motion]")!.style.transform =
      "";
    ghost.fade();
    const copy = shell.querySelector<HTMLElement>("[data-drop-ghost]")!;
    expect(copy.className).toBe(item.className);
    expect(copy.dataset.active).toBe("true");
    expect(copy.getAttribute("aria-hidden")).toBe("true");
    expect(copy.style.position).toBe("fixed");
    expect(copy.style.left).toBe("400px");
    expect(copy.style.top).toBe("180px");
    expect(copy.style.width).toBe("220px");
    expect(copy.style.pointerEvents).toBe("none");
    expect(copy.textContent).toBe("Add sign-up flow");
    // Its look sits in place, not where the drag had translated it.
    expect(
      copy.querySelector<HTMLElement>("[data-sortable-motion]")!.style
        .transform,
    ).toBe("none");
    expect(animate).toHaveBeenCalledWith([{ opacity: 1 }, { opacity: 0 }], {
      duration: DOCK_TWEEN_MS,
      easing: DOCK_EASE,
      fill: "forwards",
    });
    const fade = animate.mock.results[0].value as { onfinish: () => void };
    fade.onfinish();
    expect(shell.querySelector("[data-drop-ghost]")).toBeNull();
  });

  it("is removed at its duration even if WebKit never runs the fade", () => {
    vi.useFakeTimers();
    try {
      captureDropGhost(item)!.fade();
      expect(shell.querySelector("[data-drop-ghost]")).not.toBeNull();
      // The fade never finishes on its own here.
      vi.advanceTimersByTime(DOCK_TWEEN_MS + 60);
      expect(shell.querySelector("[data-drop-ghost]")).toBeNull();
      const fade = animate.mock.results[0].value as { cancel: () => void };
      expect(fade.cancel).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("draws nothing with reduced motion or for a tab that is not laid out", () => {
    document.documentElement.setAttribute(MOTION_ROOT_ATTRIBUTE, "reduce");
    expect(captureDropGhost(item)).toBeNull();
    document.documentElement.setAttribute(MOTION_ROOT_ATTRIBUTE, "full");
    expect(captureDropGhost(null)).toBeNull();
    vi.mocked(Element.prototype.getBoundingClientRect).mockReturnValue({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    } as DOMRect);
    expect(captureDropGhost(item)).toBeNull();
  });
});

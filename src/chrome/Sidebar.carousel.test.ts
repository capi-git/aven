// @vitest-environment happy-dom
import { act, createElement, useCallback, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useProfileCarousel } from "../hooks/useProfileCarousel";
import type { WorkspaceProfile } from "../lib/workspaceProfiles";

// Test the native scrolling contract. happy-dom does not perform wheel scrolling
// or CSS snap animation, so scroll positions/events model native movement;
// these tests deliberately do not claim to measure physical trackpad smoothness.
type Props = {
  enabled: boolean;
  profiles: WorkspaceProfile[];
  activeProfileId: string;
  onSelectProfile: (id: string) => void;
};
let root: Root | undefined;
let container: HTMLDivElement;
let props: Props;
let width = 280;
let viewport: HTMLDivElement;
const select = vi.fn();
const scrollTo = vi.fn<(options: ScrollToOptions) => void>();
let resizeObservers: Array<{
  callback: ResizeObserverCallback;
  disconnect: ReturnType<typeof vi.fn>;
}>;

function Harness(current: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mount = useCallback((node: HTMLDivElement | null) => {
    ref.current = node;
    if (!node) return;
    viewport = node;
    Object.defineProperties(node, {
      clientWidth: { configurable: true, get: () => width },
      scrollWidth: {
        configurable: true,
        get: () => width * props.profiles.length,
      },
    });
    node.scrollTo = scrollTo;
    const captured = new Set<number>();
    node.setPointerCapture = vi.fn((id: number) => captured.add(id));
    node.hasPointerCapture = vi.fn((id: number) => captured.has(id));
    node.releasePointerCapture = vi.fn((id: number) => captured.delete(id));
  }, []);
  useProfileCarousel({ viewport: ref, ...current });
  return createElement(
    "div",
    {
      ref: mount,
      "data-carousel": true,
      "data-active-profile": current.activeProfileId,
    },
    ...current.profiles.map((profile) =>
      createElement(
        "section",
        { key: profile.id, "data-profile": profile.id },
        createElement("button", null, profile.name),
      ),
    ),
  );
}
async function render(next: Partial<Props> = {}) {
  props = { ...props, ...next };
  await act(async () => root!.render(createElement(Harness, props)));
}
async function tick(ms: number) {
  await act(async () => vi.advanceTimersByTime(ms));
}
async function nativeScroll(left: number, ended = false) {
  await act(async () => {
    viewport.scrollLeft = left;
    viewport.dispatchEvent(new Event("scroll"));
    if (ended) viewport.dispatchEvent(new Event("scrollend"));
  });
}
async function resize(nextWidth: number) {
  width = nextWidth;
  await act(async () => {
    for (const observer of resizeObservers)
      observer.callback(
        [{ target: viewport, contentRect: { width } } as ResizeObserverEntry],
        observer as unknown as ResizeObserver,
      );
  });
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resizeObservers = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      disconnect = vi.fn();
      constructor(public callback: ResizeObserverCallback) {
        resizeObservers.push(this);
      }
      observe = vi.fn();
      unobserve = vi.fn();
    },
  );
  width = 280;
  select.mockReset();
  scrollTo.mockReset();
  scrollTo.mockImplementation((options) => {
    if (typeof options.left === "number") viewport.scrollLeft = options.left;
  });
  props = {
    enabled: true,
    profiles: [
      { id: "personal", name: "Personal", icon: "home" },
      { id: "work", name: "Work", icon: "briefcase" },
    ],
    activeProfileId: "personal",
    onSelectProfile: select,
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await render();
  scrollTo.mockClear();
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("restores the active workspace immediately when the carousel mounts", async () => {
  await act(async () => root!.unmount());
  root = createRoot(container);
  await render({ activeProfileId: "work" });
  expect(scrollTo).toHaveBeenLastCalledWith({ left: 280, behavior: "instant" });
  expect(viewport.scrollLeft).toBe(280);
  expect(select).not.toHaveBeenCalled();
});

it.each([
  [80, 0],
  [-80, 0],
  [0, 80],
  [0, -80],
  [40, 10],
])("leaves native wheel input (%s, %s) uncancelled", async (deltaX, deltaY) => {
  const event = new WheelEvent("wheel", {
    deltaX,
    deltaY,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => viewport.firstElementChild!.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(false);
  expect(scrollTo).not.toHaveBeenCalled();
  expect(select).not.toHaveBeenCalled();
});

it("selects the settled native page on scrollend", async () => {
  await nativeScroll(280, true);
  expect(select).toHaveBeenCalledExactlyOnceWith("work");
  expect(scrollTo).not.toHaveBeenCalled();
  await tick(200);
  expect(select).toHaveBeenCalledTimes(1);
});

it("activates a fully arrived native page before delayed momentum scrollend", async () => {
  await render({ enabled: false });
  Object.defineProperty(viewport, "onscrollend", {
    configurable: true,
    value: null,
  });
  await render({ enabled: true });
  scrollTo.mockClear();
  await nativeScroll(280);
  expect(select).toHaveBeenCalledExactlyOnceWith("work");
  await nativeScroll(0);
  expect(select.mock.calls).toEqual([["work"], ["personal"]]);
  await render({ activeProfileId: "work" });
  await render({ activeProfileId: "personal" });
  expect(scrollTo).not.toHaveBeenCalled();
  await tick(500);
  await nativeScroll(0, true);
  expect(select.mock.calls).toEqual([["work"], ["personal"]]);
});

it("activates the snapped page immediately without native scrollend support", async () => {
  await nativeScroll(280);
  expect(select).toHaveBeenCalledExactlyOnceWith("work");
  await tick(500);
  expect(select).toHaveBeenCalledTimes(1);
});

it("accepts an immediate reverse swipe without a click or momentum timeout", async () => {
  await nativeScroll(280, true);
  await render({ activeProfileId: "work" });
  // No 400ms quiet period, pointer event, focus change, or click in between.
  await nativeScroll(0, true);
  await render({ activeProfileId: "personal" });
  await nativeScroll(280, true);
  expect(select.mock.calls).toEqual([["work"], ["personal"], ["work"]]);
  expect(scrollTo).not.toHaveBeenCalled();
});

it("does not restart native motion when React acknowledges a scroll selection", async () => {
  await nativeScroll(280, true);
  await render({ activeProfileId: "work" });
  await render();
  expect(scrollTo).not.toHaveBeenCalled();
  expect(viewport.scrollLeft).toBe(280);
  expect(select).toHaveBeenCalledExactlyOnceWith("work");
});

it("adopts the dominant page immediately without waiting for a snap or quiet interval", async () => {
  await nativeScroll(190);
  expect(select).toHaveBeenCalledExactlyOnceWith("work");
  await tick(100);
  expect(select).toHaveBeenCalledTimes(1);
  await nativeScroll(280);
  expect(select).toHaveBeenCalledExactlyOnceWith("work");
  await tick(120);
  await nativeScroll(280, true);
  expect(select).toHaveBeenCalledTimes(1);
});

it("commits the destination DOM within the native threshold event", async () => {
  function StatefulHarness() {
    const [activeProfileId, setActiveProfileId] = useState("personal");
    return createElement(Harness, {
      ...props,
      activeProfileId,
      onSelectProfile: (id: string) => {
        select(id);
        setActiveProfileId(id);
      },
    });
  }
  await act(async () => root!.render(createElement(StatefulHarness)));
  scrollTo.mockClear();
  // act would flush a deferred React update after this event and conceal the
  // lag. Exercise the synchronous event boundary before yielding to React.
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", false);
  try {
    viewport.scrollLeft = width * 0.61;
    viewport.dispatchEvent(new Event("scroll"));
    expect(viewport.dataset.activeProfile).toBe("work");
    expect(select).toHaveBeenCalledExactlyOnceWith("work");
    expect(scrollTo).not.toHaveBeenCalled();
  } finally {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    await act(async () => {});
  }
});

it("keeps the current workspace while a gesture pauses inside the halfway dead band", async () => {
  await nativeScroll(120);
  await tick(120);
  expect(select).not.toHaveBeenCalled();
  await nativeScroll(160);
  expect(select).not.toHaveBeenCalled();
  await tick(500);
  expect(select).not.toHaveBeenCalled();
  await nativeScroll(280);
  await tick(120);
  expect(select).toHaveBeenCalledExactlyOnceWith("work");
});

it("adopts a dominant page without a timer on engines with native scrollend", async () => {
  await render({ enabled: false });
  Object.defineProperty(viewport, "onscrollend", {
    configurable: true,
    value: null,
  });
  await render({ enabled: true });
  const timers = vi.getTimerCount();
  await nativeScroll(120);
  expect(vi.getTimerCount()).toBe(timers);
  await tick(500);
  expect(select).not.toHaveBeenCalled();
  await nativeScroll(200);
  expect(select).toHaveBeenCalledExactlyOnceWith("work");
  expect(vi.getTimerCount()).toBe(timers);
  await nativeScroll(280, true);
  expect(select).toHaveBeenCalledExactlyOnceWith("work");
  await render({ activeProfileId: "work" });
  await nativeScroll(0, true);
  expect(select.mock.calls).toEqual([["work"], ["personal"]]);
});

it("clamps native rubber-band positions instead of wrapping to the other end", async () => {
  await nativeScroll(-190, true);
  expect(select).not.toHaveBeenCalled();
  await nativeScroll(900, true);
  expect(select).toHaveBeenCalledExactlyOnceWith("work");
  await render({ activeProfileId: "work" });
  await nativeScroll(330, true);
  expect(select).toHaveBeenCalledTimes(1);
  await nativeScroll(-20, true);
  expect(select.mock.calls).toEqual([["work"], ["personal"]]);
});

it("moves repeatedly through three workspaces in either direction", async () => {
  await render({
    profiles: [
      ...props.profiles,
      { id: "study", name: "Study", icon: "folder" },
    ],
  });
  scrollTo.mockClear();
  for (const [left, id] of [
    [280, "work"],
    [560, "study"],
    [280, "work"],
    [0, "personal"],
    [280, "work"],
    [560, "study"],
  ] as const) {
    await nativeScroll(left, true);
    await render({ activeProfileId: id });
  }
  expect(select.mock.calls.map(([id]) => id)).toEqual([
    "work",
    "study",
    "work",
    "personal",
    "work",
    "study",
  ]);
  expect(scrollTo).not.toHaveBeenCalled();
});

it("scrolls smoothly when another workspace is selected by a control", async () => {
  await render({ activeProfileId: "work" });
  expect(scrollTo).toHaveBeenLastCalledWith({ left: 280, behavior: "smooth" });
  await nativeScroll(280, true);
  expect(select).not.toHaveBeenCalled();
});

it("does not commit stale scroll intent after an external workspace selection", async () => {
  await nativeScroll(120);
  await render({ activeProfileId: "work" });
  await tick(121);
  expect(viewport.scrollLeft).toBe(280);
  expect(select).not.toHaveBeenCalled();
});

it("aligns an external selection instantly when reduced motion is requested", async () => {
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: true,
  } as MediaQueryList);
  await render({ activeProfileId: "work" });
  expect(scrollTo).toHaveBeenLastCalledWith({ left: 280, behavior: "instant" });
  expect(select).not.toHaveBeenCalled();
});

it("does not require focus or document visibility for native scrolling", async () => {
  const outside = document.createElement("input");
  container.append(outside);
  outside.focus();
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("blur"));
  });
  await nativeScroll(280, true);
  await render({ activeProfileId: "work" });
  await nativeScroll(0, true);
  expect(select.mock.calls).toEqual([["work"], ["personal"]]);
  expect(document.activeElement).toBe(outside);
});

it("corrects the selected page after a sidebar resize", async () => {
  await nativeScroll(280, true);
  await render({ activeProfileId: "work" });
  scrollTo.mockClear();
  await resize(360);
  expect(scrollTo).toHaveBeenLastCalledWith({ left: 360, behavior: "instant" });
  expect(viewport.scrollLeft).toBe(360);
  await nativeScroll(360, true);
  expect(select).toHaveBeenCalledTimes(1);
});

it("ignores zero-width hidden measurements and restores alignment on resize", async () => {
  await render({ activeProfileId: "work" });
  scrollTo.mockClear();
  await resize(0);
  await nativeScroll(0, true);
  expect(select).not.toHaveBeenCalled();
  await resize(300);
  expect(scrollTo).toHaveBeenLastCalledWith({ left: 300, behavior: "instant" });
  expect(select).not.toHaveBeenCalled();
});

it("restores the selected page when a hidden carousel returns to the same width", async () => {
  await render({ activeProfileId: "work" });
  scrollTo.mockClear();
  await resize(0);
  await nativeScroll(0, true);
  await resize(280);
  expect(scrollTo).toHaveBeenLastCalledWith({ left: 280, behavior: "instant" });
  expect(viewport.scrollLeft).toBe(280);
  expect(select).not.toHaveBeenCalled();
});

it("realigns by profile identity when workspace order changes", async () => {
  await render({ activeProfileId: "work" });
  scrollTo.mockClear();
  await render({ profiles: [...props.profiles].reverse() });
  expect(viewport.scrollLeft).toBe(0);
  expect(select).not.toHaveBeenCalled();
});

it("cancels pending selection and listeners while the sidebar is disabled", async () => {
  await nativeScroll(140);
  await render({ enabled: false });
  await tick(200);
  await nativeScroll(280, true);
  expect(select).not.toHaveBeenCalled();
  expect(
    resizeObservers.some(
      (observer) => observer.disconnect.mock.calls.length > 0,
    ),
  ).toBe(true);
  await render({ enabled: true });
  await nativeScroll(280, true);
  expect(select).toHaveBeenCalledExactlyOnceWith("work");
});

it("disposes pending native scroll work on unmount", async () => {
  await nativeScroll(140);
  const detached = viewport;
  await act(async () => root!.unmount());
  root = undefined;
  await tick(200);
  await act(async () => detached.dispatchEvent(new Event("scrollend")));
  expect(select).not.toHaveBeenCalled();
  expect(
    resizeObservers.every(
      (observer) => observer.disconnect.mock.calls.length > 0,
    ),
  ).toBe(true);
});

it("keeps a one-workspace carousel from issuing redundant selections", async () => {
  await render({ profiles: [props.profiles[0]] });
  await nativeScroll(1000, true);
  await nativeScroll(-1000, true);
  expect(select).not.toHaveBeenCalled();
});

it("keeps the latest native direction while older workspace renders catch up", async () => {
  await nativeScroll(280, true);
  await nativeScroll(0, true);
  expect(select.mock.calls).toEqual([["work"], ["personal"]]);
  await render({ activeProfileId: "work" });
  expect(scrollTo).not.toHaveBeenCalled();
  expect(viewport.scrollLeft).toBe(0);
  await render({ activeProfileId: "personal" });
  expect(scrollTo).not.toHaveBeenCalled();
  expect(viewport.scrollLeft).toBe(0);
  await nativeScroll(280, true);
  expect(select.mock.calls).toEqual([["work"], ["personal"], ["work"]]);
});

async function pointer(
  type: string,
  x: number,
  y = 100,
  target: Element = viewport,
  pointerType = "mouse",
) {
  const event = new PointerEvent(type, {
    pointerId: 7,
    pointerType,
    button: 0,
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => target.dispatchEvent(event));
  return event;
}

it("allows a blank-space mouse drag and snaps to the nearest native page on release", async () => {
  await pointer("pointerdown", 240);
  expect(viewport.setPointerCapture).not.toHaveBeenCalled();
  expect((await pointer("pointermove", 80)).defaultPrevented).toBe(true);
  expect(viewport.setPointerCapture).toHaveBeenCalledWith(7);
  expect(viewport.scrollLeft).toBe(160);
  await act(async () => viewport.dispatchEvent(new Event("scrollend")));
  expect(select).not.toHaveBeenCalled();
  await pointer("pointerup", 80);
  expect(select).toHaveBeenCalledExactlyOnceWith("work");
  expect(viewport.releasePointerCapture).toHaveBeenCalledWith(7);
  expect(scrollTo).toHaveBeenLastCalledWith({ left: 280, behavior: "smooth" });
  await nativeScroll(280, true);
  expect(select).toHaveBeenCalledExactlyOnceWith("work");
});

it.each([false, true])(
  "uses 60/40 hysteresis through immediate reversals (native scrollend: %s)",
  async (nativeScrollEnd) => {
    if (nativeScrollEnd) {
      await render({ enabled: false });
      Object.defineProperty(viewport, "onscrollend", {
        configurable: true,
        value: null,
      });
      await render({ enabled: true });
    }
    scrollTo.mockClear();
    await nativeScroll(width * 0.59);
    expect(select).not.toHaveBeenCalled();
    await nativeScroll(width * 0.61);
    expect(select.mock.calls).toEqual([["work"]]);
    await render({ activeProfileId: "work" });
    await nativeScroll(width * 0.55);
    await nativeScroll(width * 0.41);
    expect(select.mock.calls).toEqual([["work"]]);
    await nativeScroll(width * 0.39);
    expect(select.mock.calls).toEqual([["work"], ["personal"]]);
    await render({ activeProfileId: "personal" });
    await nativeScroll(width * 0.61);
    expect(select.mock.calls).toEqual([["work"], ["personal"], ["work"]]);
    expect(scrollTo).not.toHaveBeenCalled();
    await render({ activeProfileId: "work" });
    await nativeScroll(width, true);
    expect(select).toHaveBeenCalledTimes(3);
  },
);

it("uses the latest dominant-page request while React acknowledgments are delayed", async () => {
  await nativeScroll(width * 0.61);
  await nativeScroll(width * 0.55);
  expect(select.mock.calls).toEqual([["work"]]);
  await nativeScroll(width * 0.39);
  expect(select.mock.calls).toEqual([["work"], ["personal"]]);
  await render({ activeProfileId: "work" });
  expect(viewport.scrollLeft).toBe(width * 0.39);
  await render({ activeProfileId: "personal" });
  expect(viewport.scrollLeft).toBe(width * 0.39);
  expect(scrollTo).not.toHaveBeenCalled();
  await nativeScroll(width * 0.61);
  expect(select.mock.calls).toEqual([["work"], ["personal"], ["work"]]);
});

it("reconciles a canceled early adoption to the final nearest page", async () => {
  await nativeScroll(width * 0.61);
  await render({ activeProfileId: "work" });
  await nativeScroll(width * 0.45);
  expect(select.mock.calls).toEqual([["work"]]);
  await act(async () => viewport.dispatchEvent(new Event("scrollend")));
  expect(select.mock.calls).toEqual([["work"], ["personal"]]);
  await render({ activeProfileId: "personal" });
  await nativeScroll(0, true);
  expect(select).toHaveBeenCalledTimes(2);
  expect(scrollTo).not.toHaveBeenCalled();
});

it("keeps explicit navigation to a distant workspace through intermediate dominant pages", async () => {
  await render({
    profiles: [
      ...props.profiles,
      { id: "study", name: "Study", icon: "folder" },
    ],
  });
  scrollTo.mockClear();
  // Model an actual smooth scroll: scrollTo requests movement, later native
  // samples arrive independently instead of jumping straight to its target.
  scrollTo.mockImplementation(() => {});
  await render({ activeProfileId: "study" });
  expect(scrollTo).toHaveBeenCalledExactlyOnceWith({
    left: width * 2,
    behavior: "smooth",
  });
  for (const offset of [0.61, 1, 1.61, 2]) await nativeScroll(width * offset);
  await nativeScroll(width * 2, true);
  expect(select).not.toHaveBeenCalled();
  await nativeScroll(width * 1.39);
  expect(select).toHaveBeenCalledExactlyOnceWith("work");
});

it("waits while a mouse drag is held, then adopts its page before the release snap", async () => {
  await pointer("pointerdown", 240);
  await pointer("pointermove", 44);
  await nativeScroll(width * 0.7);
  expect(select).not.toHaveBeenCalled();
  scrollTo.mockImplementation(() => {});
  await pointer("pointerup", 44);
  expect(viewport.scrollLeft).toBe(width * 0.7);
  expect(select).toHaveBeenCalledExactlyOnceWith("work");
  expect(scrollTo).toHaveBeenCalledExactlyOnceWith({
    left: width,
    behavior: "smooth",
  });
  await render({ activeProfileId: "work" });
  await nativeScroll(width, true);
  expect(select).toHaveBeenCalledTimes(1);
});

it("commits a drag released on a page after its final scroll notification has already settled", async () => {
  await pointer("pointerdown", 300);
  await pointer("pointermove", 20);
  await nativeScroll(280, true);
  await tick(200);
  expect(select).not.toHaveBeenCalled();
  await pointer("pointerup", 20);
  // A scrollTo at this same offset does not produce another scrollend event.
  expect(select).toHaveBeenCalledExactlyOnceWith("work");
  await tick(200);
  expect(select).toHaveBeenCalledTimes(1);
});

it("does not turn an ordinary button interaction into a carousel drag", async () => {
  const button = viewport.querySelector("button")!;
  expect(
    (await pointer("pointerdown", 240, 100, button)).defaultPrevented,
  ).toBe(false);
  expect((await pointer("pointermove", 20, 100, button)).defaultPrevented).toBe(
    false,
  );
  await pointer("pointerup", 20, 100, button);
  expect(viewport.scrollLeft).toBe(0);
  expect(viewport.setPointerCapture).not.toHaveBeenCalled();
  expect(scrollTo).not.toHaveBeenCalled();
  expect(select).not.toHaveBeenCalled();
});

it("leaves touch scrolling and vertically directed mouse movement alone", async () => {
  await pointer("pointerdown", 240, 100, viewport, "touch");
  expect(
    (await pointer("pointermove", 20, 100, viewport, "touch")).defaultPrevented,
  ).toBe(false);
  await pointer("pointerup", 20, 100, viewport, "touch");
  await pointer("pointerdown", 240);
  expect((await pointer("pointermove", 238, 130)).defaultPrevented).toBe(false);
  await pointer("pointermove", 20, 130);
  await pointer("pointerup", 20, 130);
  expect(viewport.scrollLeft).toBe(0);
  expect(viewport.setPointerCapture).not.toHaveBeenCalled();
  expect(select).not.toHaveBeenCalled();
});

it("releases a captured mouse drag when the carousel is disabled", async () => {
  await pointer("pointerdown", 240);
  await pointer("pointermove", 80);
  expect(viewport.hasPointerCapture(7)).toBe(true);
  await render({ enabled: false });
  expect(viewport.hasPointerCapture(7)).toBe(false);
  expect(viewport.hasAttribute("data-profile-dragging")).toBe(false);
  await tick(200);
  expect(select).not.toHaveBeenCalled();
});

it("clears a batched return to the current workspace before later control navigation", async () => {
  await nativeScroll(280, true);
  await nativeScroll(0, true);
  expect(select.mock.calls).toEqual([["work"], ["personal"]]);
  // React may coalesce the two changes, leaving the rendered profile ID alone.
  await render({ activeProfileId: "personal" });
  expect(scrollTo).not.toHaveBeenCalled();
  await render({ activeProfileId: "work" });
  expect(scrollTo).toHaveBeenLastCalledWith({ left: 280, behavior: "smooth" });
  await nativeScroll(280, true);
  expect(select.mock.calls).toEqual([["work"], ["personal"]]);
});

it("releases a blank-space drag on window blur and immediately accepts native scrolling", async () => {
  await pointer("pointerdown", 240);
  await pointer("pointermove", 80);
  expect(viewport.hasPointerCapture(7)).toBe(true);
  expect(viewport.dataset.profileDragging).toBe("true");
  await act(async () => window.dispatchEvent(new Event("blur")));
  expect(viewport.releasePointerCapture).toHaveBeenCalledWith(7);
  expect(viewport.hasPointerCapture(7)).toBe(false);
  expect(viewport.hasAttribute("data-profile-dragging")).toBe(false);
  // No focus or preliminary click is needed after the interrupted mouse drag.
  await nativeScroll(280, true);
  await render({ activeProfileId: "work" });
  await nativeScroll(0, true);
  expect(select.mock.calls).toEqual([["work"], ["personal"]]);
  expect(scrollTo).not.toHaveBeenCalled();
});

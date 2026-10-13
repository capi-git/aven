import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type RefCallback,
} from "react";

export type HoverRevealPanelHandlers = Pick<
  HTMLAttributes<HTMLElement>,
  "onPointerEnter" | "onPointerLeave" | "onFocusCapture" | "onBlurCapture"
> & { ref?: RefCallback<HTMLElement> };
export type HoverRevealHandlers = HoverRevealPanelHandlers;

/** Where a native page drawn above this document sees the pointer: on the
 * page, resting on the hover edge over it, or away from it. */
export type NativePointerRegion = "page" | "edge" | "away";
type Point = { x: number; y: number };

export type HoverRevealPanelOptions = {
  /** Persistent layout state belongs to the caller; hovering never changes it. */
  pinned: boolean;
  enabled?: boolean;
  enterDelay?: number;
  leaveDelay?: number;
};

const INTERACTIONS =
  '[aria-modal="true"], [role="dialog"], [role="menu"], [role="listbox"], [data-popover-side]';
function interactionOpen() {
  return [...document.querySelectorAll<HTMLElement>(INTERACTIONS)].some(
    (element) =>
      !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
      element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility !== "hidden",
  );
}
function delay(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1000, value)) : 0;
}

/** Temporary edge peeks: only bounded event-triggered timers, never idle polling. */
export function useHoverRevealPanel({
  pinned,
  enabled = true,
  enterDelay = 90,
  leaveDelay = 180,
}: HoverRevealPanelOptions) {
  const [temporary, setTemporary] = useState(false);
  const options = useRef({ pinned, enabled, enterDelay, leaveDelay });
  options.current = { pinned, enabled, enterDelay, leaveDelay };
  const shown = useRef(false);
  const enterTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const leaveRequest = useRef(0);
  const leavePending = useRef(false);
  const edge = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLElement | null>(null);
  const pointer = useRef({ edge: false, panel: false });
  const keyboardInteraction = useRef(true);
  /** A panel closed ahead of the owner's re-render, until that commits. */
  const uncommittedClose = useRef<HTMLElement | null>(null);
  /** Native pages drawn above this document report the pointer while it is
   * over them. Meanwhile this document's own last position is stale. */
  const native = useRef({
    regions: new Map<string, NativePointerRegion>(),
    region: "away" as NativePointerRegion,
    owns: false,
    stale: null as Point | null,
    last: null as Point | null,
  });
  /** Whether a document pointer event reflects the real pointer. While a
   * native page holds it, WebKit replays its last position after layout
   * changes; a replay must not count as hovering the edge or the panel. */
  const live = useCallback((event: { clientX: number; clientY: number }) => {
    const state = native.current;
    if (
      state.owns &&
      state.stale &&
      event.clientX === state.stale.x &&
      event.clientY === state.stale.y
    )
      return false;
    state.owns = false;
    return true;
  }, []);

  const cancelEnter = useCallback(() => {
    if (enterTimer.current !== undefined) clearTimeout(enterTimer.current);
    enterTimer.current = undefined;
  }, []);
  const cancelLeave = useCallback(() => {
    if (leaveTimer.current !== undefined) clearTimeout(leaveTimer.current);
    leaveTimer.current = undefined;
    leavePending.current = false;
    leaveRequest.current += 1;
  }, []);
  const containsFocus = useCallback(() => {
    const active = document.activeElement;
    return (
      keyboardInteraction.current &&
      !!active &&
      (!!edge.current?.contains(active) || !!panel.current?.contains(active))
    );
  }, []);
  const dismiss = useCallback(() => {
    cancelEnter();
    cancelLeave();
    pointer.current = { edge: false, panel: false };
    if (!shown.current) return;
    shown.current = false;
    // A closing peek becomes inert; do not leave keyboard focus inside it.
    const active = document.activeElement;
    if (
      !options.current.pinned &&
      active instanceof HTMLElement &&
      panel.current?.contains(active)
    )
      active.blur();
    // Start the CSS close now. The owner's re-render (the whole workspace for
    // the sidebar) follows as interruptible work, so it neither delays the
    // first closing frame nor blocks the compositor-driven fade.
    // Pinning also ends a peek, but the panel stays open.
    if (!options.current.pinned && panel.current?.dataset.open === "true") {
      panel.current.dataset.open = "false";
      uncommittedClose.current = panel.current;
    }
    startTransition(() => setTemporary(false));
  }, [cancelEnter, cancelLeave]);
  const reveal = useCallback(() => {
    cancelEnter();
    cancelLeave();
    // WK can retain a hidden page-visibility value while the native window is
    // visible but unfocused. A delivered pointer/focus event is current intent;
    // requiring a visibility update first would make hover depend on a click.
    // Actual blur/hide events still dismiss and cancel pending peeks below.
    if (!options.current.enabled || options.current.pinned) return;
    if (shown.current) return;
    shown.current = true;
    // Returning before the close committed: React still renders the panel
    // open, so restore the attribute it will not rewrite.
    if (uncommittedClose.current) {
      uncommittedClose.current.dataset.open = "true";
      uncommittedClose.current = null;
    }
    setTemporary(true);
  }, [cancelEnter, cancelLeave]);
  const scheduleClose = useCallback(() => {
    if (
      !shown.current ||
      options.current.pinned ||
      pointer.current.edge ||
      pointer.current.panel ||
      containsFocus() ||
      interactionOpen()
    ) {
      cancelLeave();
      return;
    }
    // Repeated focus/portal observations must not push back a pending close.
    if (leavePending.current) return;
    leavePending.current = true;
    const request = ++leaveRequest.current;
    const close = () => {
      if (request !== leaveRequest.current) return;
      leavePending.current = false;
      leaveTimer.current = undefined;
      if (
        !pointer.current.edge &&
        !pointer.current.panel &&
        !containsFocus() &&
        !interactionOpen()
      )
        dismiss();
    };
    const wait = delay(options.current.leaveDelay);
    // Let enter/leave events finish crossing the edge into the panel, then
    // begin closing before the next paint instead of waiting on a browser timer.
    if (wait === 0) queueMicrotask(close);
    else leaveTimer.current = setTimeout(close, wait);
  }, [cancelLeave, containsFocus, dismiss]);

  /** The pointer moved somewhere this document cannot see, such as a native
   * page drawn above it. Treat it as leaving both the edge and the panel. */
  const pointerLeft = useCallback(() => {
    pointer.current = { edge: false, panel: false };
    cancelEnter();
    scheduleClose();
  }, [cancelEnter, scheduleClose]);

  /** The pointer reached the edge; a short rest there reveals the panel. */
  const enterEdge = useCallback(() => {
    if (!options.current.enabled) return;
    if (!shown.current) keyboardInteraction.current = false;
    pointer.current.edge = true;
    cancelLeave();
    cancelEnter();
    if (!options.current.pinned && !shown.current)
      enterTimer.current = setTimeout(() => {
        enterTimer.current = undefined;
        if (pointer.current.edge) reveal();
      }, delay(options.current.enterDelay));
  }, [cancelEnter, cancelLeave, reveal]);

  /** A native page reports where it sees the pointer; `source` names the
   * page. Any page's hover edge counts as the edge, any page holding the
   * pointer as leaving the panel, and none as the pointer coming back here. */
  const nativePointer = useCallback(
    (source: string, region: NativePointerRegion) => {
      const state = native.current;
      if (region === "away") state.regions.delete(source);
      else state.regions.set(source, region);
      const regions = [...state.regions.values()];
      const next: NativePointerRegion = regions.includes("edge")
        ? "edge"
        : regions.length
          ? "page"
          : "away";
      if (next === state.region) return;
      state.region = next;
      if (next === "away") {
        // Off the page: onto this document, which places the pointer with its
        // next live event, or out of the window. Off the edge either way.
        if (state.owns) pointerLeft();
        return;
      }
      if (!state.owns) {
        state.owns = true;
        state.stale = state.last;
      }
      if (next === "edge") enterEdge();
      else pointerLeft();
    },
    [enterEdge, pointerLeft],
  );

  // The hook tracks its edge and panel from mount, not only once hovered, so
  // a pointer returning from a native page can be placed on either.
  const edgeRef = useCallback<RefCallback<HTMLElement>>((element) => {
    edge.current = element;
  }, []);
  const panelRef = useCallback<RefCallback<HTMLElement>>((element) => {
    panel.current = element;
  }, []);

  const edgeHandlers = useMemo<HoverRevealPanelHandlers>(
    () => ({
      ref: edgeRef,
      onPointerEnter: (event) => {
        if (event.pointerType === "touch" || !options.current.enabled) return;
        if (!event.currentTarget.contains(event.target as Node)) return;
        if (!live(event)) return;
        edge.current = event.currentTarget;
        enterEdge();
      },
      onPointerLeave: () => {
        pointer.current.edge = false;
        cancelEnter();
        scheduleClose();
      },
      onFocusCapture: (event) => {
        if (!event.currentTarget.contains(event.target as Node)) return;
        edge.current = event.currentTarget;
        reveal();
      },
      onBlurCapture: () => queueMicrotask(scheduleClose),
    }),
    [cancelEnter, edgeRef, enterEdge, live, reveal, scheduleClose],
  );

  const panelHandlers = useMemo<HoverRevealPanelHandlers>(
    () => ({
      ref: panelRef,
      onPointerEnter: (event) => {
        if (!event.currentTarget.contains(event.target as Node)) return;
        if (!live(event)) return;
        panel.current = event.currentTarget;
        pointer.current.panel = true;
        cancelLeave();
      },
      onPointerLeave: (event) => {
        panel.current = event.currentTarget;
        pointer.current.panel = false;
        scheduleClose();
      },
      onFocusCapture: (event) => {
        if (!event.currentTarget.contains(event.target as Node)) return;
        panel.current = event.currentTarget;
        cancelLeave();
        reveal();
      },
      onBlurCapture: () => queueMicrotask(scheduleClose),
    }),
    [cancelLeave, live, panelRef, reveal, scheduleClose],
  );

  useEffect(() => {
    if (!enabled) return;
    // Remember where this document last saw the pointer. After a native page
    // held it, the first live event places it again: WebKit sends no enter
    // event for an element it still believes is under the pointer.
    const remember = (event: PointerEvent) => {
      const state = native.current;
      const reclaimed = state.owns && live(event);
      state.last = { x: event.clientX, y: event.clientY };
      if (!reclaimed || !(event.target instanceof Node)) return;
      if (edge.current?.contains(event.target)) {
        if (!pointer.current.edge) enterEdge();
      } else if (panel.current?.contains(event.target)) {
        pointer.current.panel = true;
        cancelLeave();
      }
    };
    document.addEventListener("pointermove", remember, true);
    document.addEventListener("pointerdown", remember, true);
    return () => {
      document.removeEventListener("pointermove", remember, true);
      document.removeEventListener("pointerdown", remember, true);
    };
  }, [enabled, cancelLeave, enterEdge, live]);

  useEffect(() => {
    if (!enabled || pinned) return;
    // A mouse click leaves focus on buttons and search fields. That focus must
    // not pin a hover peek open; keyboard navigation still retains the panel.
    const pointerDown = () => {
      keyboardInteraction.current = false;
      scheduleClose();
    };
    const keyDown = (event: KeyboardEvent) => {
      if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
      keyboardInteraction.current = true;
      if (containsFocus()) cancelLeave();
    };
    document.addEventListener("pointerdown", pointerDown, true);
    document.addEventListener("keydown", keyDown, true);
    return () => {
      document.removeEventListener("pointerdown", pointerDown, true);
      document.removeEventListener("keydown", keyDown, true);
    };
  }, [enabled, pinned, cancelLeave, containsFocus, scheduleClose]);

  const visible = enabled && (pinned || temporary);
  useLayoutEffect(() => {
    // The early close below writes the attribute directly. React only rewrites
    // it when its own value changes. Pinning can leave `visible` true, so it
    // needs this repair; an unrelated owner render must not undo the close.
    // Re-revealing before the close commits repairs the attribute in reveal().
    if (visible && panel.current && panel.current.dataset.open !== "true")
      panel.current.dataset.open = "true";
    if (visible || !temporary) uncommittedClose.current = null;
  }, [visible, pinned, temporary]);

  useEffect(() => {
    // Pin/unpin and project availability changes discard a previous hover.
    dismiss();
  }, [pinned, enabled, dismiss]);

  useEffect(() => {
    // These two listeners also cancel a pending edge-entry timer on blur/hide.
    const hidden = () => {
      if (document.visibilityState === "hidden") dismiss();
    };
    window.addEventListener("blur", dismiss);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("blur", dismiss);
      document.removeEventListener("visibilitychange", hidden);
      cancelEnter();
      cancelLeave();
      shown.current = false;
    };
  }, [cancelEnter, cancelLeave, dismiss]);

  useEffect(() => {
    if (!temporary || !enabled || pinned) return;
    // Portalled menus leave the panel DOM. Keep its anchor mounted until the
    // interaction closes, then resume the ordinary leave/focus decision.
    const relevant = (node: Node) =>
      node instanceof HTMLElement &&
      (node.matches(INTERACTIONS) || !!node.querySelector(INTERACTIONS));
    const observer = new MutationObserver((records) => {
      if (
        records.some((record) =>
          record.type === "attributes"
            ? relevant(record.target)
            : [...record.addedNodes, ...record.removedNodes].some(relevant),
        )
      )
        scheduleClose();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "hidden",
        "inert",
        "aria-hidden",
        "aria-modal",
        "open",
        "style",
        "class",
      ],
    });
    // React's enter/leave events follow its component tree across portals.
    // Native over/out events instead tell us which DOM scope owns the pointer.
    const trackPointer = (target: EventTarget | null) => {
      const node = target instanceof Node ? target : null;
      const next = {
        edge: !!node && !!edge.current?.contains(node),
        panel: !!node && !!panel.current?.contains(node),
      };
      if (
        next.edge === pointer.current.edge &&
        next.panel === pointer.current.panel
      )
        return;
      pointer.current = next;
      if (!next.edge) cancelEnter();
      scheduleClose();
    };
    const pointerOver = (event: PointerEvent) => {
      if (live(event)) trackPointer(event.target);
    };
    const pointerOut = (event: PointerEvent) => {
      if (live(event)) trackPointer(event.relatedTarget);
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || interactionOpen())
        return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    };
    document.addEventListener("focusin", scheduleClose);
    document.addEventListener("keydown", keyDown);
    document.addEventListener("pointerover", pointerOver, true);
    document.addEventListener("pointerout", pointerOut, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("focusin", scheduleClose);
      document.removeEventListener("keydown", keyDown);
      document.removeEventListener("pointerover", pointerOver, true);
      document.removeEventListener("pointerout", pointerOut, true);
    };
  }, [temporary, enabled, pinned, cancelEnter, dismiss, live, scheduleClose]);

  return {
    visible,
    revealed: enabled && !pinned && temporary,
    edgeHandlers,
    panelHandlers,
    reveal,
    dismiss,
    pointerLeft,
    nativePointer,
  };
}

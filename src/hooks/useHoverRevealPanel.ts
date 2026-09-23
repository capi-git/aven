import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
} from "react";

export type HoverRevealPanelHandlers = Pick<
  HTMLAttributes<HTMLElement>,
  "onPointerEnter" | "onPointerLeave" | "onFocusCapture" | "onBlurCapture"
>;
export type HoverRevealHandlers = HoverRevealPanelHandlers;

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
    setTemporary(false);
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

  const edgeHandlers = useMemo<HoverRevealPanelHandlers>(
    () => ({
      onPointerEnter: (event) => {
        if (event.pointerType === "touch" || !options.current.enabled) return;
        if (!event.currentTarget.contains(event.target as Node)) return;
        edge.current = event.currentTarget;
        if (!shown.current) keyboardInteraction.current = false;
        pointer.current.edge = true;
        cancelLeave();
        cancelEnter();
        if (!options.current.pinned && !shown.current)
          enterTimer.current = setTimeout(() => {
            enterTimer.current = undefined;
            if (pointer.current.edge) reveal();
          }, delay(options.current.enterDelay));
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
    [cancelEnter, cancelLeave, reveal, scheduleClose],
  );

  const panelHandlers = useMemo<HoverRevealPanelHandlers>(
    () => ({
      onPointerEnter: (event) => {
        if (!event.currentTarget.contains(event.target as Node)) return;
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
    [cancelLeave, reveal, scheduleClose],
  );

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
    const pointerOver = (event: PointerEvent) => trackPointer(event.target);
    const pointerOut = (event: PointerEvent) =>
      trackPointer(event.relatedTarget);
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
  }, [temporary, enabled, pinned, cancelEnter, dismiss, scheduleClose]);

  return {
    visible: enabled && (pinned || temporary),
    revealed: enabled && !pinned && temporary,
    edgeHandlers,
    panelHandlers,
    reveal,
    dismiss,
  };
}

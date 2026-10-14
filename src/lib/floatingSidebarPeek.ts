export type PeekTimers = {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
};

export type SidebarPeekOptions = {
  /** Rest on the edge this long before revealing, so a passing pointer does not flash the card. */
  enterDelay: number;
  /** A short grace on leave absorbs the gap between the edge and the card. */
  leaveDelay: number;
  onChange(open: boolean, animated: boolean): void;
  timers?: PeekTimers;
};

const browserTimers: PeekTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Decides when the native hover sidebar opens and closes. Native code reports
 * where the pointer is (the reveal edge, or the card and its menus); the
 * overlay reports menus, drags and keyboard focus that keep the card out.
 */
export function createSidebarPeek({
  enterDelay,
  leaveDelay,
  onChange,
  timers = browserTimers,
}: SidebarPeekOptions) {
  let enabled = false;
  let open = false;
  let edge = false;
  let inside = false;
  let interaction = false;
  let focus = false;
  let enterTimer: unknown;
  let leaveTimer: unknown;

  const cancelEnter = () => {
    if (enterTimer !== undefined) timers.clear(enterTimer);
    enterTimer = undefined;
  };
  const cancelLeave = () => {
    if (leaveTimer !== undefined) timers.clear(leaveTimer);
    leaveTimer = undefined;
  };
  const held = () => edge || inside || interaction || focus;
  const show = () => {
    cancelEnter();
    cancelLeave();
    if (!enabled || open) return;
    open = true;
    onChange(true, true);
  };
  const hide = (animated: boolean) => {
    cancelEnter();
    cancelLeave();
    if (!open) return;
    open = false;
    onChange(false, animated);
  };
  const scheduleClose = () => {
    cancelLeave();
    if (!open || held()) return;
    leaveTimer = timers.set(() => {
      leaveTimer = undefined;
      if (!held()) hide(true);
    }, leaveDelay);
  };

  return {
    get open() {
      return open;
    },
    /** Pinned or unavailable: no new reveals. An open card stays until dismissed. */
    setEnabled(next: boolean) {
      enabled = next;
      if (!next) cancelEnter();
    },
    pointer(next: { inside: boolean; edge: boolean }) {
      const entered = next.edge && !edge;
      inside = next.inside;
      edge = next.edge;
      if (!edge) cancelEnter();
      if (entered && !open && enabled) {
        cancelEnter();
        enterTimer = timers.set(() => {
          enterTimer = undefined;
          if (edge) show();
        }, enterDelay);
      }
      scheduleClose();
    },
    activity(next: { interaction: boolean; focus: boolean }) {
      interaction = next.interaction;
      focus = next.focus;
      scheduleClose();
    },
    /** Open now, as a keyboard reveal of the edge does. */
    reveal() {
      show();
    },
    dismiss(animated = true) {
      hide(animated);
    },
    /** Forget everything after the native layer reattaches closed. */
    reset() {
      cancelEnter();
      cancelLeave();
      open = false;
      edge = inside = interaction = focus = false;
    },
  };
}

export type SidebarPeek = ReturnType<typeof createSidebarPeek>;

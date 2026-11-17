/**
 * A chat that is not in front of its pane stays laid out, moved out of sight
 * (see WorkspaceStage.css), and is not inert: in WebKit, toggling `inert` or
 * `visibility` on a chat restyles every element in it, on each switch, both
 * ways. Keyboard focus is kept out of such a "parked" surface here instead.
 */

const TABBABLE = [
  "a[href]",
  "button:not(:disabled)",
  'input:not(:disabled):not([type="hidden"])',
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  '[contenteditable]:not([contenteditable="false"])',
  "[tabindex]",
].join(", ");

/** Inside a surface or part of the window that cannot take focus. */
export function outOfReach(element: Element): boolean {
  return !!element.closest("[hidden], [inert]");
}

let tabbing: { back: boolean } | null = null;
let tabbingClear = 0;

/**
 * Note a Tab press: the focus move it makes follows in the same task, so a
 * parked surface can pass focus on rather than hand it back. Listen on the
 * document in the capture phase.
 */
export function noteTabKey(event: KeyboardEvent) {
  if (event.key !== "Tab" || event.defaultPrevented) return;
  tabbing = { back: event.shiftKey };
  window.clearTimeout(tabbingClear);
  tabbingClear = window.setTimeout(() => {
    tabbing = null;
  }, 0);
}

/** Whether a Tab press is moving focus right now (see `noteTabKey`). */
export function tabMoving(): { back: boolean } | null {
  return tabbing;
}

/**
 * Where focus goes when it lands on `target` in a parked surface: for a Tab
 * press, the next control in that direction that can take focus (wrapping
 * around); otherwise back where it came `from`, when that can still take it.
 * Null leaves focus nowhere.
 */
export function focusOutsideParked(
  target: Element,
  from: Element | null,
  tab: { back: boolean } | null,
  {
    root = document,
    laidOut = (element: Element) => element.getClientRects().length > 0,
  }: { root?: Document; laidOut?: (element: Element) => boolean } = {},
): HTMLElement | null {
  if (tab) {
    const candidates = [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter(
      (element) =>
        element.tabIndex >= 0 && !outOfReach(element) && laidOut(element),
    );
    const after = (element: Element) =>
      !!(
        target.compareDocumentPosition(element) &
        Node.DOCUMENT_POSITION_FOLLOWING
      );
    const next = tab.back
      ? (candidates.findLast((element) => !after(element)) ?? candidates.at(-1))
      : (candidates.find(after) ?? candidates[0]);
    return next ?? null;
  }
  if (
    from instanceof HTMLElement &&
    from.isConnected &&
    !outOfReach(from) &&
    laidOut(from)
  )
    return from;
  return null;
}

/**
 * Keep focus out of a parked surface: call from its focus-in handler with
 * the element that took focus and the one that had it.
 */
export function refuseParkedFocus(target: Element, from: Element | null) {
  const next = focusOutsideParked(target, from, tabMoving());
  if (next) next.focus({ preventScroll: true });
  else if (target instanceof HTMLElement) target.blur();
}

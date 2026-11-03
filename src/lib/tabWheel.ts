/**
 * Switching tabs with the mouse wheel: hover a tab strip and scroll, and
 * the next (or previous) tab comes to the front. A trackpad's small deltas
 * add up to one step; a flick never skips several tabs at once, and a
 * sideways scroll still scrolls the strip itself.
 */

/** How far the wheel turns (in pixels of delta) before one step. */
export const TAB_WHEEL_STEP = 48;
/** Steps come no faster than this, so a flick is one step. */
export const TAB_WHEEL_COOLDOWN_MS = 160;

export type TabWheelState = {
  carried: number;
  /** When the wheel last turned, and when a step last happened. */
  turnedAt: number;
  steppedAt: number;
};

export const TAB_WHEEL_START: TabWheelState = {
  carried: 0,
  turnedAt: 0,
  steppedAt: 0,
};

/**
 * What one wheel event does: a step of -1 or 1 (previous or next tab), or 0
 * for not yet, with the state to carry to the next event. Only a mostly
 * vertical turn counts: a sideways one is the strip scrolling.
 */
export function tabWheelStep(
  state: TabWheelState,
  wheel: { deltaX: number; deltaY: number; now: number },
): { step: -1 | 0 | 1; state: TabWheelState } {
  if (Math.abs(wheel.deltaY) <= Math.abs(wheel.deltaX))
    return { step: 0, state };
  // A new gesture after a pause starts from nothing: an old remainder
  // doesn't make the first notch of the next one count double.
  const fresh = wheel.now - state.turnedAt > 400;
  const carried = (fresh ? 0 : state.carried) + wheel.deltaY;
  const turned = { ...state, turnedAt: wheel.now };
  if (Math.abs(carried) < TAB_WHEEL_STEP)
    return { step: 0, state: { ...turned, carried } };
  if (wheel.now - state.steppedAt < TAB_WHEEL_COOLDOWN_MS)
    // Too soon: drop the turn, so a flick lands on one tab, not three.
    return { step: 0, state: { ...turned, carried: 0 } };
  return {
    step: carried > 0 ? 1 : -1,
    state: { carried: 0, turnedAt: wheel.now, steppedAt: wheel.now },
  };
}

/**
 * The tab a step lands on among a strip's tab buttons: from the selected
 * one (else the first), stopping at the ends rather than wrapping, so the
 * last notch of a scroll never jumps back to the start.
 */
export function tabAfterStep<T extends { selected: boolean }>(
  tabs: readonly T[],
  step: -1 | 1,
): T | undefined {
  if (!tabs.length) return undefined;
  const current = Math.max(
    0,
    tabs.findIndex((tab) => tab.selected),
  );
  const next = Math.min(tabs.length - 1, Math.max(0, current + step));
  return next === current ? undefined : tabs[next];
}

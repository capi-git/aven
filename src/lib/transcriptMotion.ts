import { MOTION_EASE, motionReduced } from "./motion";

/**
 * Which turns of a transcript rise in as they arrive. Only a new last turn
 * that appears while the transcript is on screen does: the turns it opened
 * with, older turns loaded later, and turns that came while its tab was
 * hidden appear in place. A turn keeps its answer for as long as it exists,
 * so a re-render never starts or stops its animation.
 */
export class TurnEntrances {
  private known: Set<string> | null = null;
  private entered = new Set<string>();
  private wasVisible = false;

  /**
   * During render: notes whether the last turn is new. Repeating it for the
   * same commit, as React's development double render does, changes nothing.
   */
  observe(lastId: string | undefined, visible: boolean): void {
    if (
      this.known &&
      lastId &&
      visible &&
      this.wasVisible &&
      !this.known.has(lastId)
    )
      this.entered.add(lastId);
  }

  /** After a commit that changed the turns or visibility: these are known. */
  commit(ids: readonly string[], visible: boolean): void {
    this.known = new Set(ids);
    for (const id of this.entered)
      if (!this.known.has(id)) this.entered.delete(id);
    this.wasVisible = visible;
  }

  /** Whether this turn arrived on screen and rises in. */
  rises(id: string): boolean {
    return this.entered.has(id);
  }

  /** Whether the transcript has committed at least once. */
  get started(): boolean {
    return this.known !== null;
  }
}

/** A follow longer than this jumps: it is a new block, not a line. */
export const FOLLOW_GLIDE_MAX_PX = 160;
export const FOLLOW_GLIDE_MS = 240;

/**
 * While an agent writes and the transcript follows its end, each new line
 * scrolls the transcript up by its height. This eases that step: the content
 * starts where it was drawn and glides up to where the scroll put it, on the
 * compositor (a transform added to whatever it has), so the reply's growth
 * reads as one smooth rise. The scroll offset itself is untouched.
 */
export function glideFollow(content: Element | null, delta: number): boolean {
  if (
    !content ||
    delta < 1 ||
    delta > FOLLOW_GLIDE_MAX_PX ||
    motionReduced() ||
    typeof content.animate !== "function"
  )
    return false;
  content.animate(
    [{ transform: `translateY(${delta}px)` }, { transform: "none" }],
    { duration: FOLLOW_GLIDE_MS, easing: MOTION_EASE.out, composite: "add" },
  );
  return true;
}

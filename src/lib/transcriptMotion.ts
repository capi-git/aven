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

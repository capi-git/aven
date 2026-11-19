/**
 * While a divider or a panel's edge is dragged, each chat on screen keeps the
 * width its column had when the drag began. Without this, every frame of the
 * drag re-wraps all of a chat's text and rescales its pictures (often 2000 px
 * screenshots drawn small), and the heights that change move everything
 * below. The pane clips the held column, or leaves room beside it, until the
 * drop; then the column fits its pane once, and the transcript's own resize
 * handling keeps the reader at the end or on the line they were reading.
 */

/** The chat's reading column, inside its scroller (`AgentTranscript`). */
export const TRANSCRIPT_COLUMN = ".personal-transcript-content";

type Held = {
  column: HTMLElement;
  scroller: HTMLElement | null;
  width: string;
  overflowX: string;
};

/**
 * Hold every on-screen chat column inside `root` at its current width. One
 * layout read at the start, for all columns before any is written; nothing
 * per frame. Chats parked out of sight (under `[hidden]`) keep their size
 * during drags anyway and are left alone. Returns the release, which puts
 * back exactly what was there and is safe to call more than once.
 */
export function holdTranscriptWidths(root: ParentNode | null): () => void {
  if (!root) return () => {};
  const found: { column: HTMLElement; width: string }[] = [];
  for (const column of root.querySelectorAll<HTMLElement>(TRANSCRIPT_COLUMN)) {
    if (column.closest("[hidden]")) continue;
    const width = column.ownerDocument.defaultView
      ?.getComputedStyle(column)
      .getPropertyValue("width");
    // A column with no box ("auto", or nothing laid out) has nothing to hold.
    if (!width || !width.endsWith("px") || !(Number.parseFloat(width) > 0))
      continue;
    found.push({ column, width });
  }
  const held: Held[] = found.map(({ column, width }) => {
    const scroller = column.parentElement;
    const entry: Held = {
      column,
      scroller,
      width: column.style.width,
      overflowX: scroller?.style.overflowX ?? "",
    };
    column.style.width = width;
    // A narrower pane clips the column rather than scrolling sideways: a
    // sideways scrollbar would also take height from the chat.
    if (scroller) scroller.style.overflowX = "hidden";
    return entry;
  });
  let released = held.length === 0;
  return () => {
    if (released) return;
    released = true;
    for (const { column, scroller, width, overflowX } of held) {
      column.style.width = width;
      if (scroller) scroller.style.overflowX = overflowX;
    }
  };
}

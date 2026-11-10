/**
 * Models often number a list on from an earlier one, straight under a bold
 * title line:
 *
 *     **One word for one thing**
 *     4. **Four names for your role.** …
 *     5. **Three status words.** …
 *
 * CommonMark lets only a list that starts at 1 interrupt a paragraph, so these
 * items join the title into one paragraph and their line breaks become spaces.
 * This puts a blank line before such an item, so it starts the list the writer
 * meant. Only the first item of a list that follows plain text is touched:
 * items inside a list, quotes, indented code and fenced code stay as written.
 * The change depends only on the text up to the line it changes, so a reply
 * that is still streaming keeps its earlier blocks.
 */

const ORDERED_ITEM = /^ {0,3}\d{1,9}[.)][ \t]+\S/;
const LIST_ITEM = /^ {0,3}(?:\d{1,9}[.)]|[-*+])(?:[ \t]|$)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const BLANK = /^[ \t]*$/;

/** Lines that start a block of their own: a new list may follow directly. */
const OWN_BLOCK = /^ {0,3}(?:#{1,6}(?:[ \t]|$)|>|\||(?:[-*_][ \t]*){3,}$)/;

export function separateNumberedLists(markdown: string): string {
  // Fast path: no line starts with a number after another line.
  if (!/\n {0,3}\d{1,9}[.)][ \t]/.test(markdown)) return markdown;
  const lines = markdown.split("\n");
  const out: string[] = [];
  let fence: string | null = null;
  // The current paragraph has plain text and no list item since the last
  // blank line.
  let inText = false;
  let inList = false;
  for (const line of lines) {
    const fenceMatch = FENCE.exec(line);
    if (fence) {
      out.push(line);
      if (
        fenceMatch &&
        fenceMatch[1][0] === fence[0] &&
        fenceMatch[1].length >= fence.length
      ) {
        fence = null;
      }
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      inText = false;
      inList = false;
      out.push(line);
      continue;
    }
    if (BLANK.test(line)) {
      // A list carries on past a blank line while its items are indented.
      inText = false;
      out.push(line);
      continue;
    }
    if (LIST_ITEM.test(line)) {
      if (
        inText &&
        !inList &&
        ORDERED_ITEM.test(line) &&
        !/^ {0,3}0*1[.)]/.test(line)
      ) {
        out.push("");
      }
      inList = true;
      inText = false;
      out.push(line);
      continue;
    }
    if (/^(?: {4}|\t)/.test(line)) {
      // Indented: a list item's own text, or code. Neither starts a list here.
      out.push(line);
      continue;
    }
    if (OWN_BLOCK.test(line)) {
      inText = false;
      inList = false;
      out.push(line);
      continue;
    }
    // Plain text straight under a list's line carries that item on; after a
    // blank line it is a new paragraph.
    const previous = out[out.length - 1];
    if (previous === undefined || BLANK.test(previous)) inList = false;
    inText = !inList;
    out.push(line);
  }
  return out.join("\n");
}

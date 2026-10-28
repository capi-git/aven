import {
  isBoardTab,
  isSimulatorTab,
  type FilePaneTab,
  type WorkspaceTab,
} from "./layout";

/**
 * What a file pane draws above its content, naming it once:
 *
 * - `tabs`: its row of file tabs. Several files always have one. A lone
 *   file has one only where nothing names it yet: not when a tab row above
 *   already names its workspace tab, nor for a board alone in its tab.
 * - `soloSimulator`: a lone iPhone's pickers and Run are the pane's one
 *   header row, with the pane's tools at their end, rather than a tab
 *   named iPhone above another row.
 */
export function filePaneHeader(
  files: readonly FilePaneTab[],
  {
    inner,
    namedAbove,
  }: {
    /** One of several panes in its tab: it has its own strip to drag by. */
    inner: boolean;
    /** A tab row above (a pane's or the window's) names its workspace tab. */
    namedAbove: boolean;
  },
): { tabs: boolean; soloSimulator: boolean } {
  const single = files.length === 1 ? files[0] : undefined;
  const soloSimulator = !!single && isSimulatorTab(single);
  const tabs =
    files.length > 0 &&
    !soloSimulator &&
    !(single && !inner && (namedAbove || isBoardTab(single)));
  return { tabs, soloSimulator };
}

/**
 * Whether a workspace tab draws a header row of its own: a tab holding only
 * a file pane whose files (or iPhone) need one. Its pane's title row then
 * lends it the row rather than naming the tab above it.
 */
export function workspaceTabOwnHeader(
  tab: Pick<WorkspaceTab, "layout" | "editorPanes" | "terminalPanes">,
  namedAbove: boolean,
): boolean {
  const { layout } = tab;
  if (layout.type !== "leaf") return false;
  const pane = [...tab.editorPanes, ...(tab.terminalPanes ?? [])].find(
    (entry) => entry.id === layout.id,
  );
  if (!pane) return false;
  const header = filePaneHeader(pane.files, { inner: false, namedAbove });
  return header.tabs || header.soloSimulator;
}

/**
 * A pane's title row, naming its tab once. In a space (several panes) every
 * pane has one: a row of its tabs, or its lone tab's name. A single pane's
 * tabs are on the window's strip, so its title row stays only to name a tab
 * the strip does not show or to lend its row to a tab that draws a header
 * of its own (`ownHeader`, told whether a tab row above names that tab). A
 * tab split into panes, alone, names itself in each.
 *
 * `named`: a tab row above already names the tab in front (the pane's own
 * row of tabs in a space, the window's strip for a single pane). `lend`:
 * the tab in front draws its own header row (in the title row when the
 * pane holds it alone, under the row of tabs otherwise).
 */
export function paneTitleRow({
  space,
  named,
  split,
  ownHeader,
}: {
  space: boolean;
  named: boolean;
  split: boolean;
  ownHeader: (namedAbove: boolean) => boolean;
}): { row: boolean; lend: boolean } {
  const lend = ownHeader(named);
  if (space) return { row: true, lend };
  return { row: !split && (!named || lend), lend };
}

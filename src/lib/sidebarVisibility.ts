/**
 * Whether the workspace sidebar is on screen, so its project lists and
 * previews stay current.
 *
 * With the native floating layer (macOS) the DOM hover peek is disabled and
 * its `visible` is always false, so the docked sidebar (`pinned`) and the
 * native layer's own reveal count instead. Relying on the DOM peek alone left
 * other projects' tasks frozen, usually empty, in both sidebars.
 */
export function sidebarOnScreen({
  hoverVisible,
  native,
  pinned,
  floatingRevealed,
}: {
  /** The DOM hover peek, or the docked DOM sidebar, is showing. */
  hoverVisible: boolean;
  /** The native floating layer replaces the DOM peek. */
  native: boolean;
  /** The sidebar is docked open. */
  pinned: boolean;
  /** The native floating layer is revealed. */
  floatingRevealed: boolean;
}): boolean {
  return hoverVisible || (native && (pinned || floatingRevealed));
}

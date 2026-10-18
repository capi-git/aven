/**
 * ⌘W with the keyboard in the window's floating team panel closes that
 * panel, not the chat pane behind it. Returns whether it did.
 */
export function closeFocusedTeamPanel(doc: Document = document): boolean {
  const active = doc.activeElement;
  const panel =
    active instanceof Element ? active.closest("[data-team-panel]") : null;
  const close = panel?.querySelector<HTMLElement>("[data-team-close]");
  if (!close) return false;
  close.click();
  return true;
}

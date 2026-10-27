/**
 * Where the keyboard goes when it is handed to a pane (Esc on its title row,
 * or stepping to it with ⌃⌥⇥): its message box first, then any other text
 * field, then its first control. One selector would take the first match in
 * document order, which in a chat is a transcript button (Approve) before
 * the message box.
 */
const PANE_FOCUS_ORDER = [
  "[data-composer] textarea:not(:disabled)",
  "textarea:not(:disabled)",
  '[contenteditable="true"]',
  'input:not(:disabled):not([type="hidden"])',
  '[tabindex="0"]',
  "button:not(:disabled)",
];

/** Not inside a hidden, inert or unannounced part of the pane. */
const reachable = (element: Element) =>
  !element.closest('[hidden], [inert], [aria-hidden="true"]');

/** A visible workspace pane: the one with `id`, or the focused one. */
export function workspacePane(id?: string): HTMLElement | null {
  const stage = document.querySelector<HTMLElement>(
    "[data-workspace-stage]:not([hidden])",
  );
  return (
    [
      ...(stage?.querySelectorAll<HTMLElement>("[data-workspace-surface]") ??
        []),
    ].find((node) =>
      id
        ? node.dataset.workspaceSurface === id
        : node.dataset.focused === "true",
    ) ?? null
  );
}

/** Focus a pane's content; false when it has nothing to focus. */
export function focusPaneContent(pane: HTMLElement | null): boolean {
  if (!pane) return false;
  for (const selector of PANE_FOCUS_ORDER) {
    const target = [...pane.querySelectorAll<HTMLElement>(selector)].find(
      reachable,
    );
    if (target) {
      target.focus({ preventScroll: true });
      return true;
    }
  }
  return false;
}

import { useCallback, useEffect, useRef } from "react";

function canRestoreFocus(element: HTMLElement): boolean {
  if (!element.isConnected || element.matches(":disabled")) return false;
  for (
    let node: HTMLElement | null = element;
    node;
    node = node.parentElement
  ) {
    if (
      node.hidden ||
      node.hasAttribute("inert") ||
      node.getAttribute("aria-hidden") === "true"
    )
      return false;
    const style = getComputedStyle(node);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.contentVisibility === "hidden"
    )
      return false;
  }
  return true;
}

/** Capture before a full-screen utility opens; restore only after its dismissal. */
export function useReturnFocus() {
  const opener = useRef<HTMLElement | null>(null);
  const frame = useRef<number | null>(null);

  const clearReturnFocus = useCallback(() => {
    if (frame.current != null) cancelAnimationFrame(frame.current);
    frame.current = null;
    opener.current = null;
  }, []);

  const captureReturnFocus = useCallback(() => {
    // The workspace may be inert while another full-screen utility is open.
    // Keep its opener through utility-to-utility transitions.
    if (opener.current?.isConnected) return;
    if (frame.current != null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body)
      opener.current = active;
  }, []);

  const restoreReturnFocus = useCallback(() => {
    if (frame.current != null) cancelAnimationFrame(frame.current);
    const target = opener.current;
    opener.current = null;
    if (!target) return;
    // Let React remove the utility first. A destination opened by the same
    // action (file, conversation, or another utility) can claim focus meanwhile.
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const active = document.activeElement;
      if (
        canRestoreFocus(target) &&
        (active === document.body || !active?.isConnected)
      )
        target.focus({ preventScroll: true });
    });
  }, []);

  useEffect(() => clearReturnFocus, [clearReturnFocus]);

  return { captureReturnFocus, restoreReturnFocus, clearReturnFocus };
}

/** How long the window must stay still before a resize counts as finished. */
export const WINDOW_RESIZE_SETTLE_MS = 160;

/**
 * Mark the document while the window is being resized, like the divider drags
 * do with `is-resizing`, so per-frame costs such as backdrop blur can pause.
 */
export function watchWindowResize(target: Window = window): () => void {
  const root = target.document.documentElement;
  let timer: number | null = null;
  const settle = () => {
    timer = null;
    root.classList.remove("is-window-resizing");
  };
  const onResize = () => {
    root.classList.add("is-window-resizing");
    if (timer !== null) target.clearTimeout(timer);
    timer = target.setTimeout(settle, WINDOW_RESIZE_SETTLE_MS);
  };
  target.addEventListener("resize", onResize);
  return () => {
    target.removeEventListener("resize", onResize);
    if (timer !== null) target.clearTimeout(timer);
    settle();
  };
}

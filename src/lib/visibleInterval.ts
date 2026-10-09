/** Refresh immediately when visible, then tick only while the document is shown.
 * Callbacks should read wall time so hiding a window never pauses real work. */
export function visibleInterval(callback: () => void, milliseconds: number) {
  let timer: ReturnType<typeof setInterval> | undefined;
  const sync = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    if (document.hidden) return;
    callback();
    timer = setInterval(callback, milliseconds);
  };
  document.addEventListener("visibilitychange", sync);
  sync();
  return () => {
    document.removeEventListener("visibilitychange", sync);
    if (timer !== undefined) clearInterval(timer);
  };
}

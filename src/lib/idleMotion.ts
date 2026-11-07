/**
 * Motion that only keeps Aven company (a resting agent's slow bob, a
 * watching one's glances) settles when you leave Aven alone: after
 * `IDLE_MS` with no pointer, key or scroll, the root gets `data-still`,
 * and the next input takes it away. Working and Needs you keep moving:
 * they say something. A window left open on screen then draws nothing.
 */

/** How long Aven waits, untouched, before its ambient motion settles. */
export const IDLE_MS = 60_000;

const INPUTS = ["pointermove", "pointerdown", "keydown"] as const;

export function installIdleStill(
  root: HTMLElement = document.documentElement,
  target: Window = window,
  idleMs = IDLE_MS,
  now: () => number = () => performance.now(),
): () => void {
  let last = now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = () => {
    const left = idleMs - (now() - last);
    if (left > 0) {
      timer = setTimeout(check, left);
      return;
    }
    timer = undefined;
    root.setAttribute("data-still", "");
  };
  // Input only notes the time: no timer churn while you work.
  const woke = () => {
    last = now();
    if (timer !== undefined) return;
    root.removeAttribute("data-still");
    timer = setTimeout(check, idleMs);
  };
  const options = { capture: true, passive: true } as const;
  for (const name of INPUTS) target.addEventListener(name, woke, options);
  // Scrolling (a trackpad moves no pointer) wakes it too.
  target.document.addEventListener("scroll", woke, options);
  timer = setTimeout(check, idleMs);
  return () => {
    for (const name of INPUTS) target.removeEventListener(name, woke, options);
    target.document.removeEventListener("scroll", woke, options);
    if (timer !== undefined) clearTimeout(timer);
    root.removeAttribute("data-still");
  };
}

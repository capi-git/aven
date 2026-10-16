/**
 * What the real-app check (`useDevSmoke`) asks of things that move: an
 * animation that runs unless reduced motion stops it, and a one-shot marker
 * that appears, clears and never comes back on its own.
 */

/** Whether the system asks for reduced motion, which stops these animations. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Why an element's CSS animation is not the expected one, or null when it is:
 * `expected` while motion is allowed, none at all with reduced motion.
 */
export function animationProblem(
  animationName: string,
  expected: string,
  reducedMotion: boolean,
): string | null {
  const name = animationName.trim() || "none";
  if (reducedMotion)
    return name === "none" ? null : `animates (${name}) with reduced motion on`;
  return name === expected
    ? null
    : `its animation is ${name}, expected ${expected}`;
}

/**
 * Wait for a one-shot marker, such as a mascot's reaction: it must appear
 * within `appearMs`, clear within `clearMs` of appearing, and stay away for
 * `quietMs` after that. Resolves with the value it showed.
 */
export function watchOneShot(
  read: () => string | null | undefined,
  {
    what,
    appearMs,
    clearMs,
    quietMs,
    pollMs = 40,
  }: {
    what: string;
    appearMs: number;
    clearMs: number;
    quietMs: number;
    pollMs?: number;
  },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let shown: string | null = null;
    let appearedAt = 0;
    let clearedAt = 0;
    const check = () => {
      let value: string | null | undefined;
      try {
        value = read();
      } catch (error) {
        reject(error);
        return;
      }
      const now = Date.now();
      if (!shown) {
        if (value) {
          shown = value;
          appearedAt = now;
        } else if (now - started > appearMs) {
          reject(new Error(`${what} never appeared`));
          return;
        }
      } else if (!clearedAt) {
        if (!value) clearedAt = now;
        else if (now - appearedAt > clearMs) {
          reject(new Error(`${what} (${shown}) never cleared`));
          return;
        }
      } else if (value) {
        reject(new Error(`${what} came back (${value}) after it cleared`));
        return;
      } else if (now - clearedAt >= quietMs) {
        resolve(shown);
        return;
      }
      setTimeout(check, pollMs);
    };
    check();
  });
}

import { invoke } from "@tauri-apps/api/core";
import { windowRevealTiming, type RevealTiming } from "./windowReveal";

/**
 * How the workspace window became visible at launch, for Aven Dev's
 * real-app check and speed test (`dev_smoke_window_reveal`, epoch ms).
 */
export type NativeReveal = {
  concealedAtMs: number;
  revealedAtMs?: number | null;
  reason?: "painted" | "timeout" | null;
  concealedUntilReveal?: boolean | null;
};

export type LaunchReveal = {
  native: NativeReveal | null;
  page: RevealTiming;
  /** WebKit's first contentful paint, or null where it is not reported. */
  firstContentfulPaintEpochMs: number | null;
};

/** WebKit's first contentful paint for this document, as epoch ms. */
export function firstContentfulPaintEpochMs(): number | null {
  const entry = performance.getEntriesByName("first-contentful-paint")[0];
  return entry ? Math.round(performance.timeOrigin + entry.startTime) : null;
}

/** Wait until the native side has shown this window, then report how. */
export async function readLaunchReveal(
  timeoutMs = 6_000,
): Promise<LaunchReveal> {
  const started = Date.now();
  let native: NativeReveal | null = null;
  for (;;) {
    native = await invoke<NativeReveal | null>("dev_smoke_window_reveal");
    if (!native || native.revealedAtMs != null) break;
    if (Date.now() - started > timeoutMs) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return {
    native,
    page: windowRevealTiming(),
    firstContentfulPaintEpochMs: firstContentfulPaintEpochMs(),
  };
}

/**
 * Why the launch could have shown anything but the drawn workspace, or null.
 * The window must stay concealed until the page reports a drawn frame. On
 * macOS, where a concealed window is ordered in and keeps drawing, WebKit
 * must also have painted content before the window became visible.
 */
export function launchRevealProblem(
  { native, page, firstContentfulPaintEpochMs: painted }: LaunchReveal,
  paintsWhileConcealed: boolean,
): string | null {
  if (!native)
    return "the window was never concealed, so it showed before its interface drew";
  const shown = native.revealedAtMs;
  if (shown == null || !native.reason) return "the window was never shown";
  if (native.reason !== "painted")
    return `the window was shown by its ${native.reason}, not by a drawn frame`;
  if (native.concealedUntilReveal !== true)
    return "something showed the window before its interface drew";
  if (page.drawnAtEpochMs == null)
    return "the window was shown without the page reporting a drawn frame";
  if (!paintsWhileConcealed) return null;
  if (painted == null) return "WebKit reported no painted content";
  if (painted > shown)
    return `the first content was painted ${painted - shown} ms after the window was shown`;
  return null;
}

/** A one-line summary for the check's report. */
export function launchRevealSummary({
  native,
  firstContentfulPaintEpochMs: painted,
}: LaunchReveal): string {
  if (!native?.revealedAtMs) return "not shown";
  const shown = native.revealedAtMs;
  return [
    `shown ${shown - native.concealedAtMs} ms after the window was created`,
    painted == null ? null : `${shown - painted} ms after its first paint`,
  ]
    .filter(Boolean)
    .join(", ");
}

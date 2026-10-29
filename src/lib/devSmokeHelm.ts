/**
 * What the real-app check (`useDevSmoke`) asks of the message box's helm:
 * its dialog unfurls above the box and never over the words, a chat that
 * works offers one Stop (in the critter's bubble) and no Working row, and
 * the critter types at its laptop while the agent works.
 */
import { animationProblem } from "./devSmokeMotion";

type Box = Pick<DOMRect, "top" | "bottom" | "left" | "right">;

/**
 * Why the helm's dialog is not where it belongs, or null: it must sit
 * entirely above the message box (a pixel of slack), so it covers none of
 * the words being typed.
 */
export function helmDialogProblem(
  dialog: Box,
  box: Box,
  field: Box,
): string | null {
  if (dialog.bottom > box.top + 1)
    return `the dialog reaches ${Math.round(dialog.bottom - box.top)}px into the message box`;
  const overlaps =
    dialog.bottom > field.top &&
    dialog.top < field.bottom &&
    dialog.right > field.left &&
    dialog.left < field.right;
  return overlaps ? "the dialog covers the words being typed" : null;
}

/**
 * Why a working chat's pane does not offer exactly one Stop for its turn,
 * or null. The critter's bubble holds it; the Working row above the box is
 * gone, so a run status card or its Stop is a second one. A lead gives its
 * Stop to the team bar (`stopInBar`), so its box offers none.
 */
export function helmStopProblem(
  pane: ParentNode,
  stopInBar = false,
): string | null {
  if (pane.querySelector(".session-run-status"))
    return "the Working row is still above the message box";
  if (pane.querySelector(".session-run-stop"))
    return "the run status offers a Stop of its own";
  const stops = pane.querySelectorAll("[data-helm-stop]").length;
  const wanted = stopInBar ? 0 : 1;
  if (stops !== wanted)
    return `the message box offers ${stops} Stops, not ${wanted}`;
  if (
    !stopInBar &&
    !pane.querySelector('[data-helm-say="running"] [data-helm-stop]')
  )
    return "the Stop is not in the critter's bubble";
  return null;
}

/**
 * Why the helm is not showing a working agent, or null: the critter in its
 * running pose at its laptop, stepping its two frames unless reduced motion
 * keeps it still, and the bubble saying what it does with a clock.
 */
export function helmWorkingProblem(
  helm: Element | null,
  frameAnimation: string,
  reducedMotion: boolean,
): string | null {
  if (!helm) return "the message box has no helm";
  if ((helm as HTMLElement).dataset.pose !== "running")
    return `the critter is ${(helm as HTMLElement).dataset.pose ?? "unposed"}, not running`;
  if (!helm.querySelector(".helm-critter-laptop"))
    return "the critter has no laptop";
  const bubble = helm.querySelector('[data-helm-say="running"]');
  if (!bubble) return "the critter's bubble says nothing";
  if (!bubble.querySelector('[role="timer"]'))
    return "the bubble shows no elapsed time";
  const stepping = animationProblem(
    frameAnimation,
    "helm-frame-a",
    reducedMotion,
  );
  return stepping ? `the laptop frames: ${stepping}` : null;
}

/**
 * Run a check that zooms the interface and types into the message box, and
 * leave the app as later steps expect it whatever happens: at its own zoom,
 * with the critter's dialog closed and the box empty. The first failure
 * (the check's, before any of the cleanup's) is the one thrown.
 */
export async function restoringComposer<T>(
  cleanup: {
    restoreZoom: () => Promise<unknown>;
    closeDialog: () => void;
    clearField: () => void;
  },
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } finally {
    await cleanup.restoreZoom().catch(() => undefined);
    try {
      cleanup.closeDialog();
    } finally {
      cleanup.clearField();
    }
  }
}

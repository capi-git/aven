/**
 * What the real-app check (`useDevSmoke`) asks of the message box's helm:
 * its menu opens above the box and never over the words, a chat that works
 * offers one Stop (in the mark's bubble) and no Working row, and a light
 * sweeps across the mark while the agent works.
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
    return "the Stop is not in the mark's bubble";
  return null;
}

/** The first diagonal of a working mark's sweep, whose animation is read. */
export const HELM_SWEEP_SELECTOR =
  '.helm-critter[data-state="working"] .dot-mark-lit-d';

/**
 * Why the helm is not showing a working agent, or null: the mark in its
 * running pose with a light sweeping across it (unless reduced motion keeps
 * it still), and the bubble saying what it does with a clock.
 */
export function helmWorkingProblem(
  helm: Element | null,
  sweepAnimation: string,
  reducedMotion: boolean,
): string | null {
  if (!helm) return "the message box has no helm";
  if ((helm as HTMLElement).dataset.pose !== "running")
    return `the mark is ${(helm as HTMLElement).dataset.pose ?? "unposed"}, not running`;
  if (!helm.querySelector(HELM_SWEEP_SELECTOR))
    return "the mark is not sweeping";
  const bubble = helm.querySelector('[data-helm-say="running"]');
  if (!bubble) return "the mark's bubble says nothing";
  if (!bubble.querySelector('[role="timer"]'))
    return "the bubble shows no elapsed time";
  const sweeping = animationProblem(
    sweepAnimation,
    "dot-mark-sweep",
    reducedMotion,
  );
  return sweeping ? `the sweep: ${sweeping}` : null;
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

/** An element as a failure message names it: its tag and its helm marks. */
function describeElement(element: Element | null): string {
  if (!element) return "nothing";
  const marks = [
    "data-helm-row",
    "data-helm-item-index",
    "data-helm-critter",
    "data-helm-dialog",
    "aria-label",
  ]
    .filter((name) => element.hasAttribute(name))
    .map((name) => {
      const value = element.getAttribute(name);
      return value ? `${name}="${value.slice(0, 40)}"` : name;
    });
  const tag = element.tagName.toLowerCase();
  return marks.length ? `${tag}[${marks.join(" ")}]` : tag;
}

/**
 * The helm's state in one line, for a failed step: how its dialog was
 * opened, the page and ▶ row it shows, whether it is placed and shown,
 * where the keyboard is, and whether the pointer is over the critter or
 * the dialog.
 */
export function helmStateWords(root: ParentNode, doc: Document): string {
  // The message box carries data-helm too; the helm is the one the critter
  // stands in.
  const perch = root.querySelector(".helm-perch");
  const helm = perch?.closest<HTMLElement>("[data-helm]") ?? null;
  const dialog = doc.querySelector<HTMLElement>("[data-helm-dialog]");
  const cursor = dialog?.querySelector<HTMLElement>(
    "[data-helm-row][data-active], [data-helm-item-index][data-active]",
  );
  const shown = (() => {
    if (!dialog) return "none";
    const view = doc.defaultView;
    for (let at: Element | null = dialog; at; at = at.parentElement)
      if (view?.getComputedStyle(at).visibility === "hidden") return "hidden";
    const rect = dialog.getBoundingClientRect();
    return `${dialog.dataset.popoverSide ?? "?"} at ${Math.round(rect.top)}–${Math.round(rect.bottom)}`;
  })();
  const hovered = (element: Element | null | undefined) => {
    try {
      return !!element?.matches(":hover");
    } catch {
      return false;
    }
  };
  return [
    `open: ${helm?.dataset.open ?? "no"}`,
    `dialog: ${shown}`,
    `page: ${dialog?.dataset.page ?? "-"}`,
    `▶ on: ${cursor?.dataset.helmRow ?? cursor?.dataset.helmItemIndex ?? "-"}`,
    `focus: ${describeElement(doc.activeElement)}`,
    `pointer over: ${hovered(perch) ? "critter" : hovered(dialog) ? "dialog" : "neither"}`,
  ].join("; ");
}

/**
 * Close the critter's dialog as a person does, with Escape, if it is open,
 * so a step starts from a closed helm whatever came before.
 */
export function closeHelmDialog(doc: Document): boolean {
  const dialog = doc.querySelector<HTMLElement>("[data-helm-dialog]");
  if (!dialog) return false;
  dialog.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
  return true;
}

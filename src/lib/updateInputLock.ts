import { pauseBrowsersForUpdate } from "./browserUpdateState";
import { mountOrb } from "@yogesharc/thinking-orbs/vanilla";

/** The orb, where the page can draw one (a test page may not). */
function drawOrb(svg: SVGSVGElement) {
  if (
    typeof IntersectionObserver === "undefined" ||
    typeof matchMedia === "undefined"
  )
    return null;
  return mountOrb(svg, { state: "working", size: 20 });
}

const DEFAULT_DETAIL =
  "Aven is saving your workspace and browser tabs. Your tabs will reopen after the update.";
let showDetail: ((text: string) => void) | null = null;

/** Say what the restart is doing, such as finishing a provider update. */
export function setUpdateLockStatus(text: string | null): void {
  showDetail?.(text || DEFAULT_DETAIL);
}

/**
 * Block new edits synchronously before an update snapshots the workspace.
 * `onPreviewDismiss` turns it into a development preview: a click or key
 * press, otherwise blocked, closes it instead.
 */
export function lockUpdateInput(
  options: { onPreviewDismiss?: () => void } = {},
): () => void {
  const resumeBrowsers = pauseBrowsersForUpdate();
  if (typeof document === "undefined") return resumeBrowsers;
  const root = document.getElementById("root");
  const wasInert = root?.hasAttribute("inert") ?? false;
  const previousFocus = document.activeElement;
  const overlay = document.createElement("div");
  overlay.className =
    "fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/60 p-6";
  overlay.dataset.updateInputLock = "true";
  const dialog = document.createElement("div");
  dialog.className =
    "flex max-w-sm flex-col items-center gap-3 rounded-2xl bg-background-base p-7 text-center text-content shadow-xl";
  dialog.tabIndex = -1;
  dialog.setAttribute("role", "alertdialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Saving and restarting…");
  dialog.setAttribute("aria-describedby", "aven-update-restart-detail");
  // A Thinking Orb (thinkingorbs.com), as everywhere else Aven works.
  const spinner = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  spinner.setAttribute("class", "size-6 text-content/80");
  spinner.setAttribute("viewBox", "0 0 20 20");
  spinner.setAttribute("fill", "currentColor");
  spinner.setAttribute("aria-hidden", "true");
  const title = document.createElement("p");
  title.className = "text-sm font-medium";
  title.textContent = "Saving and restarting…";
  const detail = document.createElement("p");
  detail.id = "aven-update-restart-detail";
  detail.className = "text-xs text-content/65";
  detail.textContent = DEFAULT_DETAIL;
  // Assistive technology hears what the restart is waiting for.
  detail.setAttribute("aria-live", "polite");
  dialog.append(spinner, title, detail);
  // Release builds drop the preview branch entirely.
  const dismiss = import.meta.env.DEV ? options.onPreviewDismiss : undefined;
  if (dismiss) {
    const hint = document.createElement("p");
    hint.className = "text-xs text-content/45";
    hint.textContent = "Preview · Click or press a key to close";
    dialog.append(hint);
  }
  overlay.append(dialog);

  // Inert also removes the underlying controls from accessibility navigation.
  // Capture guards cover portaled composers/menus outside the React root.
  const block = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (dismiss && (event.type === "pointerdown" || event.type === "keydown"))
      dismiss();
  };
  const events = [
    "keydown",
    "keyup",
    "beforeinput",
    "input",
    "paste",
    "cut",
    "drop",
    "pointerdown",
    "click",
    "dblclick",
    "contextmenu",
    "submit",
  ];
  for (const event of events) window.addEventListener(event, block, true);
  const keepFocus = (event: FocusEvent) => {
    if (event.target instanceof Node && !dialog.contains(event.target))
      dialog.focus();
  };
  window.addEventListener("focusin", keepFocus, true);
  root?.setAttribute("inert", "");
  document.body.append(overlay);
  const orb = drawOrb(spinner);
  dialog.focus();
  const show = (text: string) => {
    detail.textContent = text;
  };
  showDetail = show;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (showDetail === show) showDetail = null;
    resumeBrowsers();
    for (const event of events) window.removeEventListener(event, block, true);
    window.removeEventListener("focusin", keepFocus, true);
    orb?.destroy();
    overlay.remove();
    if (!wasInert) root?.removeAttribute("inert");
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
      previousFocus.focus();
  };
}

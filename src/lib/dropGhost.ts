import { effectiveCssZoom } from "./drag";
import { motionReduced, playBounded } from "./motion";
import { DOCK_EASE, DOCK_TWEEN_MS } from "./paneDock";

/**
 * A dragged tab's look where it was let go, faded out there while the pane
 * it made grows from the drop preview (Cydonia's ghost). Measured before
 * the drag's own motion puts the tab back, and only shown for a drop the
 * workspace took.
 */
export function captureDropGhost(
  item: HTMLElement | null | undefined,
): { fade(): void } | null {
  if (!item || typeof document === "undefined" || motionReduced()) return null;
  const visual =
    item.querySelector<HTMLElement>(":scope > [data-sortable-motion]") ?? item;
  const rect = visual.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const host =
    item.closest<HTMLElement>(".personal-shell") ??
    item.ownerDocument.body ??
    null;
  if (!host) return null;
  // The tab's own box carries the classes its look depends on.
  const shell = item.cloneNode(false) as HTMLElement;
  const look = (visual === item ? item : visual).cloneNode(true) as HTMLElement;
  return {
    fade() {
      const zoom = effectiveCssZoom(host) || 1;
      shell.removeAttribute("id");
      shell.setAttribute("aria-hidden", "true");
      shell.inert = true;
      shell.dataset.dropGhost = "";
      Object.assign(shell.style, {
        position: "fixed",
        left: `${rect.left / zoom}px`,
        top: `${rect.top / zoom}px`,
        width: `${rect.width / zoom}px`,
        height: `${rect.height / zoom}px`,
        margin: "0",
        zIndex: "1000",
        pointerEvents: "none",
      });
      if (look !== shell) {
        look.style.transform = "none";
        look.style.translate = "none";
        look.style.transition = "none";
        shell.replaceChildren(look);
      }
      host.append(shell);
      if (typeof shell.animate !== "function") {
        shell.remove();
        return;
      }
      // Removed when the fade ends, or at its duration if WebKit holds the
      // animation back: the ghost is never left behind.
      playBounded(
        shell,
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: DOCK_TWEEN_MS, easing: DOCK_EASE, fill: "forwards" },
        () => shell.remove(),
      );
    },
  };
}

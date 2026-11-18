import type { PointerEvent as ReactPointerEvent } from "react";
import { clientRectScale } from "./drag";

/** How far along a divider the pointer is, from 0 at its start to 1 at its end. */
export function gripShare(
  pointer: number,
  start: number,
  length: number,
): number {
  if (!(length > 0) || !Number.isFinite(pointer)) return 0.5;
  return Math.min(1, Math.max(0, (pointer - start) / length));
}

/**
 * Moves a divider's grip to where the pointer is along it, as in Super
 * Engineering. The share goes in `--aven-grip-at`; the CSS keeps the grip
 * clear of the ends. Only the divider itself restyles.
 */
export function followGrip(
  event: ReactPointerEvent<HTMLElement>,
  vertical: boolean,
  target: HTMLElement = event.currentTarget,
): void {
  const box = target.getBoundingClientRect();
  const scale = clientRectScale(target);
  const share = vertical
    ? gripShare(event.clientY, box.top * scale, box.height * scale)
    : gripShare(event.clientX, box.left * scale, box.width * scale);
  target.style.setProperty("--aven-grip-at", `${(share * 100).toFixed(2)}%`);
}

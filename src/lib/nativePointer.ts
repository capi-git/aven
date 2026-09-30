import {
  cursorPosition,
  getCurrentWindow,
  primaryMonitor,
} from "@tauri-apps/api/window";
import { IS_MAC } from "./platform";

type Point = { x: number; y: number };

/**
 * Map a desktop pointer position to this page's CSS pixels. On macOS the
 * windowing library scales the pointer by the primary display, while window
 * positions use the window's own display, so both are first converted back to
 * points; with displays of different densities they would otherwise disagree.
 */
export function pointerToPage(
  cursor: Point,
  origin: Point,
  size: { width: number; height: number },
  page: { width: number; height: number },
  scales: { window: number; primary: number },
): Point | null {
  if (!size.width || !size.height) return null;
  const pointer = IS_MAC ? scales.primary : 1;
  const frame = IS_MAC ? scales.window : 1;
  if (!(pointer > 0) || !(frame > 0)) return null;
  const width = size.width / frame;
  const height = size.height / frame;
  return {
    x: ((cursor.x / pointer - origin.x / frame) * page.width) / width,
    y: ((cursor.y / pointer - origin.y / frame) * page.height) / height,
  };
}

function within(rect: DOMRect, point: Point) {
  return (
    point.x >= rect.left &&
    point.x < rect.right &&
    point.y >= rect.top &&
    point.y < rect.bottom
  );
}

/**
 * Whether a page point lies on the visible part of a native browser page:
 * inside a browser host and not under an HTML panel the page is clipped for.
 */
export function overNativePage(point: Point): boolean {
  const onPage = [
    ...document.querySelectorAll<HTMLElement>(".browser-native-host"),
  ].some((host) =>
    [...host.getClientRects()].some((rect) => within(rect, point)),
  );
  if (!onPage) return false;
  return ![
    ...document.querySelectorAll<HTMLElement>(
      '[data-native-browser-occluded="true"][data-native-browser-edge]',
    ),
  ].some((panel) =>
    [...panel.getClientRects()].some((rect) => within(rect, point)),
  );
}

/**
 * The pointer position in this page's CSS pixels when it is over a native
 * browser page, otherwise null. WebKit receives no pointer events there, so
 * hover state that depends on them would otherwise stay stuck.
 */
export async function nativeBrowserPointer(): Promise<Point | null> {
  const shown = [
    ...document.querySelectorAll<HTMLElement>(".browser-native-host"),
  ].some((host) => host.getClientRects().length > 0);
  if (!shown) return null;
  try {
    const current = getCurrentWindow();
    const [cursor, origin, size, scale, primary] = await Promise.all([
      cursorPosition(),
      current.innerPosition(),
      current.innerSize(),
      current.scaleFactor(),
      IS_MAC ? primaryMonitor() : Promise.resolve(null),
    ]);
    const point = pointerToPage(
      cursor,
      origin,
      size,
      { width: window.innerWidth, height: window.innerHeight },
      { window: scale, primary: primary?.scaleFactor ?? scale },
    );
    return point && overNativePage(point) ? point : null;
  } catch {
    return null;
  }
}

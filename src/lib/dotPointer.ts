import { invoke, isTauri } from "@tauri-apps/api/core";
import { SETTINGS } from "./settingDefinitions";

/**
 * Aven's dot pointer. `html[data-aven-pointer="dot"]` switches every window
 * to the dot drawn by `src/pointer.css`; this module decides when it is set.
 *
 * The setting turns it on (Settings › Appearance, on by default), but the
 * system's own pointer wins whenever the Mac asks for one: an enlarged
 * pointer in Accessibility › Display, Increase contrast, or forced colours.
 * Those are read once per window and again when Aven comes back to the
 * front (System Settings takes focus to change them). All event-driven;
 * nothing runs while the pointer moves.
 */
export const POINTER_ROOT_ATTRIBUTE = "data-aven-pointer";

/** Why the system pointer is showing although the setting is on. */
export type DotPointerBlock = "size" | "contrast" | null;

export type SystemPointer = {
  /** The Mac's pointer size, 1 at its smallest. */
  scale: number;
  moreContrast: boolean;
  forcedColors: boolean;
};

/** Pure: what the system asks for, as a reason to keep its pointer. */
export function dotPointerBlock(system: SystemPointer): DotPointerBlock {
  if (system.scale > 1.01) return "size";
  if (system.moreContrast || system.forcedColors) return "contrast";
  return null;
}

let system: SystemPointer = {
  scale: 1,
  moreContrast: false,
  forcedColors: false,
};
let block: DotPointerBlock = null;
const listeners = new Set<() => void>();

/** For the setting's row, which says why the dot is off. */
export function currentDotPointerBlock(): DotPointerBlock {
  return block;
}

export function subscribeDotPointerBlock(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** Marks the root from the setting and what the system asks for. */
export function applyDotPointer(): void {
  const next = dotPointerBlock(system);
  if (next !== block) {
    block = next;
    for (const listener of listeners) listener();
  }
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const on = SETTINGS.dotPointer.load() && next === null;
  if (on) {
    if (root.getAttribute(POINTER_ROOT_ATTRIBUTE) !== "dot")
      root.setAttribute(POINTER_ROOT_ATTRIBUTE, "dot");
  } else if (root.hasAttribute(POINTER_ROOT_ATTRIBUTE)) {
    root.removeAttribute(POINTER_ROOT_ATTRIBUTE);
  }
}

function mediaQuery(query: string): MediaQueryList | null {
  try {
    return typeof window !== "undefined" &&
      typeof window.matchMedia === "function"
      ? window.matchMedia(query)
      : null;
  } catch {
    return null;
  }
}

/** The Mac's pointer size from Accessibility › Display; 1 where unknown. */
async function readPointerScale(): Promise<number> {
  if (!isTauri()) return 1;
  try {
    const scale = await invoke<number>("system_pointer_scale");
    return Number.isFinite(scale) && scale >= 1 ? scale : 1;
  } catch {
    return 1;
  }
}

/**
 * Applies the dot and follows the setting (in this window and others) and
 * the system's pointer needs. Returns a function that stops.
 */
export function initDotPointer(): () => void {
  if (typeof window === "undefined") return () => {};
  const contrast = mediaQuery("(prefers-contrast: more)");
  const forced = mediaQuery("(forced-colors: active)");
  let stopped = false;
  const readMedia = () => {
    system = {
      ...system,
      moreContrast: contrast?.matches === true,
      forcedColors: forced?.matches === true,
    };
    applyDotPointer();
  };
  const readScale = () => {
    void readPointerScale().then((scale) => {
      if (stopped || scale === system.scale) return;
      system = { ...system, scale };
      applyDotPointer();
    });
  };
  readMedia();
  readScale();
  contrast?.addEventListener?.("change", readMedia);
  forced?.addEventListener?.("change", readMedia);
  window.addEventListener("focus", readScale);
  const unsubscribe = SETTINGS.dotPointer.subscribe(applyDotPointer);
  return () => {
    stopped = true;
    contrast?.removeEventListener?.("change", readMedia);
    forced?.removeEventListener?.("change", readMedia);
    window.removeEventListener("focus", readScale);
    unsubscribe();
  };
}

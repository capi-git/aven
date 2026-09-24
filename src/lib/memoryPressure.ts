import { listen } from "@tauri-apps/api/event";

/** Published by the host when macOS reports memory pressure. */
export const MEMORY_PRESSURE_EVENT = "aven:memory-pressure";
export type MemoryPressureLevel = "warn" | "critical";
export type MemoryPressureListener = (level: MemoryPressureLevel) => void;

const listeners = new Set<MemoryPressureListener>();
let unlistenHost: (() => void) | undefined;
let installing = false;

/** Deliver a notice to every subscriber; also used by tests. */
export function notifyMemoryPressure(level: MemoryPressureLevel) {
  for (const listener of [...listeners]) listener(level);
}

function installHostListener() {
  if (installing || unlistenHost) return;
  installing = true;
  void listen<{ level: MemoryPressureLevel }>(MEMORY_PRESSURE_EVENT, (event) =>
    notifyMemoryPressure(event.payload.level),
  )
    .then((unlisten) => {
      if (listeners.size) unlistenHost = unlisten;
      else unlisten();
    })
    .catch(() => {
      // Browser previews have no host events.
    })
    .finally(() => {
      installing = false;
    });
}

/**
 * One host subscription fans out to every interested part of the interface.
 * The subscription is released when the last listener leaves.
 */
export function subscribeMemoryPressure(listener: MemoryPressureListener) {
  listeners.add(listener);
  installHostListener();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      unlistenHost?.();
      unlistenHost = undefined;
    }
  };
}

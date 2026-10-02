import { listen, type EventCallback } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Listens for a native menu command addressed to this window.
 *
 * A plain `listen` hears events emitted to any window, so a command the host
 * routes to the focused window (toggling the sidebar or file panel, zoom)
 * would otherwise run in every open window. Broadcast emits still arrive.
 */
export function listenInThisWindow<T>(
  event: string,
  handler: EventCallback<T>,
): Promise<() => void> {
  return listen<T>(event, handler, { target: getCurrentWindow().label });
}

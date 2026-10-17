import { invoke } from "@tauri-apps/api/core";
import { sessionNeedsUser, type Session } from "./session";

let lastCount = -1;

/** Push the count of chats waiting on the user to the macOS Dock badge. */
export function syncDockBadge(sessions: Session[]): void {
  let count = 0;
  for (const session of sessions) {
    if (sessionNeedsUser(session)) count++;
  }
  if (count === lastCount) return;
  lastCount = count;
  void invoke("set_dock_badge", { count }).catch(() => {});
}

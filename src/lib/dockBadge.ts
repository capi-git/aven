import { invoke } from "@tauri-apps/api/core";
import type { Session } from "./session";
import {
  attentionSessionIds,
  NO_LEAD_DECIDED,
  type LeadDecided,
} from "./teamAttention";

let lastCount = -1;
/** Chats a team needs you in beyond their own requests (see `teamAttention`). */
let teamNeeds: ReadonlySet<string> = new Set();

/**
 * The chats teams currently need you in. The badge counts them with the
 * chats asking you themselves, each chat once.
 */
export function setDockTeamNeeds(ids: ReadonlySet<string>) {
  teamNeeds = ids;
}

/** Things each project's Avos waits on you for (see `avosNeeds`). */
let avosNeeds = 0;

/** How many things the projects' Avos wait on you for, each counted once. */
export function setDockAvosNeeds(count: number) {
  avosNeeds = count;
}

/** Workers whose requests their lead decides, so they are not counted. */
let leadDecided: LeadDecided = NO_LEAD_DECIDED;

export function setDockLeadDecided(ids: LeadDecided) {
  leadDecided = ids;
}

/**
 * Push the count of what waits on the user to the macOS Dock badge: chats
 * asking, chats a team needs you in, and what each Avos needs you for.
 */
export function syncDockBadge(sessions: readonly Session[]): void {
  // Each request once: a worker asking you is counted, not also its lead.
  const ids = attentionSessionIds(sessions, [], leadDecided, {
    withLeads: false,
  });
  for (const id of teamNeeds) ids.add(id);
  const count = ids.size + avosNeeds;
  if (count === lastCount) return;
  lastCount = count;
  void invoke("set_dock_badge", { count }).catch(() => {});
}

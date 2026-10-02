/**
 * Which full-screen utility Settings replaced, so closing Settings can return
 * to it rather than dropping the user back in the workspace (MonoCode
 * 8fae5666). Opening Settings closes Search, Inbox and Notes; at most one of
 * them is open at a time.
 */
export type SettingsReturnView = "search" | "inbox" | "notes" | null;

export function captureSettingsReturnView(open: {
  search: boolean;
  inbox: boolean;
  notes: boolean;
}): SettingsReturnView {
  if (open.search) return "search";
  if (open.inbox) return "inbox";
  if (open.notes) return "notes";
  return null;
}

/** The view to reopen on close; Notes only while it is still enabled. */
export function resolveSettingsReturnView(
  view: SettingsReturnView,
  notesEnabled: boolean,
): SettingsReturnView {
  return view === "notes" && !notesEnabled ? null : view;
}

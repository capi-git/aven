import {
  loadPersonalInspector,
  savePersonalInspector,
  type PersonalInspector,
} from "./personalWorkspace";

/**
 * The side panel's open state, and the moment it slides in.
 *
 * Whether the panel is open lives here rather than in the app's state: only
 * the panel and its toggles read it, so showing or hiding the panel
 * re-renders them and nothing else.
 *
 * While the panel slides in, the reads it starts (folders, Git, the pull
 * request) wait for the slide to end (`afterSidePanelOpens`), so their work
 * never lands on the slide's frames.
 */

let open: boolean | null = null;
const listeners = new Set<() => void>();

/** Whether the side panel is open (as saved, until it changes). */
export function sidePanelOpen(): boolean {
  return (open ??= loadPersonalInspector().open);
}

export function setSidePanelOpen(next: boolean) {
  if (sidePanelOpen() === next) return;
  open = next;
  savePersonalInspector({ ...loadPersonalInspector(), open: next });
  for (const listener of [...listeners]) listener();
}

export function subscribeSidePanelOpen(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export type SidePanelTab = PersonalInspector["tab"];

/**
 * The side panel's tab. Kept here for the same reason as its open state: a
 * tab click re-renders the panel alone, not the whole app.
 */
let tab: SidePanelTab | null = null;
const tabListeners = new Set<() => void>();

export function sidePanelTab(): SidePanelTab {
  return (tab ??= loadPersonalInspector().tab);
}

export function setSidePanelTab(next: SidePanelTab) {
  if (sidePanelTab() === next) return;
  tab = next;
  for (const listener of [...tabListeners]) listener();
  // Saved after the click's frame, so the write never delays the new tab.
  setTimeout(() => {
    if (tab !== next) return;
    savePersonalInspector({ ...loadPersonalInspector(), tab: next });
  }, 0);
}

export function subscribeSidePanelTab(listener: () => void): () => void {
  tabListeners.add(listener);
  return () => {
    tabListeners.delete(listener);
  };
}

/** The panel's slide: `--personal-panel-duration` in personal-shell.css. */
export const SIDE_PANEL_SLIDE_MS = 200;
/** How long past its slide an opening waits for the slide's end event. */
const SLIDE_END_SLACK_MS = 60;
/** A read the panel made this recently is not made again when it opens. */
export const SIDE_PANEL_FRESH_MS = 30_000;

let opening: {
  waiting: Set<() => void>;
  timer: ReturnType<typeof setTimeout>;
} | null = null;

/**
 * The panel starts sliding in. It ends with `endSidePanelOpen` (the slide's
 * transition ending) or, should that never come, shortly after the slide's
 * length.
 */
export function beginSidePanelOpen() {
  const waiting = opening?.waiting ?? new Set<() => void>();
  if (opening) clearTimeout(opening.timer);
  opening = {
    waiting,
    timer: setTimeout(
      endSidePanelOpen,
      SIDE_PANEL_SLIDE_MS + SLIDE_END_SLACK_MS,
    ),
  };
}

/** The slide ended: what waited for it runs now. */
export function endSidePanelOpen() {
  if (!opening) return;
  const { waiting, timer } = opening;
  opening = null;
  clearTimeout(timer);
  for (const task of waiting) task();
}

/** True while the panel is sliding in. */
export function sidePanelOpening(): boolean {
  return opening !== null;
}

/**
 * Run `task` once the panel has finished sliding in, or at once when it is
 * not sliding. Returns a function that cancels a task still waiting.
 */
export function afterSidePanelOpens(task: () => void): () => void {
  if (!opening) {
    task();
    return () => undefined;
  }
  const { waiting } = opening;
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    task();
  };
  waiting.add(run);
  return () => {
    done = true;
    waiting.delete(run);
  };
}

/** Only for tests: forget the open state and any slide in progress. */
export function resetSidePanelForTest() {
  if (opening) clearTimeout(opening.timer);
  opening = null;
  open = null;
  listeners.clear();
  tab = null;
  tabListeners.clear();
}

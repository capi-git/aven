import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";

/** What the bubble shows. The workspace decides; the bubble only displays it. */
export type BrowserOrbSnapshot = {
  /** The chat a message goes to, or null when the workspace has none. */
  chat: { title: string; agent: string } | null;
  /** The chat is working on a turn. */
  busy: boolean;
  /** The latest answer to something asked from the bubble. */
  answer: { id: string; text: string } | null;
};

export type BrowserOrbState = {
  snapshot: BrowserOrbSnapshot;
  revision: number;
};

export type BrowserOrbAction =
  | { action: "submit"; text: string }
  | { action: "stop" }
  | { action: "openChat" };

/** The visible page rectangle in CSS pixels. */
export type BrowserOrbAnchor = {
  x: number;
  y: number;
  width: number;
  height: number;
  dpr: number;
};

export const BROWSER_ORB_STATE_EVENT = "browser-orb-state";
export const BROWSER_ORB_ACTION_EVENT = "browser-orb-action";
/** Answers longer than this are cut in the bubble; the chat has the rest. */
export const BROWSER_ORB_ANSWER_LIMIT = 1_200;

/** HTML that would sit under the native bubble window; hide the bubble then. */
const COVERING_UI =
  '[aria-modal="true"], [role="dialog"], [role="menu"], [role="listbox"], [data-popover-side]';

/**
 * The page area of the largest visible browser pane with a page loaded, or
 * null. A pane hidden by another view has no layout box.
 */
export function findBrowserOrbAnchor(
  root: ParentNode = document,
): BrowserOrbAnchor | null {
  let best: { rect: DOMRect; area: number } | null = null;
  for (const pane of root.querySelectorAll<HTMLElement>(
    ".browser-pane[data-browser-pane]:not([data-blank])",
  )) {
    const rect = pane.getBoundingClientRect();
    const toolbar = pane.querySelector(".browser-toolbar");
    const top = toolbar ? toolbar.getBoundingClientRect().bottom : rect.top;
    const page = new DOMRect(rect.left, top, rect.width, rect.bottom - top);
    const area = page.width * page.height;
    if (page.width < 240 || page.height < 160) continue;
    if (!best || area > best.area) best = { rect: page, area };
  }
  if (!best) return null;
  // Only UI that actually overlaps the page hides the bubble; lists and menus
  // elsewhere in the window, like the sidebar, leave it alone.
  const page = best.rect;
  for (const element of root.querySelectorAll<HTMLElement>(COVERING_UI)) {
    const box = element.getBoundingClientRect();
    if (
      box.width > 0 &&
      box.height > 0 &&
      box.left < page.right &&
      box.right > page.left &&
      box.top < page.bottom &&
      box.bottom > page.top
    )
      return null;
  }
  return {
    x: best.rect.left,
    y: best.rect.top,
    width: best.rect.width,
    height: best.rect.height,
    dpr: window.devicePixelRatio || 1,
  };
}

export function sameAnchor(
  a: BrowserOrbAnchor | null,
  b: BrowserOrbAnchor | null,
): boolean {
  if (!a || !b) return a === b;
  return (
    Math.round(a.x) === Math.round(b.x) &&
    Math.round(a.y) === Math.round(b.y) &&
    Math.round(a.width) === Math.round(b.width) &&
    Math.round(a.height) === Math.round(b.height) &&
    a.dpr === b.dpr
  );
}

export function trimAnswer(text: string): string {
  const clean = text.trim();
  if (clean.length <= BROWSER_ORB_ANSWER_LIMIT) return clean;
  const cut = clean.slice(0, BROWSER_ORB_ANSWER_LIMIT);
  const lastBreak = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(". "));
  return `${cut.slice(0, lastBreak > 600 ? lastBreak + 1 : cut.length).trimEnd()}…`;
}

/** Owner side: place and update the bubble, or hide it with a null anchor. */
export const nativeBrowserOrb = {
  set: (anchor: BrowserOrbAnchor | null, snapshot: BrowserOrbSnapshot) =>
    invoke<void>("browser_orb_set", { anchor, snapshot }),
  close: () => invoke<void>("browser_orb_close"),
  listen: <T>(event: string, callback: (payload: T) => void) =>
    getCurrentWebview().listen<T>(event, ({ payload }) => callback(payload)),
};

/** Bubble side: read state, size itself, and ask the owner to act. */
export const browserOrbWindow = {
  getState: () => invoke<BrowserOrbState>("browser_orb_get_state"),
  ready: () => invoke<void>("browser_orb_ready"),
  layout: (width: number, height: number, focus: boolean) =>
    invoke<void>("browser_orb_layout", { width, height, focus }),
  act: (action: BrowserOrbAction) =>
    invoke<void>("browser_orb_action", {
      action: action.action,
      text: action.action === "submit" ? action.text : null,
    }),
  listen: <T>(event: string, callback: (payload: T) => void) =>
    getCurrentWebview().listen<T>(event, ({ payload }) => callback(payload)),
};

/**
 * Workspace keybindings:
 *   New tab             cmd-t
 *   Close other tabs    cmd-opt-t
 *   Reopen closed tab   shift-cmd-t
 *   Close tab           cmd-w
 *   Split pane right    cmd-d
 *   Split pane down     shift-cmd-d
 *   Next tab            shift-cmd-}
 *   Previous tab        shift-cmd-{
 *   Back in tab history cmd-[
 *   Forward in history  cmd-]
 *   Activate tab 1–8    cmd-1 … cmd-8
 *   Last tab            cmd-9
 *   Cycle next tab      ctrl-tab        (the focused pane's tabs)
 *   Cycle previous tab  ctrl-shift-tab
 *   Next pane           ctrl-opt-tab    (layout order, as in Cydonia; Mac)
 *   Previous pane       ctrl-opt-shift-tab
 *   Next/previous pane  ctrl-opt-pagedown / ctrl-opt-pageup (everywhere;
 *                       Windows keeps ctrl-alt-tab)
 *   Expand/restore pane ctrl-opt-z
 *   Close tab           ctrl-opt-w      (as cmd-w)
 *   Focus pane          cmd-opt-arrows
 *   New terminal        cmd-`
 *   New terminal tab    shift-cmd-`
 *   Toggle terminal     cmd-j
 *   Zoom in             cmd-= (cmd-+ on shift layouts)
 *   Zoom out            cmd--
 *   Reset zoom          cmd-0
 *   Previous session    shift-cmd-up
 *   Next session        shift-cmd-down
 *   Archive session     shift-cmd-a
 *   Previous project    shift-cmd-left
 *   Next project        shift-cmd-right
 *   Stop focused turn   escape
 */

import type { FocusDir } from "./layout";
import { IS_MAC } from "./platform";

/**
 * The event a focused Chromium page sends its chord to its own window by
 * (`browser_chromium.rs`): never a menu command's name, which every window
 * hears.
 */
export const PAGE_SHORTCUT_EVENT = "page_shortcut";

export type TabCommand =
  | "new"
  | "reopen"
  | "close-others"
  | "close"
  | "next"
  | "prev"
  | "back"
  | "forward"
  | "split-right"
  | "split-down"
  | "new-terminal"
  | "new-terminal-tab"
  | "toggle-terminal"
  | "prev-session"
  | "next-session"
  | "archive-session"
  | "prev-project"
  | "next-project"
  | "next-pane"
  | "prev-pane"
  | "zoom-pane"
  | { activate: number }
  | { focus: FocusDir };

/** The letter a key types in the keyboard layout, ignoring modifiers. */
export function layoutLetter(
  e: Pick<KeyboardEvent, "key" | "keyCode">,
): string {
  // Browsers derive a letter key's code from the layout's own letter (65–90),
  // whatever Option does to the character it types.
  if (e.keyCode >= 65 && e.keyCode <= 90)
    return String.fromCharCode(e.keyCode).toLowerCase();
  return e.key.length === 1 ? e.key.toLowerCase() : "";
}

export function tabCommand(e: KeyboardEvent, mac = IS_MAC): TabCommand | null {
  if (e.isComposing) return null;

  const mod = e.metaKey || e.ctrlKey;

  // Control-Option chords. Letters match the keyboard layout's letter, as
  // a page's own key code does (so ⌃⌥Z is the key that types Z on AZERTY
  // and QWERTZ too), not its physical position; Option changes what a
  // letter types on a Mac (⌥Z is Ω). Off a Mac, AltGr reports Control and
  // Alt and types other characters (Polish ż): never one of these.
  if (
    e.ctrlKey &&
    e.altKey &&
    !e.metaKey &&
    (mac || !e.getModifierState?.("AltGraph"))
  ) {
    // Windows keeps Ctrl+Alt+Tab for itself; PageDown/PageUp work anywhere.
    if (e.key === "PageDown") return "next-pane";
    if (e.key === "PageUp") return "prev-pane";
    if (mac && (e.key === "Tab" || e.code === "Tab"))
      return e.shiftKey ? "prev-pane" : "next-pane";
    const letter = layoutLetter(e);
    const typed = !mac && e.key.length === 1 && e.key.toLowerCase() !== letter;
    if (!e.shiftKey && !typed && letter === "z") return "zoom-pane";
    if (!e.shiftKey && !typed && letter === "w") return "close";
  }

  if (mod && e.altKey && !e.shiftKey) {
    if (e.key.toLowerCase() === "t") return "close-others";
    if (e.key === "ArrowLeft") return { focus: "left" };
    if (e.key === "ArrowRight") return { focus: "right" };
    if (e.key === "ArrowUp") return { focus: "up" };
    if (e.key === "ArrowDown") return { focus: "down" };
    return null;
  }

  if (e.key === "Tab" && e.ctrlKey && !e.metaKey && !e.altKey) {
    return e.shiftKey ? "prev" : "next";
  }

  if (!mod || e.altKey) return null;

  if (e.key === "`" || e.code === "Backquote") {
    return e.shiftKey ? "new-terminal-tab" : "new-terminal";
  }

  const key = e.key.toLowerCase();

  if (e.shiftKey) {
    if (key === "t" && !e.repeat) return "reopen";
    if (key === "a" && !e.repeat) return "archive-session";
    if (e.key === "]" || e.key === "}") return "next";
    if (e.key === "[" || e.key === "{") return "prev";
    if (e.key === "ArrowUp") return "prev-session";
    if (e.key === "ArrowDown") return "next-session";
    if (e.key === "ArrowLeft") return "prev-project";
    if (e.key === "ArrowRight") return "next-project";
    if (key === "d") return "split-down";
    return null;
  }

  if (key === "t") return "new";
  if (key === "w") return "close";
  if (key === "d") return "split-right";
  if (key === "j") return "toggle-terminal";
  if (e.key === "[" || e.code === "BracketLeft") return "back";
  if (e.key === "]" || e.code === "BracketRight") return "forward";
  if (key >= "1" && key <= "8") return { activate: Number(key) - 1 };
  if (key === "9") return { activate: -1 };
  return null;
}

export function adjacentItemId(
  ids: readonly string[],
  current: string | null,
  delta: number,
): string | null {
  if (ids.length === 0) return null;
  const index = current ? ids.indexOf(current) : -1;
  if (index < 0) return delta < 0 ? ids[ids.length - 1] : ids[0];
  const next = (index + (delta < 0 ? -1 : 1) + ids.length) % ids.length;
  return ids[next] ?? null;
}

export function shouldHandleListNavigation(input: {
  blockedTarget: boolean;
  emptyComposerTarget: boolean;
  surfaceOpen: boolean;
}): boolean {
  return (
    !input.surfaceOpen && (!input.blockedTarget || input.emptyComposerTarget)
  );
}

type EscapeKeyEvent = Pick<
  KeyboardEvent,
  | "key"
  | "isComposing"
  | "defaultPrevented"
  | "repeat"
  | "metaKey"
  | "ctrlKey"
  | "altKey"
  | "shiftKey"
>;

type EscapeFocusTab = {
  id: string;
  focusedId: string;
  diffFocused?: boolean;
};

type EscapeFocusSession = {
  id: string;
  busy?: boolean;
};

function isPlainEscape(e: EscapeKeyEvent): boolean {
  return (
    e.key === "Escape" &&
    !e.isComposing &&
    !e.repeat &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.altKey &&
    !e.shiftKey
  );
}

export function shouldStopFocusedTurnOnEscape(
  e: EscapeKeyEvent,
  options: { inTerminal: boolean; focusedSessionBusy: boolean },
): boolean {
  return (
    isPlainEscape(e) &&
    !e.defaultPrevented &&
    !options.inTerminal &&
    options.focusedSessionBusy
  );
}

export function focusedBusyAgentSessionId(
  activeTabId: string,
  tabs: readonly EscapeFocusTab[],
  sessions: readonly EscapeFocusSession[],
  projectTerminalFocused: boolean,
): string | null {
  if (projectTerminalFocused) return null;
  const tab = tabs.find((entry) => entry.id === activeTabId);
  if (!tab || tab.diffFocused) return null;
  const session = sessions.find((entry) => entry.id === tab.focusedId);
  return session?.busy === true ? session.id : null;
}

export function deferUnhandledEscape(
  e: EscapeKeyEvent,
  run: () => void,
  defer: (callback: () => void) => void = queueMicrotask,
): void {
  if (!isPlainEscape(e) || e.defaultPrevented) return;
  defer(() => {
    if (!e.defaultPrevented) run();
  });
}

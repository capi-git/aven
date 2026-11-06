import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { IS_MAC } from "./platform";

/**
 * Speaking into the message box. The host listens through Apple's speech
 * recogniser with on-device recognition required, so no audio leaves the
 * Mac (`src-tauri/macos/dictation.m`).
 */

/** What the host says about one listen. Every listen ends with `end`. */
export type DictationEvent =
  | { kind: "listening" }
  | { kind: "words"; text: string; final: boolean }
  | { kind: "error"; code: string; message: string }
  | { kind: "end" };

/** Only the Mac app can listen. */
export function canDictate(): boolean {
  return IS_MAC && isTauri();
}

/** Starts a listen; the returned id stops it. */
export function startNativeDictation(
  onEvent: (event: DictationEvent) => void,
): Promise<number> {
  const channel = new Channel<DictationEvent>();
  channel.onmessage = onEvent;
  return invoke<number>("dictation_start", { onEvent: channel });
}

export function stopNativeDictation(generation: number): Promise<void> {
  return invoke("dictation_stop", { generation });
}

export function cancelNativeDictation(generation: number): Promise<void> {
  return invoke("dictation_cancel", { generation });
}

export type DictationSettingsPage = "microphone" | "speech" | "keyboard";

export function openDictationSettings(
  page: DictationSettingsPage,
): Promise<void> {
  return invoke("dictation_open_settings", { pane: page });
}

/** Starts and stops listening (Mac only, like listening itself). */
export const DICTATION_KEYS = "⇧⌘M";

export function isDictationHotkey(event: {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat?: boolean;
}): boolean {
  if (!event.metaKey || !event.shiftKey || event.ctrlKey || event.altKey)
    return false;
  if (event.repeat) return false;
  return event.code === "KeyM" || event.key.toLowerCase() === "m";
}

/** A refusal in plain words, and the System Settings page that fixes it. */
export type DictationProblem = {
  text: string;
  settings?: DictationSettingsPage;
};

export function dictationProblem(code: string, message = ""): DictationProblem {
  switch (code) {
    case "microphone-denied":
      return {
        text: "Aven isn't allowed to use the microphone.",
        settings: "microphone",
      };
    case "speech-denied":
      return {
        text: "Aven isn't allowed to use speech recognition.",
        settings: "speech",
      };
    case "on-device":
    case "language":
      return {
        text: "This Mac can't recognise your language offline. Turn on Dictation in Keyboard settings.",
        settings: "keyboard",
      };
    case "no-microphone":
      return { text: "No microphone found. Connect one and try again." };
    case "unavailable":
      return { text: "Speech recognition isn't ready. Try again in a moment." };
    default: {
      const detail = message.trim().replace(/\.$/, "");
      return {
        text: detail ? `Couldn't listen: ${detail}.` : "Couldn't listen.",
      };
    }
  }
}

/**
 * Where the words heard so far go: between what was before and after the
 * caret when listening started, with a space on either side where the words
 * would otherwise run into the text.
 */
export function spliceSpoken(
  before: string,
  heard: string,
  after: string,
): { text: string; caret: number } {
  const words = heard.trim();
  if (!words) return { text: before + after, caret: before.length };
  const lead = before && !/\s$/.test(before) ? " " : "";
  const trail = after && !/^[\s.,;:!?)]/.test(after) ? " " : "";
  const head = before + lead + words;
  return { text: head + trail + after, caret: head.length };
}

/** Words in a piece of text, for deciding when tidying is worth offering. */
export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

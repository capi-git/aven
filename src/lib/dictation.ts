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
  | {
      kind: "words";
      text: string;
      final: boolean;
      /** The recogniser closed this stretch of speech; the next starts anew. */
      pause?: boolean;
    }
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

/** With no new word for this long, the recogniser may have started over. */
export const DICTATION_PAUSE_MS = 1000;

/**
 * Everything said in one listen. The Mac's recogniser reports only the
 * stretch of speech it is working on: after a pause it starts its text again
 * from nothing, and a stop can end on no text at all. The stretches it left
 * behind are kept here, so a pause never takes words out of the message.
 */
export type Heard = {
  /** The stretches the recogniser has left behind. */
  kept: string;
  /** The stretch it is on now, as it last reported it. */
  live: string;
  /** It closed `live`, or reported nothing: what comes next is new. */
  closed: boolean;
  /** When the words of `live` last changed. */
  changedAt: number;
};

export const NOTHING_HEARD: Heard = {
  kept: "",
  live: "",
  closed: false,
  changedAt: 0,
};

const spokenWords = (text: string): string[] =>
  text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

function sharedStart(a: string[], b: string[]): number {
  let shared = 0;
  while (shared < a.length && shared < b.length && a[shared] === b[shared])
    shared += 1;
  return shared;
}

/** How many of `a`'s words are in `b` too, wherever they are. */
function sharedWords(a: string[], b: string[]): number {
  const left = [...b];
  let shared = 0;
  for (const word of a) {
    const found = left.indexOf(word);
    if (found < 0) continue;
    left.splice(found, 1);
    shared += 1;
  }
  return shared;
}

const joinSpoken = (before: string, after: string): string =>
  before && after ? `${before} ${after}` : before || after;

/**
 * Takes the recogniser's next report, at time `at` (ms). `paused` is its own
 * word that this stretch is closed. A report that goes on from the last one
 * (more words, or a few heard differently) replaces it; one that starts over
 * is added after what was already heard.
 */
export function hearWords(
  heard: Heard,
  text: string,
  at: number,
  paused = false,
): Heard {
  const next = text.trim();
  // Nothing takes no words away; whatever follows it starts afresh.
  if (!next) return heard.live ? { ...heard, closed: true } : heard;
  const words = spokenWords(next);
  const kept = spokenWords(heard.kept);
  const live = spokenWords(heard.live);
  const shared = sharedStart(live, words);
  // A recogniser that kept its earlier stretches after all: this report
  // already has them, so they aren't said twice.
  const again = sharedStart(kept, words) === kept.length;
  if (
    kept.length > 0 &&
    again &&
    (kept.length >= 3 ||
      sharedStart([...kept, ...live], words) === kept.length + live.length)
  )
    return { kept: "", live: next, closed: paused, changedAt: at };
  const quiet = at - heard.changedAt >= DICTATION_PAUSE_MS;
  const half = Math.ceil(live.length / 2);
  const startedOver =
    live.length > 0 &&
    (heard.closed
      ? // A closed stretch is settled: only more words go on from it.
        shared < live.length
      : quiet
        ? // After a quiet moment, going on means the same start and mostly
          // the same words, however a few of them were heard this time.
          shared < half && (shared === 0 || sharedWords(live, words) < half)
        : // Mid-speech, only a plainly different, much shorter text.
          shared === 0 &&
          words.length * 2 <= live.length &&
          live.length - words.length >= 2);
  const same = shared === live.length && shared === words.length;
  return {
    kept: startedOver ? joinSpoken(heard.kept, heard.live) : heard.kept,
    live: next,
    closed: paused,
    changedAt: same ? heard.changedAt : at,
  };
}

/** Everything heard in the listen, in the order it was said. */
export function heardText(heard: Heard): string {
  return joinSpoken(heard.kept, heard.live);
}

/** Words in a piece of text, for deciding when tidying is worth offering. */
export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { play, setEnabled, setVolume, type SoundName } from "cuelume";

const KEY = "monocode.sounds";

export const SOUNDS_DEFAULT = true;

/** Soft enough to sit in the background while a turn runs in another app. */
export const SOUNDS_VOLUME = 0.55;

export const SOUNDS_CHANGE_EVENT = "monocode:sounds-change";

/** Interface cues. Agent alerts have their own sounds: see `AlertEvent`. */
export type SoundCue = "inboxUnseen" | "updateAvailable" | "switch" | "copy";

const CUES: Record<SoundCue, SoundName> = {
  inboxUnseen: "bloom",
  updateAvailable: "arrival",
  switch: "toggle",
  copy: "scan",
};

export function loadSoundsEnabled(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw == null) return SOUNDS_DEFAULT;
    return raw === "1" || raw === "true";
  } catch {
    return SOUNDS_DEFAULT;
  }
}

export function saveSoundsEnabled(value: boolean) {
  try {
    localStorage.setItem(KEY, value ? "1" : "0");
  } catch {
    // private mode / quota
  }
  applySoundEngine();
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<boolean>(SOUNDS_CHANGE_EVENT, { detail: value }),
  );
}

function applySoundEngine() {
  setEnabled(loadSoundsEnabled());
  setVolume(SOUNDS_VOLUME);
}

/** Apply the stored mute/volume before the first cue. */
export function initSounds() {
  applySoundEngine();
}

export function playCue(cue: SoundCue) {
  if (!loadSoundsEnabled()) return;
  applySoundEngine();
  play(CUES[cue]);
}

let inboxDotOn = false;
let inboxPrimed = false;
let announcedUpdate: string | undefined;

/**
 * Rising edge of the project-rail inbox dot, after the first snapshot.
 * Launching with items already unseen must not chime.
 */
export function noteInboxUnseen(isUnseen: boolean) {
  if (isUnseen && !inboxDotOn && inboxPrimed) playCue("inboxUnseen");
  inboxDotOn = isUnseen;
  inboxPrimed = true;
}

/** One cue per available version, including a later probe of the same build. */
export function announceUpdateAvailable(version: string | null) {
  if (!version) {
    announcedUpdate = undefined;
    return;
  }
  if (announcedUpdate === version) return;
  announcedUpdate = version;
  playCue("updateAvailable");
}

/**
 * What can ask for your attention, each with its own sound. "Finished"
 * covers a turn that ends well; a stopped turn stays silent.
 */
export type AlertEvent = "needsYou" | "finished" | "failed";

export const ALERT_EVENTS: readonly AlertEvent[] = [
  "needsYou",
  "finished",
  "failed",
];

/** Soft cuelume sounds that are easy to tell apart. */
export const ALERT_SOUND_BUILT_INS = [
  { value: "chime", label: "Chime" },
  { value: "success", label: "Chord" },
  { value: "ready", label: "Rise" },
  { value: "droplet", label: "Drop" },
  { value: "error", label: "Knock" },
] as const satisfies readonly { value: SoundName; label: string }[];

export type AlertSoundBuiltIn = (typeof ALERT_SOUND_BUILT_INS)[number]["value"];
export type AlertSound = "none" | AlertSoundBuiltIn | "file";
/** A sound file copied into Aven's own data folder. */
export type AlertSoundFile = { name: string; path: string };
export type AlertSounds = Record<AlertEvent, AlertSound> & {
  files: Partial<Record<AlertEvent, AlertSoundFile>>;
};

export const ALERT_SOUNDS_KEY = "aven.alert-sounds.v1";
export const ALERT_SOUNDS_CHANGE_EVENT = "aven:alert-sounds-change";
/** The notification preferences' old single "Sound" switch. */
const LEGACY_PREFERENCES_KEY = "monocode.notification-preferences.v1";
export const ALERT_SOUND_EXTENSIONS = [
  "aiff",
  "aif",
  "wav",
  "mp3",
  "m4a",
  "caf",
];
/** A custom file plays for this long at most. */
export const ALERT_SOUND_MAX_MS = 5_000;

/**
 * Finished keeps the success cue it always had. Needs you used to sound
 * only through a banner; it now has its own soft chime. Failed stays quiet
 * until chosen.
 */
export const DEFAULT_ALERT_SOUNDS: Readonly<AlertSounds> = {
  needsYou: "chime",
  finished: "success",
  failed: "none",
  files: {},
};

const ALERT_SOUND_VALUES = new Set<string>([
  "none",
  "file",
  ...ALERT_SOUND_BUILT_INS.map((sound) => sound.value),
]);

function legacySoundOff(): boolean {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(LEGACY_PREFERENCES_KEY) ?? "null",
    );
    return parsed?.sound === false;
  } catch {
    return false;
  }
}

function parseFile(value: unknown): AlertSoundFile | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { name, path } = value as Record<string, unknown>;
  return typeof name === "string" && typeof path === "string" && path
    ? { name, path }
    : undefined;
}

export function loadAlertSounds(): AlertSounds {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(ALERT_SOUNDS_KEY);
  } catch {
    /* storage unavailable: defaults */
  }
  if (raw == null) {
    // Someone who switched the old "Sound" alert off keeps alerts silent.
    if (!legacySoundOff()) return { ...DEFAULT_ALERT_SOUNDS, files: {} };
    return { needsYou: "none", finished: "none", failed: "none", files: {} };
  }
  const result: AlertSounds = { ...DEFAULT_ALERT_SOUNDS, files: {} };
  try {
    const parsed = JSON.parse(raw);
    for (const event of ALERT_EVENTS) {
      const value = parsed?.[event];
      if (typeof value === "string" && ALERT_SOUND_VALUES.has(value))
        result[event] = value as AlertSound;
      const file = parseFile(parsed?.files?.[event]);
      if (file) result.files[event] = file;
    }
  } catch {
    /* unreadable: defaults */
  }
  return result;
}

export function saveAlertSounds(
  patch: Partial<Record<AlertEvent, AlertSound>> & {
    files?: Partial<Record<AlertEvent, AlertSoundFile>>;
  },
) {
  const current = loadAlertSounds();
  const next: AlertSounds = {
    ...current,
    ...patch,
    files: { ...current.files, ...patch.files },
  };
  try {
    localStorage.setItem(ALERT_SOUNDS_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
  if (typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent(ALERT_SOUNDS_CHANGE_EVENT, { detail: next }),
    );
}

/** The sound an event will make; a chosen file that is gone is silent. */
export function alertSoundFor(
  event: AlertEvent,
  sounds = loadAlertSounds(),
): AlertSound {
  const sound = sounds[event];
  return sound === "file" && !sounds.files[event] ? "none" : sound;
}

let fileAudio: HTMLAudioElement | null = null;
let fileStop: ReturnType<typeof setTimeout> | undefined;

function playFile(file: AlertSoundFile) {
  fileAudio?.pause();
  clearTimeout(fileStop);
  const audio = new Audio(convertFileSrc(file.path));
  audio.volume = SOUNDS_VOLUME;
  fileAudio = audio;
  fileStop = setTimeout(() => audio.pause(), ALERT_SOUND_MAX_MS);
  // A missing or unreadable file stays silent rather than failing a turn.
  void audio.play().catch(() => {});
}

/** Plays a sound now; used by alerts and by the preview button. */
export function playAlertSoundChoice(sound: AlertSound, file?: AlertSoundFile) {
  if (sound === "none") return;
  if (sound === "file") {
    if (file) playFile(file);
    return;
  }
  applySoundEngine();
  play(sound);
}

/** One alert, following the Sounds switch and the event's choice. */
export function playAlertSound(event: AlertEvent) {
  if (!loadSoundsEnabled()) return;
  const sounds = loadAlertSounds();
  playAlertSoundChoice(alertSoundFor(event, sounds), sounds.files[event]);
}

/**
 * Asks for a sound file and copies it into Aven's data folder, so moving
 * or deleting the original never breaks the alert. Null when cancelled.
 */
export async function chooseAlertSoundFile(
  event: AlertEvent,
): Promise<AlertSoundFile | null> {
  const sourcePath = await open({
    multiple: false,
    directory: false,
    title: "Choose a sound",
    filters: [{ name: "Sounds", extensions: ALERT_SOUND_EXTENSIONS }],
  });
  if (typeof sourcePath !== "string" || !sourcePath) return null;
  const path = await invoke<string>("save_alert_sound", { event, sourcePath });
  const name =
    sourcePath
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.[^.]+$/, "") || "Sound file";
  return { name, path };
}

/** Test helper: forget which inbox/update cues already fired. */
export function resetSoundCues() {
  inboxDotOn = false;
  inboxPrimed = false;
  announcedUpdate = undefined;
}

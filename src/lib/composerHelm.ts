/**
 * The message box's helm: the project's mark standing on the box's
 * top-right corner, which is also its controls. This module holds what the
 * helm decides without drawing anything: its pose, the room line, the rows
 * of its menu and how the keyboard moves through them, the words it says,
 * and the two small choices it remembers (the mark for chats outside a
 * project, and the one-time hint).
 */
import { isEditTool } from "./harness/preview";
import type { Block } from "./session";

/**
 * What the mark is doing:
 * - `rest`: still, nothing typed and nothing running.
 * - `typing`: breathing slowly while you write.
 * - `hover`: the same, while its menu is open.
 * - `running`: a light sweeping across it while the agent works.
 * - `done`: its dots reshaped into a tick as a turn finishes, then rest.
 * - `error`: a cross while something needs fixing.
 */
export type HelmPose =
  "rest" | "typing" | "hover" | "running" | "done" | "error";

/** What the speech bubble beside the mark says, if anything. */
export type HelmOutcome = "done" | "stopped" | "error" | null;

export function helmPose({
  busy,
  hasValue,
  open,
  outcome,
}: {
  busy: boolean;
  hasValue: boolean;
  open: boolean;
  outcome: HelmOutcome;
}): HelmPose {
  if (busy) return "running";
  if (outcome === "error") return "error";
  if (open) return "hover";
  if (outcome === "done") return "done";
  return hasValue ? "typing" : "rest";
}

/** How many recently used skills the dialog's Skills page offers. */
export const HELM_RECENT_SKILLS = 4;

/** Steps of the room line above the mark. */
export const ROOM_CELLS = 12;

export type RoomTone = "calm" | "amber" | "red";

/**
 * The room line from the share of the context window used: how many of its
 * steps are lit (the room left, rounded up so a little room never reads as
 * none) and its colour, amber past 75% used and red past 90%.
 */
export function roomBar(
  used: number,
  cells = ROOM_CELLS,
): { lit: number; tone: RoomTone; percentLeft: number } {
  const share = Math.min(1, Math.max(0, Number.isFinite(used) ? used : 0));
  const left = 1 - share;
  return {
    lit: left <= 0 ? 0 : Math.max(1, Math.ceil(left * cells - 1e-9)),
    tone: share > 0.9 ? "red" : share > 0.75 ? "amber" : "calm",
    percentLeft: Math.round(left * 100),
  };
}

/** "0:42", "1:12", "1:02:03": elapsed time as a clock reads it. */
export function helmClock(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

/** The blocks of the latest turn: everything after its user message. */
function latestTurn(blocks: readonly Block[]): readonly Block[] {
  for (let index = blocks.length - 1; index >= 0; index--) {
    if (blocks[index].role === "user") return blocks.slice(index + 1);
  }
  return blocks;
}

/** How many files the latest turn edited, each counted once. */
export function turnChangedFiles(blocks: readonly Block[]): number {
  const paths = new Set<string>();
  for (const block of latestTurn(blocks)) {
    if (block.role !== "tool" && block.role !== "approval") continue;
    if (block.approval?.decided === "deny") continue;
    const tool = block.tool;
    if (!isEditTool(tool?.kind, tool?.title || block.text, tool?.preview))
      continue;
    const status = tool?.status?.toLowerCase();
    if (status && ["failed", "error", "cancelled", "canceled"].includes(status))
      continue;
    paths.add(tool?.preview?.path ?? tool?.preview?.fileName ?? block.id);
  }
  return paths.size;
}

/** "Done in 1:12 · 3 files changed", "Done in 0:08". */
export function doneWords(
  durationMs: number | null | undefined,
  files: number,
): { headline: string; detail: string | null } {
  const clock = helmClock(durationMs);
  return {
    headline: clock ? `Done in ${clock}` : "Done",
    detail: files ? `${files} ${files === 1 ? "file" : "files"} changed` : null,
  };
}

/**
 * The mark's accessible name: what pointing at it shows, said at once.
 * "Message settings, Claude Opus 5.5, Max effort, Full access, 23% room
 * left". Parts the chat does not have are left out.
 */
export function helmAccessibleName({
  model,
  effort,
  fast,
  access,
  roomLeft,
  mode,
}: {
  model?: string | null;
  effort?: string | null;
  fast?: boolean;
  access?: string | null;
  roomLeft?: number | null;
  mode?: string | null;
}): string {
  return [
    "Message settings",
    model,
    effort ? `${effort} effort` : null,
    fast ? "Fast" : null,
    access,
    mode,
    roomLeft != null ? `${roomLeft}% room left` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/** A short word for what each effort level costs, as the dialog says it. */
const EFFORT_HINTS: Record<string, string> = {
  min: "quickest",
  minimal: "quickest",
  low: "quick",
  medium: "balanced",
  high: "thinks more",
  "x-high": "thinks longest",
  max: "thinks longest",
  thinking: "thinks first",
};

export function effortHint(effort: string | null | undefined): string | null {
  return effort ? (EFFORT_HINTS[effort.toLowerCase()] ?? null) : null;
}

/** How many of four pips an effort level fills. */
export function effortPips(effort: string | null | undefined): number {
  switch (effort?.toLowerCase()) {
    case undefined:
    case null:
    case "":
      return 0;
    case "min":
    case "minimal":
    case "low":
      return 1;
    case "medium":
      return 2;
    case "high":
    case "thinking":
      return 3;
    default:
      return 4;
  }
}

/**
 * The dialog's rows, top to bottom. Each row opens what it names: the
 * agent's panel (model, effort, access), Free up space, the file picker, or
 * a page of its own (modes, skills, the mark).
 */
export type HelmRowId =
  | "model"
  | "effort"
  | "access"
  | "room"
  | "files"
  | "modes"
  | "skills"
  | "critter";

export const HELM_ROW_ORDER: readonly HelmRowId[] = [
  "model",
  "effort",
  "access",
  "room",
  "files",
  "modes",
  "skills",
  "critter",
];

/** Which rows a chat shows, in order. */
export function helmRows(
  has: Partial<Record<HelmRowId, boolean>>,
): HelmRowId[] {
  return HELM_ROW_ORDER.filter((id) => has[id]);
}

/** The row the ▶ cursor moves to for a key, or null for other keys. */
export function moveHelmCursor(
  key: string,
  index: number,
  count: number,
): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown":
      return index < 0 ? 0 : (index + 1) % count;
    case "ArrowUp":
      return index <= 0 ? count - 1 : index - 1;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/** The cell an arrow key moves to in a grid of `columns`, or null. */
export function moveGridCursor(
  key: string,
  index: number,
  count: number,
  columns: number,
): number | null {
  if (count <= 0) return null;
  const at = Math.min(Math.max(index, 0), count - 1);
  switch (key) {
    case "ArrowRight":
      return (at + 1) % count;
    case "ArrowLeft":
      return (at - 1 + count) % count;
    case "ArrowDown":
      return at + columns < count ? at + columns : at % columns;
    case "ArrowUp": {
      if (at - columns >= 0) return at - columns;
      const lastRow = Math.floor((count - 1) / columns) * columns;
      const below = lastRow + (at % columns);
      return below < count ? below : below - columns;
    }
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * How long the bubble keeps "Done in 1:12" before the mark rests again,
 * and how long "Stopped" stays.
 */
export const HELM_DONE_MS = 3200;
export const HELM_STOPPED_MS = 2000;
/** How long the one-time hint stays if nobody points at the mark. */
export const HELM_HINT_MS = 7000;
/** Pointing must rest this long before the menu opens. */
export const HELM_HOVER_OPEN_MS = 90;
/** Leaving the mark and its menu closes it after this. */
export const HELM_HOVER_CLOSE_MS = 220;

/** Fired on `window` to open the footer's usage details (a failure's fix). */
export const OPEN_USAGE_EVENT = "aven:open-usage";

/**
 * The Mark page's cursor: `sigils` cells in rows of `columns`, then one row
 * of `colours` below them. Arrows move within a row, up and down between
 * the grid and the colours (to the colour under the cell, and back), and
 * Home and End go to the first and last of them all.
 */
export function moveMarkCursor(
  key: string,
  index: number,
  sigils: number,
  columns: number,
  colours: number,
): number | null {
  const total = sigils + colours;
  if (sigils <= 0 || colours <= 0)
    return moveGridCursor(key, index, total, columns);
  const at = Math.min(Math.max(index, 0), total - 1);
  const lastRow = Math.floor((sigils - 1) / columns) * columns;
  const toColour = (column: number) =>
    sigils + Math.round((column / Math.max(columns - 1, 1)) * (colours - 1));
  const toColumn = (colour: number) =>
    Math.round((colour / Math.max(colours - 1, 1)) * (columns - 1));
  if (key === "Home") return 0;
  if (key === "End") return total - 1;
  if (at < sigils) {
    if (key === "ArrowDown" && at + columns >= sigils)
      return toColour(at % columns);
    if (key === "ArrowUp" && at < columns) return toColour(at % columns);
    return moveGridCursor(key, at, sigils, columns);
  }
  const colour = at - sigils;
  switch (key) {
    case "ArrowRight":
      return sigils + ((colour + 1) % colours);
    case "ArrowLeft":
      return sigils + ((colour - 1 + colours) % colours);
    case "ArrowUp":
      return Math.min(lastRow + toColumn(colour), sigils - 1);
    case "ArrowDown":
      return toColumn(colour);
    default:
      return null;
  }
}

/**
 * The mark a chat outside any project shows, chosen in the helm. Kept under
 * the critter name it stands for, as before marks.
 */
export const HELM_CRITTER_KEY = "aven.helmCritter.v1";
/** Set once the helm has said "Point at me for settings". */
export const HELM_HINT_KEY = "aven.helmHint.v1";
/** Fired on `window` when the personal mark changes in this window. */
export const HELM_CRITTER_EVENT = "aven:helm-critter";

export type HelmCritterChoice = {
  /** A critter's name (see `PROJECT_MASCOTS`), drawn as its project sigil. */
  mascot: string;
  /**
   * Its colour, a place in `MARK_TONES` (a colour picked before marks reads
   * the same); none is Grey.
   */
  colorIndex: number | null;
  customColor?: string | null;
};

/** Outside a project the helm shows this until you choose another. */
export const DEFAULT_HELM_CRITTER: HelmCritterChoice = {
  mascot: "owl",
  colorIndex: null,
};

export function loadHelmCritter(): HelmCritterChoice {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(HELM_CRITTER_KEY) ?? "null",
    );
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as HelmCritterChoice).mascot === "string"
    ) {
      const index = (parsed as HelmCritterChoice).colorIndex;
      const custom = (parsed as HelmCritterChoice).customColor;
      return {
        mascot: (parsed as HelmCritterChoice).mascot,
        colorIndex:
          typeof index === "number" && Number.isInteger(index) && index >= 0
            ? index
            : null,
        ...(typeof custom === "string" && /^#[0-9a-f]{6}$/i.test(custom)
          ? { customColor: custom }
          : {}),
      };
    }
  } catch {
    // Storage unavailable or unreadable: the default mark.
  }
  return DEFAULT_HELM_CRITTER;
}

export function saveHelmCritter(choice: HelmCritterChoice): void {
  try {
    localStorage.setItem(HELM_CRITTER_KEY, JSON.stringify(choice));
  } catch {
    // This window still shows it until it reloads.
  }
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(HELM_CRITTER_EVENT));
}

let personalCritter: HelmCritterChoice | null = null;

/** The personal mark, read once and kept in step with changes. */
export function helmCritterSnapshot(): HelmCritterChoice {
  personalCritter ??= loadHelmCritter();
  return personalCritter;
}

export function subscribeHelmCritter(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const refresh = (event?: Event) => {
    if (event instanceof StorageEvent && event.key !== HELM_CRITTER_KEY) return;
    personalCritter = loadHelmCritter();
    listener();
  };
  window.addEventListener(HELM_CRITTER_EVENT, refresh);
  window.addEventListener("storage", refresh);
  return () => {
    window.removeEventListener(HELM_CRITTER_EVENT, refresh);
    window.removeEventListener("storage", refresh);
  };
}

/** Whether the one-time "Point at me for settings" hint is still due. */
export function helmHintDue(): boolean {
  try {
    return localStorage.getItem(HELM_HINT_KEY) == null;
  } catch {
    return false;
  }
}

export function markHelmHintSeen(): void {
  try {
    localStorage.setItem(HELM_HINT_KEY, "seen");
  } catch {
    // Without storage the hint shows once per window.
  }
}

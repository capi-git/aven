import {
  PAGES_MAX,
  SPOTS_MAX,
  type CrewCard,
  type CrewRound,
  type CrewSpot,
  CREW_NOTE_MAX,
} from "./crews";
import type { PictureSize } from "./pagePictures";

/**
 * What Avos's Review says about the work it shows: a short list of what
 * changed (one row per card), what its checks did, and the text and branch
 * of a pull request made from it. The panel itself is `AvosReview`.
 */

/** One row in What changed: a card, with the first thing its Builder said. */
export type ReviewRow = { id: string; title: string; line?: string };

const LINE_MAX = 140;

function currentRound(card: CrewCard): CrewRound | undefined {
  return (
    card.rounds.find((round) => round.n === card.round) ?? card.rounds.at(-1)
  );
}

/** The first sentence of `text`, cut to `max` characters at a word. */
export function firstSentence(text: string, max = LINE_MAX): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const sentence = flat.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? flat;
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max).replace(/\s+\S*$/, "");
  return `${cut || sentence.slice(0, max)}…`;
}

/** What changed: each card in the order it was built, with its summary. */
export function reviewRows(cards: readonly CrewCard[]): ReviewRow[] {
  return cards.map((card) => {
    const summary = currentRound(card)?.handoff?.summary?.trim();
    const line = summary ? firstSentence(summary) : "";
    return {
      id: card.id,
      title: card.title,
      ...(line && line.toLowerCase() !== card.title.toLowerCase()
        ? { line }
        : {}),
    };
  });
}

/** One quiet line on how the work was checked. */
export function reviewChecks(cards: readonly CrewCard[]): string {
  if (cards.length && cards.every((card) => card.stacked?.replayed))
    return "Moved onto your latest files, not checked again since";
  const ran = [
    ...new Set(
      cards.flatMap((card) =>
        (currentRound(card)?.verdict?.ran ?? [])
          .filter((item) => item.ok)
          .map((item) => item.command.replace(/\s+/g, " ").trim())
          .filter(Boolean),
      ),
    ),
  ];
  if (!ran.length) return "Checker looked at it and found no problems";
  const shown = ran.slice(0, 3).join(", ");
  return `Checker ran ${shown}${ran.length > 3 ? ` and ${ran.length - 3} more` : ""}`;
}

/**
 * The longest pull request Aven sends (see `publish_range`): its title in
 * characters, its body in UTF-8 bytes.
 */
export const PR_TITLE_MAX = 200;
export const PR_BODY_MAX_BYTES = 20_000;

/** `text`, cut at a whole character to fit `max` UTF-8 bytes, ending in "…". */
export function fitBytes(text: string, max: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= max) return text;
  const end = "\n…";
  const room = Math.max(0, max - encoder.encode(end).length);
  // Never writes part of a character: `read` ends between two.
  const { read } = encoder.encodeInto(text, new Uint8Array(room));
  return `${text.slice(0, read)}${end}`;
}

/** The pull request's title and body for these cards. */
export function prText(cards: readonly CrewCard[]): {
  title: string;
  body: string;
} {
  const first = cards[0];
  const title = !first
    ? "Changes from Avos"
    : cards.length === 1
      ? first.title
      : `${first.title} and ${cards.length - 1} more`;
  const rows = reviewRows(cards).map(
    (row) => `- **${row.title}**${row.line ? `: ${row.line}` : ""}`,
  );
  const body = [
    "Made by Avos in Aven, and checked by its Checker before it was sent.",
    "",
    "## What changed",
    ...rows,
    "",
    "## Checks",
    `- ${reviewChecks(cards)}`,
  ].join("\n");
  return {
    // By character, as Aven checks it: never half of an emoji.
    title: Array.from(title).slice(0, PR_TITLE_MAX).join(""),
    body: fitBytes(body, PR_BODY_MAX_BYTES),
  };
}

/** The branch a pull request goes out on: `avos/`, the title, and a stamp. */
export function prBranch(title: string, now = Date.now()): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/g, "") || "changes";
  return `avos/${slug}-${now.toString(36).slice(-6)}`;
}

/**
 * The pages to picture for these cards: those their Builders said they
 * changed, in order, a few at most. None when no card changed what people
 * see, and then Review has no pictures.
 */
export function reviewPages(cards: readonly CrewCard[]): string[] {
  const pages = cards.flatMap(
    (card) => currentRound(card)?.handoff?.pages ?? [],
  );
  return [...new Set(pages)].slice(0, PAGES_MAX);
}

/** What the Builders said they changed on `page`, in order, a few at most. */
export function reviewSpots(
  cards: readonly CrewCard[],
  page: string,
): CrewSpot[] {
  return cards
    .flatMap((card) => currentRound(card)?.handoff?.spots ?? [])
    .filter((spot) => spot.page === page)
    .slice(0, SPOTS_MAX);
}

/** A note you left by clicking a picture of Avos's version. */
export type PictureNote = {
  page: string;
  size: PictureSize;
  /** What you clicked, as the page described it ("button “Sign up”"). */
  what?: string;
  /** A selector for it, for Avos to find it by. */
  element?: string;
  /** Where on the picture, as fractions of it. */
  at?: readonly [number, number];
  text: string;
};

/** Notes kept for one ask at most: they share one card's note. */
export const PICTURE_NOTES_MAX = 6;

/**
 * What goes to Avos when you ask for changes: your words, then the notes
 * you left on the pictures, each saying where it was left. It must fit in
 * a card's note (`max`): selectors are left out if that makes it fit, and
 * null means it can't.
 */
export function askWithNotes(
  words: string,
  notes: readonly PictureNote[],
  max = CREW_NOTE_MAX,
): string | null {
  const said = words.trim();
  if (!notes.length) return said.length <= max ? said : null;
  const write = (selectors: boolean) =>
    [
      ...(said ? [said, ""] : []),
      "Notes on the pictures of your version:",
      ...notes.slice(0, PICTURE_NOTES_MAX).map((note, index) => {
        const where = [
          `On ${note.page} (${note.size})`,
          note.what ? `, at the ${note.what}` : "",
          selectors && note.element ? ` (\`${note.element}\`)` : "",
        ].join("");
        return `${index + 1}. ${where}: ${note.text.trim()}`;
      }),
    ].join("\n");
  const full = write(true);
  if (full.length <= max) return full;
  const short = write(false);
  return short.length <= max ? short : null;
}

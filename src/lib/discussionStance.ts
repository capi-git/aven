/**
 * Whether a discussion reply agrees with the one before it or pushes back,
 * read from its first words without asking a model. It only drives a small
 * marker and a one-shot mascot reaction, so it is deliberately cautious:
 * mixed or unclear openings count as neither.
 */
export type DiscussionStance = "agree" | "pushback";

/** How much of a reply's start is read. */
const OPENING_CHARS = 180;

/** Openings that agree with what came before. */
const AGREE_START = new RegExp(
  "^(?:" +
    [
      "agreed",
      "(?:i |we )?(?:fully |completely |totally |strongly |wholeheartedly )?agree(?! to disagree)\\b",
      "(?:yes|yep|yeah|yup)\\b(?! and no)",
      "(?:good|great|nice|fair|excellent|sharp) (?:catch|call|point|idea)",
      "fair enough",
      "(?:that|this|it) (?:works|makes sense|sounds (?:good|right|great))",
      "(?:that|this|it)(?: is|'s) (?:right|correct|fair)",
      "works for me",
      "makes sense",
      "sounds (?:good|right|great)",
      "exactly(?! not)",
      "absolutely(?! not)",
      "definitely(?! not)",
      "(?:you're|you are) (?:right|correct|spot on)",
      "right[.!]",
      "\\+1",
      "lgtm",
      "looks good",
      "love (?:it|this|that)",
      "no (?:objections?|argument|disagreement) (?:here|from me)",
      "(?:i'm|i am) on board",
      "on board",
      "same here",
      "spot on",
    ].join("|") +
    ")",
);

/** Openings that push back on what came before. */
const PUSH_START = new RegExp(
  "^(?:" +
    [
      "push(?:ing)? ?back",
      "(?:i'd|i would|i want to|let me|i'm going to|i have to) push back",
      "(?:i |we )?(?:respectfully |strongly )?disagree",
      "(?:i |we )?(?:don't|do not) agree",
      "not (?:quite|really|so fast|necessarily|exactly)\\b",
      "(?:i'm|i am) not (?:convinced|sure (?:that|this|it|we)|so sure)",
      "(?:i'm|i am) (?:skeptical|sceptical|wary)",
      "hold on",
      "wait[,.!]",
      "no[,.!]",
      "nope",
      "on the contrary",
      "counter-?point",
      "i see it differently",
      "(?:i'd|i would) (?:argue|rather not|avoid|not)\\b",
      "instead\\b",
      "rather than\\b",
      "(?:that|this|it) (?:won't|wouldn't|doesn't|does not|will not|would not) work",
    ].join("|") +
    ")",
);

/** Pushing back anywhere in the opening, even after other words. */
const PUSH_STRONG =
  /\b(?:push(?:ing)? ?back|disagree|not quite|not convinced|(?:won't|wouldn't|doesn't|does not|will not|would not) work|i'd argue)\b/;

/** Pushing back mildly: counts only when nothing agrees first. */
const PUSH_WEAK = /\binstead\b|\brather than\b/;

/** "But", "however": an agreement that turns. */
const CONTRAST = /\b(?:but|however|though|although|except)\b/;

/** "I don't disagree", "no disagreement": not a pushback. */
const NEGATED_PUSH =
  /\b(?:don't|do not|doesn't|didn't|no|not|never)\s+(?:\w+\s+)?(?:disagree|disagreement|pushback|push back)\b/;

/** "Yes and no", "agree to disagree", "partly agree": too mixed to call. */
const MIXED =
  /^(?:yes and no|(?:i |we )?(?:partly|partially|half|mostly|somewhat) agree|agree to disagree)\b/;

/** The first sentence or two of a reply, in plain lower-case words. */
export function stanceOpening(text: string): string {
  const plain = text
    .replace(/\r\n?/g, "\n")
    // Leading headings, quotes, list marks and emphasis are not words.
    .replace(/^[\s>#*_~`-]+/, "")
    .replace(/[*_~`]+/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .trimStart();
  // Up to the second sentence end, or the first line.
  const line = plain.split("\n", 1)[0] ?? "";
  const ends = [...line.matchAll(/[.!?](?=\s|$)/g)].map((match) => match.index);
  const cut = ends.length > 1 ? ends[1] + 1 : line.length;
  return line.slice(0, Math.min(cut, OPENING_CHARS)).trim();
}

/**
 * The stance of a reply from its first words, or null when it is neutral,
 * mixed or unclear. Conservative by design: an agreement that turns ("Yes,
 * but…") or a reply that starts with both counts as neither.
 */
export function replyStance(text: string): DiscussionStance | null {
  const opening = stanceOpening(text);
  if (!opening || MIXED.test(opening)) return null;
  const negated = NEGATED_PUSH.test(opening);
  const agrees = AGREE_START.test(opening);
  const pushes = !negated && PUSH_START.test(opening);
  const strong = !negated && PUSH_STRONG.test(opening);
  if (agrees) return strong || CONTRAST.test(opening) ? null : "agree";
  if (pushes || strong) return "pushback";
  if (!negated && PUSH_WEAK.test(opening) && !CONTRAST.test(opening))
    return "pushback";
  return null;
}

/**
 * A card an automation run can leave in the Inbox when it finished with
 * something for you to look at: a draft to publish, a preview to check.
 *
 * Runs are unattended, so the agent is asked to save its work as a draft and
 * describe it in one fenced `aven-review` block that ends its final reply.
 * Aven reads that block when the run settles and keeps the card on the run
 * until you act on it or take it away. A run that just finished leaves none.
 *
 * The agent only describes the card. What its button says, and what pressing
 * it sends back to the run, are Aven's own words for the card's kind: a card
 * is text an agent wrote, and pressing it must never send words you did not
 * see.
 */

export type AutomationReviewStatus = "open" | "done" | "dismissed";
export type AutomationReviewKind = "review" | "publish";

export type AutomationReview = {
  kind: AutomationReviewKind;
  title: string;
  summary: string;
  /** Where the draft or preview is: an http(s) link. */
  url?: string;
  status: AutomationReviewStatus;
  postedAt: number;
  resolvedAt?: number;
};

export const REVIEW_FENCE = "aven-review";

/** The button on each kind of card, and what pressing it tells the run. */
export const REVIEW_ACTIONS: Record<
  AutomationReviewKind,
  { label: string; message: string }
> = {
  publish: { label: "Publish", message: "Publish the draft now." },
  review: { label: "Approve", message: "Approved. Go ahead." },
};

export function reviewAction(review: Pick<AutomationReview, "kind">) {
  return REVIEW_ACTIONS[review.kind];
}

const TITLE_LIMIT = 120;
const SUMMARY_LIMIT = 600;
const URL_LIMIT = 2048;

function clip(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > limit
    ? `${clean.slice(0, limit - 1).trimEnd()}…`
    : clean;
}

/** Only http(s) links: the card opens them in Aven's browser. */
export function reviewUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > URL_LIMIT) return undefined;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

type Fence = { info: string; body: string; start: number; end: number };

const OPENING = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/;

/**
 * The fenced blocks at the top level of a Markdown reply, as CommonMark
 * reads them: a fence inside another fence is that fence's text, and a
 * fence in a quote or a list item does not start at a line's start.
 * `start` and `end` are line indexes; an unclosed fence runs to the end.
 */
function topLevelFences(lines: readonly string[]): Fence[] {
  const fences: Fence[] = [];
  let open: { marker: string; info: string; start: number } | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!open) {
      const match = OPENING.exec(line);
      if (!match) continue;
      const marker = match[1]!;
      const info = match[2]!.trim();
      // A backtick fence's info string cannot hold a backtick.
      if (marker[0] === "`" && info.includes("`")) continue;
      open = { marker, info, start: index };
      continue;
    }
    const close = new RegExp(
      `^ {0,3}${open.marker[0] === "`" ? "`" : "~"}{${open.marker.length},}[ \\t]*$`,
    );
    if (!close.test(line)) continue;
    fences.push({
      info: open.info,
      body: lines.slice(open.start + 1, index).join("\n"),
      start: open.start,
      end: index,
    });
    open = null;
  }
  if (open)
    fences.push({
      info: open.info,
      body: lines.slice(open.start + 1).join("\n"),
      start: open.start,
      end: lines.length,
    });
  return fences;
}

const fenceNamed = (name: string) => (fence: Fence) =>
  fence.info.split(/\s/)[0]?.toLowerCase() === name;

/**
 * The one `name` block that ends the reply, with where it starts. Null when
 * there is none, when it is not the last thing in the reply, or when the
 * reply holds more than one: a block quoted inside another fence, a quote
 * or a list is text, not a card.
 */
function finalFence(
  text: string,
  name: string,
): { fence: Fence; lines: string[] } | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const fences = topLevelFences(lines).filter(fenceNamed(name));
  if (fences.length !== 1) return null;
  const fence = fences[0]!;
  if (fence.end >= lines.length) return null;
  if (lines.slice(fence.end + 1).some((line) => line.trim())) return null;
  return { fence, lines };
}

const finalReviewFence = (text: string) => finalFence(text, REVIEW_FENCE);

/**
 * The one fenced `name` block that ends a reply, as its body and the reply
 * before it; null by the same rules as a review card (see `finalFence`).
 * Crews read their bots' handoff notes and verdicts this way.
 */
export function finalFencedBlock(
  text: string,
  name: string,
): { body: string; before: string } | null {
  const found = finalFence(text, name.toLowerCase());
  if (!found) return null;
  return {
    body: found.fence.body,
    before: found.lines.slice(0, found.fence.start).join("\n").trim(),
  };
}

function kindFrom(fields: Record<string, unknown>): AutomationReviewKind {
  if (fields.kind === "publish" || fields.kind === "review") return fields.kind;
  // Earlier wording named the button; a Publish button made a publish card.
  const action =
    fields.action && typeof fields.action === "object"
      ? (fields.action as Record<string, unknown>).label
      : fields.action;
  return typeof action === "string" && /publish/i.test(action)
    ? "publish"
    : "review";
}

/**
 * The card the agent described at the very end of its final reply, or null
 * when it left none (or the block is not a JSON object with a title). Only
 * its kind, title, summary and link are read.
 */
export function parseAutomationReview(
  text: string,
  postedAt: number,
): AutomationReview | null {
  const found = finalReviewFence(text);
  if (!found) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(found.fence.body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return null;
  const fields = parsed as Record<string, unknown>;
  const title = clip(fields.title, TITLE_LIMIT);
  if (!title) return null;
  const url = reviewUrl(fields.url);
  return {
    kind: kindFrom(fields),
    title,
    summary: clip(fields.summary, SUMMARY_LIMIT),
    ...(url ? { url } : {}),
    status: "open",
    postedAt,
  };
}

/** The reply without its review block, for the run's one-line summary. */
export function stripAutomationReview(text: string): string {
  const found = finalReviewFence(text);
  if (!found) return text.trim();
  return found.lines.slice(0, found.fence.start).join("\n").trim();
}

export function normalizeAutomationReview(
  value: unknown,
): AutomationReview | null {
  if (!value || typeof value !== "object") return null;
  const review = value as Record<string, unknown>;
  const title = clip(review.title, TITLE_LIMIT);
  if (
    !title ||
    typeof review.postedAt !== "number" ||
    !Number.isFinite(review.postedAt)
  )
    return null;
  const status: AutomationReviewStatus =
    review.status === "done" || review.status === "dismissed"
      ? review.status
      : "open";
  const url = reviewUrl(review.url);
  return {
    kind: review.kind === "publish" ? "publish" : "review",
    title,
    summary: clip(review.summary, SUMMARY_LIMIT),
    ...(url ? { url } : {}),
    status,
    postedAt: review.postedAt,
    ...(typeof review.resolvedAt === "number" &&
    Number.isFinite(review.resolvedAt)
      ? { resolvedAt: review.resolvedAt }
      : {}),
  };
}

/** "Ready to publish" or "Ready to review", the card's kind in words. */
export function reviewHeading(review: Pick<AutomationReview, "kind">): string {
  return review.kind === "publish" ? "Ready to publish" : "Ready to review";
}

/**
 * What the agent is sent for an automation run: your prompt, then how to
 * leave a card. The chat shows your prompt alone.
 */
export function automationPrompt(prompt: string): string {
  const { publish, review } = REVIEW_ACTIONS;
  return `${prompt.trim()}

---
Aven runs this automation on a schedule while nobody watches the chat. If you finish with something the user should review or publish (a draft post, a pull request, a preview), do not publish, merge or send it yourself: save it as a draft, then end your reply with one block like this, as the very last thing in it, so Aven can put a card in their Inbox:

\`\`\`${REVIEW_FENCE}
{"kind": "publish", "title": "Short title", "summary": "One or two sentences on what to check.", "url": "https://link-to-the-draft-or-preview"}
\`\`\`

Use "kind": "publish" for something ready to go out and "review" for anything else; "summary" and "url" are optional. The card's button sends you "${publish.message}" for a publish card, or "${review.message}" for a review card, in this conversation. Leave the block out when there is nothing to review; a plain report needs no card.`;
}

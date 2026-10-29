/**
 * A card an automation run can leave in the Inbox when it finished with
 * something for you to look at: a draft to publish, a preview to check.
 *
 * Runs are unattended, so the agent is asked to save its work as a draft and
 * describe it in a fenced `aven-review` block at the end of its reply. Aven
 * reads that block when the run settles and keeps the card on the run until
 * you act on it or dismiss it. A run that just finished leaves no card.
 */

export type AutomationReviewStatus = "open" | "done" | "dismissed";

export type AutomationReview = {
  /** "publish" when the agent's button publishes; otherwise "review". */
  kind: "review" | "publish";
  title: string;
  summary: string;
  /** Where the draft or preview is: an http(s) link. */
  url?: string;
  /**
   * The card's button. With a message, pressing it sends the message to the
   * run's conversation ("Publish the draft now."); without one it opens `url`.
   */
  action?: { label: string; message?: string };
  status: AutomationReviewStatus;
  postedAt: number;
  resolvedAt?: number;
};

export const REVIEW_FENCE = "aven-review";

const TITLE_LIMIT = 120;
const SUMMARY_LIMIT = 600;
const LABEL_LIMIT = 40;
const MESSAGE_LIMIT = 2000;
const URL_LIMIT = 2048;

const FENCE = new RegExp(
  "(^|\\n)[ \\t]*(`{3,}|~{3,})[ \\t]*" +
    REVIEW_FENCE +
    "[^\\n]*\\n([\\s\\S]*?)\\n[ \\t]*\\2[ \\t]*(?=\\n|$)",
  "g",
);

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

function actionFrom(
  label: unknown,
  message: unknown,
): AutomationReview["action"] {
  const text = clip(label, LABEL_LIMIT);
  if (!text) return undefined;
  const said =
    typeof message === "string" ? message.trim().slice(0, MESSAGE_LIMIT) : "";
  return said ? { label: text, message: said } : { label: text };
}

function kindFor(
  value: unknown,
  action: AutomationReview["action"],
): AutomationReview["kind"] {
  if (value === "publish" || value === "review") return value;
  return action && /publish/i.test(action.label) ? "publish" : "review";
}

/**
 * The card the agent described in its final reply, or null when it left no
 * block (or the last one is not valid JSON with a title).
 */
export function parseAutomationReview(
  text: string,
  postedAt: number,
): AutomationReview | null {
  let body: string | null = null;
  for (const match of text.matchAll(FENCE)) body = match[3] ?? null;
  if (body == null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return null;
  const fields = parsed as Record<string, unknown>;
  const title = clip(fields.title, TITLE_LIMIT);
  if (!title) return null;
  const nested =
    fields.action && typeof fields.action === "object"
      ? (fields.action as Record<string, unknown>)
      : null;
  const action = nested
    ? actionFrom(nested.label, nested.message)
    : actionFrom(fields.action, fields.message);
  const url = reviewUrl(fields.url);
  return {
    kind: kindFor(fields.kind, action),
    title,
    summary: clip(fields.summary, SUMMARY_LIMIT),
    ...(url ? { url } : {}),
    // A button with nothing to send and nowhere to go does nothing.
    ...(action && (action.message || url) ? { action } : {}),
    status: "open",
    postedAt,
  };
}

/** The reply without its review block, for the run's one-line summary. */
export function stripAutomationReview(text: string): string {
  return text.replace(FENCE, "$1").trim();
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
  const nested =
    review.action && typeof review.action === "object"
      ? (review.action as Record<string, unknown>)
      : null;
  const action = nested ? actionFrom(nested.label, nested.message) : undefined;
  const url = reviewUrl(review.url);
  return {
    kind: review.kind === "publish" ? "publish" : "review",
    title,
    summary: clip(review.summary, SUMMARY_LIMIT),
    ...(url ? { url } : {}),
    ...(action ? { action } : {}),
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
  return `${prompt.trim()}

---
Aven runs this automation on a schedule while nobody watches the chat. If you finish with something the user should review or publish (a draft post, a pull request, a preview), do not publish, merge or send it yourself: save it as a draft, then end your reply with one block like this so Aven can put it in their Inbox:

\`\`\`${REVIEW_FENCE}
{"title": "Short title", "summary": "One or two sentences on what to check.", "url": "https://link-to-the-draft-or-preview", "action": "Publish", "message": "What to do when they press the button, e.g. Publish the draft now."}
\`\`\`

"url", "action" and "message" are optional. Leave the block out when there is nothing to review; a plain report needs no card.`;
}

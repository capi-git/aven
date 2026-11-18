import { limitSection, parseJsonObject, stringField } from "./jsonText";
import { loadPrompt } from "./prompts";

export type CommitMessage = {
  subject: string;
  body: string;
};

export type PrContent = {
  title: string;
  body: string;
};

export function buildCommitMessagePrompt(input: {
  branch: string | null;
  stagedSummary: string;
  stagedPatch: string;
  includeBranch?: boolean;
  /** The instruction; Settings › Prompts' "Commit message" by default. */
  instructions?: string;
}): string {
  const wantsBranch = input.includeBranch === true;
  // A custom instruction replaces only this part: the reply format and the
  // data below are what `parseCommitMessage` relies on.
  return [
    (input.instructions ?? loadPrompt("commit-message")).trim(),
    "",
    wantsBranch
      ? "Return a JSON object with keys: subject, body, branch."
      : "Return a JSON object with keys: subject, body.",
    "Do not call tools. Reply with JSON only.",
    ...(wantsBranch
      ? ["branch must be a short semantic git branch fragment for this change."]
      : []),
    "",
    `Branch: ${input.branch ?? "(detached)"}`,
    "",
    "Staged files:",
    limitSection(input.stagedSummary, 6_000),
    "",
    "Staged patch:",
    limitSection(input.stagedPatch, 40_000),
  ].join("\n");
}

export function buildPrContentPrompt(input: {
  baseBranch: string;
  headBranch: string;
  commitSummary: string;
  diffSummary: string;
  diffPatch: string;
  /** The instruction; Settings › Prompts' "Create PR" by default. */
  instructions?: string;
}): string {
  return [
    (input.instructions ?? loadPrompt("create-pr")).trim(),
    "",
    "Return a JSON object with keys: title, body.",
    "Do not call tools. Reply with JSON only.",
    "",
    `Base branch: ${input.baseBranch}`,
    `Head branch: ${input.headBranch}`,
    "",
    "Commits:",
    limitSection(input.commitSummary, 12_000),
    "",
    "Diff stat:",
    limitSection(input.diffSummary, 12_000),
    "",
    "Diff patch:",
    limitSection(input.diffPatch, 40_000),
  ].join("\n");
}

export function buildBranchNamePrompt(message: string): string {
  return [
    "You generate concise git branch names.",
    "Return a JSON object with key: branch.",
    "Do not call tools. Reply with JSON only.",
    "Rules:",
    "- Branch should describe the requested work from the user message.",
    "- Keep it short and specific (2-6 words).",
    "- Use plain words only, no issue prefixes and no punctuation-heavy text.",
    "",
    "User message:",
    limitSection(message, 8_000),
  ].join("\n");
}

export function parseCommitMessage(raw: string): CommitMessage | null {
  const rec = parseJsonObject(raw);
  if (!rec) return null;
  const subject = sanitizeCommitSubject(
    stringField(rec, "subject") ||
      stringField(rec, "title") ||
      stringField(rec, "message"),
  );
  if (!subject) return null;
  return { subject, body: commitBody(rec) };
}

function commitBody(rec: Record<string, unknown>): string {
  const value = rec.body;
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => (typeof item === "string" ? [item] : []))
      .join("\n")
      .trim();
  }
  return "";
}

export function formatCommitMessage(message: CommitMessage): string {
  return message.body
    ? `${message.subject}\n\n${message.body}`
    : message.subject;
}

export function parsePrContent(raw: string): PrContent | null {
  const rec = parseJsonObject(raw);
  if (!rec) return null;
  const title = sanitizePrTitle(stringField(rec, "title"));
  const body = stringField(rec, "body").trim();
  if (!title) return null;
  return { title, body };
}

export function parseBranchName(raw: string): string | null {
  const rec = parseJsonObject(raw);
  const branch = sanitizeBranchFragment(rec ? stringField(rec, "branch") : raw);
  return branch || null;
}

export function sanitizeCommitSubject(raw: string): string {
  const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  const withoutTrailingPeriod = singleLine.replace(/[.]+$/g, "").trim();
  if (!withoutTrailingPeriod) return "";
  if (withoutTrailingPeriod.length <= 72) return withoutTrailingPeriod;
  return withoutTrailingPeriod.slice(0, 72).trimEnd();
}

export function sanitizePrTitle(raw: string): string {
  return raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
}

export function sanitizeBranchFragment(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/['"`]/g, "")
    .replace(/^[./\s_-]+|[./\s_-]+$/g, "");
  const fragment = normalized
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/-+/g, "-")
    .replace(/^[./_-]+|[./_-]+$/g, "")
    .slice(0, 64)
    .replace(/[./_-]+$/g, "");
  return fragment;
}

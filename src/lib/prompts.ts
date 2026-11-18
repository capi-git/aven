/**
 * The built-in instructions behind Aven's AI actions, each editable in
 * Settings › Prompts. A custom text replaces only the instruction: the data
 * an action adds (a diff, a pull request's failing checks) and any reply
 * format Aven reads back stay fixed in code.
 */

export type PromptId =
  | "create-pr"
  | "commit-push"
  | "commit"
  | "resolve-conflicts"
  | "fix-checks"
  | "investigate-blocker"
  | "fix-review"
  | "commit-message"
  | "enhance-prompt"
  | "review-replies";

export type PromptGroup = "Git" | "Actions";

export type PromptDefinition = {
  id: PromptId;
  group: PromptGroup;
  label: string;
  /** Where Aven uses it, in a few words. */
  use: string;
  defaultText: string;
};

const CHECKS_AND_PUSH =
  "Run the project's checks, then commit and push following the repository's remote and account rules.";

export const PROMPTS: readonly PromptDefinition[] = [
  {
    id: "create-pr",
    group: "Git",
    label: "Create PR",
    use: "Writes a pull request's title and description",
    defaultText: [
      "You write source control change request content.",
      "Rules:",
      "- title should be concise and specific",
      "- body must be markdown and include headings '## Summary' and '## Testing'",
      "- under Summary, provide short bullet points",
      "- under Testing, include bullet points with concrete checks or 'Not run' where appropriate",
    ].join("\n"),
  },
  {
    id: "commit-push",
    group: "Git",
    label: "Commit and push",
    use: "Asks the agent when its branch is behind its remote",
    defaultText:
      "Commit all of your changes on this branch with a clear message. The branch is behind its remote: bring it up to date (rebase or merge, as the repository prefers) and resolve any conflicts so both sides' work is kept. Push it, following the repository's remote and account rules. Report what you pushed.",
  },
  {
    id: "commit",
    group: "Git",
    label: "Commit",
    use: "What agents do when they finish, if Git is set to Commit",
    defaultText:
      "When you finish changing files, commit your work with a clear message on the current branch, or on a new branch if you are on the default branch. Do not push or open a pull request.",
  },
  {
    id: "resolve-conflicts",
    group: "Git",
    label: "Resolve",
    use: "A pull request with merge conflicts",
    defaultText: `This branch's pull request has merge conflicts with its base branch. Bring the base branch into this branch (rebase or merge, as the repository prefers) and resolve every conflict so both sides' intent is kept. Don't drop work from either side. ${CHECKS_AND_PUSH} Report what conflicted and how you resolved it.`,
  },
  {
    id: "fix-checks",
    group: "Git",
    label: "Fix checks",
    use: "A pull request whose checks fail",
    defaultText: `Checks are failing on this branch's pull request. For each failing check, read its logs (for example with \`gh run view --log-failed\`), find the root cause and fix it. Don't skip, disable or weaken a check to make it pass. ${CHECKS_AND_PUSH} Report what failed and what you changed.`,
  },
  {
    id: "investigate-blocker",
    group: "Git",
    label: "Investigate",
    use: "A pull request blocked for another reason",
    defaultText: `This branch's pull request can't be merged yet. Find out what blocks it (for example with \`gh pr view --json mergeStateStatus,reviewDecision,statusCheckRollup\`): a base branch it is behind, a required check or review, a draft, or a branch rule. Fix what you can on this branch. ${CHECKS_AND_PUSH} Report what blocked it and anything only a person can do, such as approving a review.`,
  },
  {
    id: "fix-review",
    group: "Git",
    label: "Fix review",
    use: "Requested changes or unresolved review comments",
    defaultText: `Reviewers asked for changes on this branch's pull request. Work through each comment below: make the change, or say briefly why it shouldn't be made. ${CHECKS_AND_PUSH} Report what you did for each comment.`,
  },
  {
    id: "commit-message",
    group: "Actions",
    label: "Commit message",
    use: "Writes commit messages for Commit and the merge line",
    defaultText: [
      "You write concise git commit messages.",
      "Rules:",
      "- subject must be imperative, <= 72 chars, and no trailing period",
      "- body can be empty string or short bullet points",
      "- capture the primary user-visible or developer-visible change",
    ].join("\n"),
  },
  {
    id: "enhance-prompt",
    group: "Actions",
    label: "Prompt enhancement",
    use: "Adds to a draft in the message box, keeping your words",
    defaultText: [
      "You improve a message someone is about to send to a coding agent. You never answer it, plan it or do the work.",
      "",
      "Their draft stays exactly as they wrote it. Add only what makes it easier to act on:",
      "- what “done” looks like, as a few short checks drawn from what they asked",
      "- constraints the draft implies, such as keeping existing behaviour or matching nearby code",
      "- a question the agent should settle first, only if the draft is truly unclear",
      "",
      "Never invent features, files, tools or requirements. Write in their voice and language. Keep it short: a few lines, no preamble and no Markdown headings.",
    ].join("\n"),
  },
  {
    id: "review-replies",
    group: "Actions",
    label: "Review replies",
    use: "Fix and reply, on a review thread in Review",
    defaultText: `Here is a review thread from this branch's pull request. Decide whether the comment is right. If it is, fix it. ${CHECKS_AND_PUSH} Then draft a short reply to the reviewer saying what you changed, or why you didn't, and show it to me before posting it.`,
  },
];

export const PROMPT_IDS: readonly PromptId[] = PROMPTS.map(({ id }) => id);

const BY_ID = new Map<PromptId, PromptDefinition>(
  PROMPTS.map((prompt) => [prompt.id, prompt]),
);

export function promptDefinition(id: PromptId): PromptDefinition {
  return BY_ID.get(id)!;
}

export const PROMPTS_CHANGE_EVENT = "aven:prompts-change";
const KEY_PREFIX = "aven.prompt.";
/** Plenty for an instruction; a stray paste can't fill storage. */
export const PROMPT_MAX_LENGTH = 8_000;

export function promptStorageKey(id: PromptId): string {
  return `${KEY_PREFIX}${id}`;
}

/** The saved custom text, or null while the default is in use. */
export function loadCustomPrompt(id: PromptId): string | null {
  try {
    const raw = localStorage.getItem(promptStorageKey(id));
    const text = raw?.trim();
    return text ? text.slice(0, PROMPT_MAX_LENGTH) : null;
  } catch {
    return null;
  }
}

/** The instruction an action uses now: the custom text, else the default. */
export function loadPrompt(id: PromptId): string {
  return loadCustomPrompt(id) ?? promptDefinition(id).defaultText;
}

/**
 * Saves a custom text. Empty text, or the default itself, goes back to the
 * default, so a later improvement to the default still reaches it.
 */
export function savePrompt(id: PromptId, text: string | null): void {
  const value = (text ?? "").trim().slice(0, PROMPT_MAX_LENGTH);
  const reset = !value || value === promptDefinition(id).defaultText.trim();
  try {
    if (reset) localStorage.removeItem(promptStorageKey(id));
    else localStorage.setItem(promptStorageKey(id), value);
  } catch {
    // private mode / quota: the default stays in use
  }
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(PROMPTS_CHANGE_EVENT));
}

/** Changes here, and from another window (the floating sidebar's webview). */
export function subscribePrompts(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key.startsWith(KEY_PREFIX)) listener();
  };
  window.addEventListener(PROMPTS_CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(PROMPTS_CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

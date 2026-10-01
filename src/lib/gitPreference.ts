/**
 * What agents do with their changes when they finish. "project" leaves the
 * decision to each project's own instructions; every other choice is the
 * user's standing preference and is passed to every agent turn.
 */
export type GitFinishBehavior = "project" | "leave" | "commit" | "pr";

export const GIT_FINISH_BEHAVIOR_DEFAULT: GitFinishBehavior = "project";

const KEY = "aven.gitFinishBehavior";
const EVENT = "aven:git-finish-behavior";

export const GIT_FINISH_BEHAVIOR_OPTIONS: readonly {
  value: GitFinishBehavior;
  label: string;
  description: string;
}[] = [
  {
    value: "project",
    label: "Follow the project",
    description: "Agents do what each project's instructions say.",
  },
  {
    value: "leave",
    label: "Leave changes for me",
    description: "Nothing is committed. You review and commit yourself.",
  },
  {
    value: "commit",
    label: "Commit on a branch",
    description: "Agents commit their work but never push it.",
  },
  {
    value: "pr",
    label: "Open a pull request",
    description: "Agents commit, push a branch and open a pull request.",
  },
];

function isGitFinishBehavior(value: unknown): value is GitFinishBehavior {
  return GIT_FINISH_BEHAVIOR_OPTIONS.some((option) => option.value === value);
}

export function loadGitFinishBehavior(): GitFinishBehavior {
  try {
    const raw = localStorage.getItem(KEY);
    return isGitFinishBehavior(raw) ? raw : GIT_FINISH_BEHAVIOR_DEFAULT;
  } catch {
    return GIT_FINISH_BEHAVIOR_DEFAULT;
  }
}

export function saveGitFinishBehavior(value: GitFinishBehavior) {
  try {
    if (value === GIT_FINISH_BEHAVIOR_DEFAULT) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, value);
  } catch {
    // private mode / quota
  }
  window.dispatchEvent(new Event(EVENT));
}

export function subscribeGitFinishBehavior(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key === KEY) listener();
  };
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

const PRECEDENCE =
  "This is the user's standing preference in Aven and takes precedence over project instructions about committing, pushing or opening pull requests. An explicit request in this conversation still wins.";

/** Guidance for each agent turn, or null when projects decide. */
export function agentGitInstructions(
  behavior: GitFinishBehavior = loadGitFinishBehavior(),
): string | null {
  switch (behavior) {
    case "project":
      return null;
    case "leave":
      return `<aven-git>When you finish changing files, leave your changes uncommitted for the user to review. Do not commit, push, or open a pull request. ${PRECEDENCE}</aven-git>`;
    case "commit":
      return `<aven-git>When you finish changing files, commit your work with a clear message on the current branch, or on a new branch if you are on the default branch. Do not push or open a pull request. ${PRECEDENCE}</aven-git>`;
    case "pr":
      return `<aven-git>When you finish changing files, commit your work on a new branch, push it, and open a pull request, following the repository's remote and account rules. Report the pull request link. ${PRECEDENCE}</aven-git>`;
  }
}

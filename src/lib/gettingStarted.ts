/**
 * Home's "Getting started" card: five first steps that tick themselves from
 * what really happened. Only a fresh install that began the walkthrough is
 * offered it; hiding it, or finishing all five, removes it for good.
 */
export const GETTING_STARTED_STEPS = [
  "agent",
  "project",
  "message",
  "preview",
  "ship",
] as const;
export type GettingStartedStepId = (typeof GETTING_STARTED_STEPS)[number];

/** What the workspace can see right now, one flag per step. */
export type GettingStartedSignals = Record<GettingStartedStepId, boolean>;

export type GettingStartedState = {
  /** Offered when this install began the walkthrough. */
  offered: boolean;
  /** Hidden with ×: gone for good. */
  hidden: boolean;
  /** All five done and the card showed it: gone for good. */
  completed: boolean;
  /**
   * Steps seen done once. A step stays ticked after its signal goes, such as
   * a preview tab that was closed again.
   */
  ticked: GettingStartedStepId[];
};

export const GETTING_STARTED_KEY = "aven.gettingStarted.v1";
const GETTING_STARTED_CHANGED = "aven:getting-started-changed";

function isStep(value: unknown): value is GettingStartedStepId {
  return (
    typeof value === "string" &&
    (GETTING_STARTED_STEPS as readonly string[]).includes(value)
  );
}

function normalize(value: unknown): GettingStartedState {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const ticked = Array.isArray(record.ticked)
    ? record.ticked.filter(isStep)
    : [];
  return {
    offered: record.offered === true,
    hidden: record.hidden === true,
    completed: record.completed === true,
    ticked: GETTING_STARTED_STEPS.filter((step) => ticked.includes(step)),
  };
}

/** The saved state from its stored text; anything unreadable is a fresh one. */
export function parseGettingStarted(saved: string | null): GettingStartedState {
  try {
    return normalize(saved ? JSON.parse(saved) : null);
  } catch {
    return normalize(null);
  }
}

export function loadGettingStarted(): GettingStartedState {
  try {
    return parseGettingStarted(localStorage.getItem(GETTING_STARTED_KEY));
  } catch {
    return normalize(null);
  }
}

export function saveGettingStarted(state: GettingStartedState): boolean {
  try {
    localStorage.setItem(GETTING_STARTED_KEY, JSON.stringify(normalize(state)));
  } catch {
    return false;
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(GETTING_STARTED_CHANGED));
  }
  return true;
}

export function subscribeGettingStarted(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === GETTING_STARTED_KEY || event.key === null) listener();
  };
  window.addEventListener(GETTING_STARTED_CHANGED, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(GETTING_STARTED_CHANGED, listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** The walkthrough began on this install: Home will offer the card. */
export function offerGettingStarted(): void {
  const state = loadGettingStarted();
  if (state.offered) return;
  saveGettingStarted({ ...state, offered: true });
}

export function hideGettingStarted(): void {
  saveGettingStarted({ ...loadGettingStarted(), hidden: true });
}

/** Should Home show the card? Never for an install that wasn't offered it. */
export function shouldShowGettingStarted(state: GettingStartedState): boolean {
  return state.offered && !state.hidden && !state.completed;
}

export type GettingStartedProgress = {
  steps: { id: GettingStartedStepId; done: boolean }[];
  doneCount: number;
  /** The first step not done yet; it gets the Start button. */
  next: GettingStartedStepId | null;
  allDone: boolean;
};

export function gettingStartedProgress(
  signals: GettingStartedSignals,
  ticked: readonly GettingStartedStepId[],
): GettingStartedProgress {
  const steps = GETTING_STARTED_STEPS.map((id) => ({
    id,
    done: signals[id] || ticked.includes(id),
  }));
  const doneCount = steps.filter((step) => step.done).length;
  return {
    steps,
    doneCount,
    next: steps.find((step) => !step.done)?.id ?? null,
    allDone: doneCount === steps.length,
  };
}

/**
 * Keep each step that is done now ticked for good. Returns `state` itself
 * when nothing changed, so callers can skip the save. Completion waits for
 * the card to show its done state (see `completeGettingStarted`).
 */
export function recordGettingStarted(
  state: GettingStartedState,
  signals: GettingStartedSignals,
): GettingStartedState {
  const ticked = gettingStartedProgress(signals, state.ticked)
    .steps.filter((step) => step.done)
    .map((step) => step.id);
  if (ticked.length === state.ticked.length) return state;
  return { ...state, ticked };
}

/** All five were done and the card said so: it goes for good. */
export function completeGettingStarted(): void {
  saveGettingStarted({ ...loadGettingStarted(), completed: true });
}

export const GETTING_STARTED_TITLE: Record<GettingStartedStepId, string> = {
  agent: "Connect an agent",
  project: "Add a project",
  message: "Send your first message",
  preview: "Preview it",
  ship: "Ship it",
};

/** What Home shows: plain data, so Home re-renders only when it changes. */
export type GettingStartedCard = {
  steps: {
    id: GettingStartedStepId;
    title: string;
    detail: string;
    done: boolean;
  }[];
  next: GettingStartedStepId | null;
  doneCount: number;
  allDone: boolean;
};

export function gettingStartedCard(
  progress: GettingStartedProgress,
  details: Record<GettingStartedStepId, string>,
): GettingStartedCard {
  return {
    steps: progress.steps.map((step) => ({
      ...step,
      title: GETTING_STARTED_TITLE[step.id],
      detail: details[step.id],
    })),
    next: progress.next,
    doneCount: progress.doneCount,
    allDone: progress.allDone,
  };
}

/** The little of a chat the "first message" step reads. */
export type FirstMessageChat = {
  cwd: string;
  inboxAsk?: unknown;
  orchestrationLeadId?: string;
  blocks: readonly {
    role: string;
    internal?: boolean;
    discussion?: unknown;
  }[];
};

/**
 * Has a chat in a project got a message from you? A live chat counts once
 * it has a user turn you typed (not one Aven relayed or wrote); a saved one
 * counts by being saved at all, since only chats with a user turn are.
 * Chats with no project, and Inbox questions, don't count.
 */
export function hasFirstMessage(
  sessions: readonly FirstMessageChat[],
  saved: readonly { cwd: string }[],
  isProject: (cwd: string) => boolean,
): boolean {
  return (
    saved.some((row) => isProject(row.cwd)) ||
    sessions.some(
      (session) =>
        !session.inboxAsk &&
        !session.orchestrationLeadId &&
        isProject(session.cwd) &&
        session.blocks.some(
          (block) =>
            block.role === "user" && !block.internal && !block.discussion,
        ),
    )
  );
}

/** Has a real page been opened in the browser? A new empty tab doesn't count. */
export function hasOpenedPage(
  browsers: Readonly<Record<string, { tabs: readonly { url: string }[] }>>,
): boolean {
  return Object.values(browsers).some((workspace) =>
    workspace.tabs.some((tab) => !!tab.url && tab.url !== "about:blank"),
  );
}

/** Has anything gone out through Ship it? Each ship is recorded per chat. */
export function hasShipped(
  shipped: Readonly<Record<string, unknown>>,
): boolean {
  return Object.keys(shipped).length > 0;
}

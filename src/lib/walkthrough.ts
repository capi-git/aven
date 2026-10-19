import { shouldOfferProviderSetup } from "./providerSetup";

/**
 * The first-run walkthrough: Welcome, Agents (provider setup), Project and a
 * short tour over the real app. Only a fresh install begins it, under the
 * same rule that offered provider setup before it; once finished or skipped
 * it never opens by itself again.
 */
export const WALKTHROUGH_STEPS = [
  "welcome",
  "agents",
  "project",
  "tour",
] as const;
export type WalkthroughStep = (typeof WALKTHROUGH_STEPS)[number];

export const WALKTHROUGH_STEP_LABEL: Record<WalkthroughStep, string> = {
  welcome: "Welcome",
  agents: "Agents",
  project: "Project",
  tour: "Tour",
};

export type WalkthroughState = {
  /** Begun on this install. Only a fresh install ever begins it. */
  started: boolean;
  /** Finished or skipped: it never opens by itself again. */
  ended: boolean;
  /** Where it is, so quitting part way resumes there. */
  step: WalkthroughStep;
  /** Steps finished, ticked in the step strip. */
  done: WalkthroughStep[];
};

export const WALKTHROUGH_KEY = "aven.walkthrough.v1";
const WALKTHROUGH_CHANGED = "aven:walkthrough-changed";

const INITIAL: WalkthroughState = {
  started: false,
  ended: false,
  step: "welcome",
  done: [],
};

function isStep(value: unknown): value is WalkthroughStep {
  return (
    typeof value === "string" &&
    (WALKTHROUGH_STEPS as readonly string[]).includes(value)
  );
}

function normalize(value: unknown): WalkthroughState {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const done = Array.isArray(record.done) ? record.done.filter(isStep) : [];
  return {
    started: record.started === true,
    ended: record.ended === true,
    step: isStep(record.step) ? record.step : "welcome",
    // In step order, once each.
    done: WALKTHROUGH_STEPS.filter((step) => done.includes(step)),
  };
}

export function loadWalkthrough(): WalkthroughState {
  try {
    const saved = localStorage.getItem(WALKTHROUGH_KEY);
    return normalize(saved ? JSON.parse(saved) : null);
  } catch {
    return { ...INITIAL };
  }
}

export function saveWalkthrough(state: WalkthroughState): boolean {
  try {
    localStorage.setItem(WALKTHROUGH_KEY, JSON.stringify(normalize(state)));
  } catch {
    return false;
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(WALKTHROUGH_CHANGED));
  }
  return true;
}

/**
 * Open at launch? A walkthrough begun on this install resumes until it ends.
 * Otherwise only a fresh install sees it: no existing work and provider setup
 * never finished, exactly the rule that offered provider setup before. An
 * existing user who updates, and the automated checks (which start from a
 * finished setup), never see it.
 */
export function shouldOfferWalkthrough(hasExistingWork: boolean): boolean {
  const state = loadWalkthrough();
  if (state.ended) return false;
  return state.started || shouldOfferProviderSetup(hasExistingWork);
}

export function subscribeWalkthrough(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === WALKTHROUGH_KEY || event.key === null) listener();
  };
  window.addEventListener(WALKTHROUGH_CHANGED, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(WALKTHROUGH_CHANGED, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export type WalkthroughAction =
  | { type: "start" }
  /** The current step is done; on to the next, or the end after the tour. */
  | { type: "next" }
  | { type: "back" }
  /** Leave the current step unfinished and go on (the Project step's Skip). */
  | { type: "skipStep" }
  /** Skip setup: the walkthrough ends for good. */
  | { type: "skip" }
  | { type: "finish" };

function stepAfter(step: WalkthroughStep): WalkthroughStep | null {
  return WALKTHROUGH_STEPS[WALKTHROUGH_STEPS.indexOf(step) + 1] ?? null;
}

function stepBefore(step: WalkthroughStep): WalkthroughStep | null {
  return WALKTHROUGH_STEPS[WALKTHROUGH_STEPS.indexOf(step) - 1] ?? null;
}

function withDone(
  done: readonly WalkthroughStep[],
  step: WalkthroughStep,
): WalkthroughStep[] {
  return WALKTHROUGH_STEPS.filter(
    (each) => each === step || done.includes(each),
  );
}

/** Pure: the walkthrough after `action`. An ended one stays ended. */
export function walkthroughReducer(
  state: WalkthroughState,
  action: WalkthroughAction,
): WalkthroughState {
  if (state.ended) return state;
  switch (action.type) {
    case "start":
      return state.started ? state : { ...state, started: true };
    case "next": {
      const done = withDone(state.done, state.step);
      const next = stepAfter(state.step);
      return next
        ? { ...state, started: true, step: next, done }
        : { ...state, started: true, ended: true, done };
    }
    case "back": {
      const previous = stepBefore(state.step);
      return previous ? { ...state, step: previous } : state;
    }
    case "skipStep": {
      const next = stepAfter(state.step);
      return next
        ? { ...state, started: true, step: next }
        : { ...state, started: true, ended: true };
    }
    case "skip":
      return { ...state, started: true, ended: true };
    case "finish":
      return {
        ...state,
        started: true,
        ended: true,
        done: withDone(state.done, state.step),
      };
  }
}

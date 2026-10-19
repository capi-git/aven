import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { basename } from "../lib/fs";
import {
  GETTING_STARTED_KEY,
  gettingStartedCard,
  gettingStartedProgress,
  hasFirstMessage,
  hasOpenedPage,
  hasShipped,
  hideGettingStarted,
  parseGettingStarted,
  recordGettingStarted,
  saveGettingStarted,
  shouldShowGettingStarted,
  subscribeGettingStarted,
  type FirstMessageChat,
  type GettingStartedCard,
  type GettingStartedSignals,
} from "../lib/gettingStarted";
import {
  isHarnessAvailable,
  subscribeHarnessAvailability,
} from "../lib/harness/availability";
import { isProjectlessCwd } from "../lib/projectlessWorkspace";
import { looksLikeProject } from "../lib/recents";
import { isSampleProject, SAMPLE_FIRST_MESSAGE } from "../lib/sampleProject";
import { HARNESSES, HARNESS_TITLE, type HarnessId } from "../lib/session";

function savedState(): string {
  try {
    return localStorage.getItem(GETTING_STARTED_KEY) ?? "";
  } catch {
    return "";
  }
}

/** The first agent app found, or "" for none; a stable snapshot. */
function firstAvailableAgent(): HarnessId | "" {
  return HARNESSES.find(isHarnessAvailable) ?? "";
}

const ALL_DONE: GettingStartedSignals = {
  agent: true,
  project: true,
  message: true,
  preview: true,
  ship: true,
};

function isProject(cwd: string): boolean {
  return looksLikeProject(cwd) && !isProjectlessCwd(cwd);
}

export type GettingStartedInput = {
  /** False while the walkthrough is open: the card waits for it to end. */
  ready: boolean;
  sessions: readonly FirstMessageChat[];
  /** Saved chats; only chats with a message of yours are saved. */
  history: readonly { cwd: string }[];
  browsers: Readonly<Record<string, { tabs: readonly { url: string }[] }>>;
  /** Ship it's per-chat records. */
  shipped: Readonly<Record<string, unknown>>;
  /** The workspace's projects, in sidebar order. */
  projects: readonly { path: string }[];
};

export type GettingStarted = {
  /** What Home shows, or null when the card is not offered or gone. */
  card: GettingStartedCard | null;
  /** The project the steps work in: the sample if added, else the first. */
  target: string | null;
  hide: () => void;
};

/**
 * Home's Getting started card. It ticks each step from what really
 * happened and keeps ticks for good; once all five are done it shows its
 * done state until hidden, then never again. Nothing is read while the card
 * isn't offered, so existing installs pay nothing for it.
 */
export function useGettingStarted({
  ready,
  sessions,
  history,
  browsers,
  shipped,
  projects,
}: GettingStartedInput): GettingStarted {
  const raw = useSyncExternalStore(
    subscribeGettingStarted,
    savedState,
    () => "",
  );
  const state = useMemo(() => parseGettingStarted(raw), [raw]);
  const active = shouldShowGettingStarted(state);
  // Shown after all five were done, until hidden; this session only.
  const [celebrating, setCelebrating] = useState(false);
  const agent = useSyncExternalStore(
    subscribeHarnessAvailability,
    firstAvailableAgent,
    () => "" as const,
  );
  const target =
    projects.find((project) => isSampleProject(project.path))?.path ??
    projects[0]?.path ??
    null;

  const messageTicked = state.ticked.includes("message");
  const message = useMemo(
    () =>
      active && !messageTicked && hasFirstMessage(sessions, history, isProject),
    [active, messageTicked, sessions, history],
  );
  const agentReady = agent !== "";
  const projectAdded = projects.length > 0;
  const previewed = active && hasOpenedPage(browsers);
  const shippedOnce = active && hasShipped(shipped);
  const signals: GettingStartedSignals | null = useMemo(
    () =>
      active
        ? {
            agent: agentReady,
            project: projectAdded,
            message,
            preview: previewed,
            ship: shippedOnce,
          }
        : null,
    [active, agentReady, projectAdded, message, previewed, shippedOnce],
  );

  // Keep what was done ticked for good; finishing all five completes it.
  useEffect(() => {
    if (!signals) return;
    const next = recordGettingStarted(state, signals);
    if (gettingStartedProgress(signals, next.ticked).allDone) {
      saveGettingStarted({ ...next, completed: true });
      setCelebrating(true);
    } else if (next !== state) saveGettingStarted(next);
  }, [state, signals]);

  const hide = useCallback(() => {
    setCelebrating(false);
    hideGettingStarted();
  }, []);

  const details = {
    agent: agent
      ? `${HARNESS_TITLE[agent]} is ready`
      : "Install an agent app and sign in",
    project: target ? basename(target) : "A folder your agents work in",
    message:
      target && isSampleProject(target)
        ? `Try “${SAMPLE_FIRST_MESSAGE}”`
        : "Ask your agent for a small change",
    preview: "Ask the agent to open a preview beside the chat",
    ship: "Review the change and commit it",
  };
  let card: GettingStartedCard | null = null;
  if (celebrating)
    card = gettingStartedCard(gettingStartedProgress(ALL_DONE, []), details);
  else if (ready && signals)
    card = gettingStartedCard(
      gettingStartedProgress(signals, state.ticked),
      details,
    );
  return { card, target, hide };
}

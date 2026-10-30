import { useEffect, useRef } from "react";
import {
  devSmokeConfig,
  finishDevSmoke,
  SMOKE_OVERLAY_EVENT,
  SMOKE_OVERLAY_RESULT_EVENT,
  SMOKE_ECHO_NOTE_WORD,
  SMOKE_HEARD_WORD,
  SMOKE_JUMP_IN_WORD,
  SMOKE_KEEPER_WORD,
  SMOKE_ORCHESTRATE_WORD,
  SMOKE_REPLY,
  SMOKE_STALL_WORD,
  SMOKE_SUMMARY_WORD,
  SMOKE_WINNER_WORD,
  SMOKE_WRAP_UP_WORD,
  waitFor,
  type DevSmokeConfig,
  type SmokeStep,
} from "../lib/devSmoke";
import {
  animationProblem,
  prefersReducedMotion,
  watchOneShot,
} from "../lib/devSmokeMotion";
import {
  launchRevealProblem,
  launchRevealSummary,
  readLaunchReveal,
} from "../lib/devSmokeReveal";
import { agentRole, roleBrief, type AgentRoleId } from "../lib/agentRoles";
import { errorText } from "../lib/errors";
import { deleteFeatureCard } from "../lib/featureCards";
import { getKeeperProject } from "../lib/memoryKeeper";
import { formatLineDiff } from "../lib/memoryKeeperFormat";
import { nativeFloatingSidebar } from "../lib/floatingSidebar";
import { resolveClaudeBinary } from "../lib/harness/child";
import { getPtyStatus } from "../lib/pty";
import { IS_MAC } from "../lib/platform";
import { applyUiScale, loadUiScale } from "../lib/uiScale";
import { composerLineBoxes, lineBoxProblem } from "../lib/composerLineBoxes";
import {
  helmDialogProblem,
  helmStopProblem,
  helmWorkingProblem,
  closeHelmDialog,
  helmStateWords,
  restoringComposer,
} from "../lib/devSmokeHelm";
import { runDevPerf, visibleComposer, type DevPerfOptions } from "./useDevPerf";
import { runDevIphoneCheck } from "../lib/devIphoneCheck";
import { checkLoneTabDrag, type SmokeLoneTab } from "../lib/devSmokeLoneTab";
import { checkPageDragCutOut } from "../lib/devSmokePageDrag";
import { checkCrew, type SmokeCrew } from "../lib/devSmokeCrew";
import { checkDividerRail } from "../lib/devSmokeRail";
import {
  agentOpensProblem,
  agentOpensSummary,
  agentOpensTooSlow,
  readAgentOpens,
} from "../lib/devSmokePages";
import { sameProjectPath } from "../lib/recents";
import type { DiscussionHost } from "../lib/discussions";
import { providerShortName } from "../lib/discussionVoices";
import { pickerModelsFor } from "../lib/models";
import type { RaceRecord } from "../lib/race";
import type { RaceLaneChoice } from "../lib/raceAgents";
import { raceLaneName } from "../lib/raceLanes";
import { raceAgentNames } from "../lib/raceNames";
import { teamWorkspace } from "../lib/teamWorkspace";
import { possessive } from "../lib/words";
import { HARNESS_TITLE, type HarnessId, type Session } from "../lib/session";
import { getActivitySnapshot, type ActivityEntry } from "../lib/activity";
import { isInFlightSession } from "../lib/inFlight";
import type { OrchestrationRun } from "../lib/orchestration";
import { leadDecidedIds } from "../lib/teamAttention";
import {
  homeLiveSessions,
  homeNeedsYou,
  homeScope,
  isWaitingAttention,
} from "../lib/workspaceHome";

type Options = DevPerfOptions & {
  sessions: Session[];
  /** The macOS floating sidebar's overlay, once attached. */
  floatingSidebarLabel: string | null;
  /** Whether this platform attaches the floating sidebar at all. */
  expectFloatingSidebar: boolean;
  /** The sidebar's "New chat in <project>". */
  newProjectTask: (path: string) => void;
  submit: (sessionId: string, text: string) => void;
  /** Stop a chat's turn, as its message box's Stop does. */
  stop?: (sessionId: string) => void;
  /** The workspace's own utility views, opened as their buttons would. */
  utilities?: SmokeUtilities;
  /** What the checks of things that move open and close. */
  motion?: SmokeMotion;
  /** Remembered projects, for checking that a deleted one is gone. */
  projects?: readonly { path: string }[];
  /** The current project's terminal panel. */
  projectPanel?: {
    toggle: () => void;
    terminalIds: (projectPath: string) => string[];
  };
  /**
   * Delete a project and its chats, as the sidebar's Delete does; resolves
   * with why it could not.
   */
  deleteProject?: (projectPath: string) => Promise<string | null | void>;
  /** Open the restart question's preview, as its palette command does. */
  previewRestartQuestion?: () => boolean;
  /** Starts discussions between chats; the check drives the composer's Discuss mode. */
  discussion?: DiscussionHost;
  /** Reads a project's memory, as its editor does. */
  projectMemory?: (path: string) => Promise<string>;
  /** Chats show second dev servers and receive the shared-work note. */
  sharedWork?: boolean;
  /** Panes are drawn as cards with one bar each and the shared tab style. */
  paneLayout?: boolean;
  /** Open a file beside the current chat, as a file link does. */
  openFile?: (path: string) => void;
  /** The orchestrator's runs, as the check drives one from a chat. */
  orchestration?: {
    run: (leadId: string) => OrchestrationRun | undefined;
    submissionError: (sessionId: string) => string | null;
  };
  /** Races a message from the message box; the check keeps a lane mid-run. */
  race?: SmokeRace;
  /** The title bar opens the project's board, which the check watches. */
  board?: boolean;
  /** Crews: the check turns one on in its project and has it build a card. */
  crew?: SmokeCrew;
  /** Moves tabs between panes and the strip, for the lone tab's header. */
  loneTab?: SmokeLoneTab;
  /** A project's browser pages, with the chat whose agent builds on each. */
  agentPages?: (
    project: string,
  ) => readonly { id: string; url: string; agentChat?: string }[];
};

/** What the race check reads and sets outside the page. */
export type SmokeRace = {
  races: () => readonly RaceRecord[];
  listDir: (path: string) => Promise<{ name: string }[]>;
  readFile: (path: string) => Promise<string>;
  /** Grok Build, which must be the stand-in before anything is sent. */
  resolveGrok: () => Promise<{ path: string }>;
  /** Looks for installed providers again, so the stand-in Grok counts. */
  probe: () => Promise<void>;
  /** The lanes the next race adds, as the Race chip saves them. */
  chooseAgents: (lanes: RaceLaneChoice[]) => void;
};

type SmokeUtilities = {
  openSearch: () => void;
  openInbox: () => void;
  openAutomations: () => void;
  openNotes: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  leaveNotes: () => void;
};

type SmokeMotion = {
  /** Home, as the toolbar's Home button opens it. */
  openHome: () => void;
  /** The Changes panel, as the menu's Source Control opens it. */
  showChanges: () => void;
  /** Close the panel on the right. */
  hideChanges: () => void;
  /** Leave Home and any utility view for the workspace. */
  showWorkspace?: () => void;
};

/** The line the discussion's second chat, a Skeptic, is first sent. */
const SKEPTIC_BRIEF = roleBrief("skeptic", "in this discussion");

/** How long the stand-in holds a turn open while the checks watch it. */
const HOLD_MS = 4_000;
/**
 * A discussion's first two turns carry the topic, so the stand-in holds each
 * this long; the check watches the running discussion during the second.
 */
const DISCUSSION_HOLD_MS = 8_000;
const DISCUSSION_ROUNDS = 2;
/** The Discuss dropdown's row for a new chat, and the providers it lists. */
const NEW_CHAT_LABEL = "New chat with…";
const NEW_CHAT_MENU = "Choose the model for the new chat";
/** What the check adds to the discussion from its panel. */
const JUMP_IN_TEXT = `Keep it short. ${SMOKE_JUMP_IN_WORD}`;
/** The stand-in plays the cheapest model; its first call starts a process. */
const WRAP_UP_WAIT_MS = 60_000;
/**
 * The race's task. Each stand-in writes a file into its lane's copy at once,
 * then another every half second while the turn holds; the stand-in Grok
 * fails its first try in each copy.
 */
const RACE_TEXT =
  "Build the change. AVEN_SMOKE_RACE AVEN_SMOKE_FAIL_ONCE AVEN_SMOKE_HOLD 20000";
/** Ports the stand-in pretends two chats' dev servers announce; nothing listens. */
const FIRST_SERVER_PORT = 5199;
const SECOND_SERVER_PORT = 5200;

/** Each utility view's root carries `data-app-<name>`. */
const UTILITY_VIEWS = [
  "search",
  "inbox",
  "automations",
  "notes",
  "settings",
] as const;
type UtilityView = (typeof UTILITY_VIEWS)[number];

function utilitiesOnScreen(): UtilityView[] {
  return UTILITY_VIEWS.filter((view) =>
    document.querySelector(`[data-app-${view}]`),
  );
}

function workspaceOnScreen(): boolean {
  const content = document.querySelector(".personal-workspace-content");
  return content instanceof HTMLElement && !content.hidden;
}

function pressShortcut(key: string) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      metaKey: IS_MAC,
      ctrlKey: !IS_MAC,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function replyCount(sessions: Session[], id: string): number {
  return (sessions.find((session) => session.id === id)?.blocks ?? []).filter(
    (block) => block.role === "assistant" && block.text.includes(SMOKE_REPLY),
  ).length;
}

/**
 * Stop a chat's turn if it is still running, as its Stop does, and wait
 * (briefly) for it to end, so a step that gave up on it leaves the project
 * free for the next.
 */
async function stopTurn(get: () => Options, sessionId: string) {
  const busy = () =>
    get().sessions.find((session) => session.id === sessionId)?.busy === true;
  if (!busy()) return;
  get().stop?.(sessionId);
  await waitFor(() => !busy(), 10_000, "the stopped turn to end").catch(
    () => {},
  );
}

/**
 * The project's other chats still working, which keep a lead's run from
 * starting ("Stop the other chats working in this project first").
 */
export function otherChatsWorking(
  sessions: readonly Session[],
  leadId: string,
): string[] {
  const lead = sessions.find((session) => session.id === leadId);
  if (!lead) return [];
  return sessions
    .filter(
      (session) =>
        session.id !== leadId &&
        session.busy &&
        sameProjectPath(session.worktreeCwd ?? session.cwd, lead.cwd),
    )
    .map((session) => `“${session.title || session.id}”`);
}

/** The project's row in this window's (pinned) sidebar, when on screen. */
function sidebarProjectRow(path: string): HTMLElement | null {
  return (
    [
      ...document.querySelectorAll<HTMLElement>(
        ".personal-project-row[data-project-path]",
      ),
    ].find(
      (row) =>
        sameProjectPath(row.dataset.projectPath ?? "", path) &&
        row.getClientRects().length > 0,
    ) ?? null
  );
}

function homeOnScreen(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".workspace-home");
}

function homeAgentTile(path: string): HTMLElement | null {
  return (
    [
      ...document.querySelectorAll<HTMLElement>(
        ".workspace-home-agent[data-project-path]",
      ),
    ].find((tile) => sameProjectPath(tile.dataset.projectPath ?? "", path)) ??
    null
  );
}

/**
 * Why a project mark is not stepping as a working agent's should, or null:
 * in its working state, with its two-frame hop running unless reduced motion
 * stops it.
 */
function workingMarkProblem(
  mark: Element | null,
  hop = "project-mark-hop",
): string | null {
  if (!mark) return "is missing";
  if (mark.getAttribute("data-kind") !== "mascot") return "is not a mascot";
  if (!mark.hasAttribute("data-active")) return "is not in its working state";
  const sprite = mark.querySelector("svg.mascot-active");
  if (!sprite) return "has no working sprite";
  return animationProblem(
    getComputedStyle(sprite).animationName,
    hop,
    prefersReducedMotion(),
  );
}

/**
 * Send a turn the stand-in holds open for `HOLD_MS`, wait until the chat is
 * working, and return a wait for its reply.
 */
async function startHeldTurn(
  get: () => Options,
  id: string,
  text: string,
): Promise<() => Promise<unknown>> {
  const before = replyCount(get().sessions, id);
  get().submit(id, `${text} AVEN_SMOKE_HOLD ${HOLD_MS}`);
  await waitFor(
    () => get().sessions.find((session) => session.id === id)?.busy,
    10_000,
    "the held turn to start",
  );
  return () =>
    waitFor(
      () =>
        !get().sessions.find((session) => session.id === id)?.busy &&
        replyCount(get().sessions, id) > before,
      HOLD_MS + 30_000,
      "the held turn's reply",
    );
}

function sentTexts(sessions: Session[], id: string): string[] {
  return (sessions.find((session) => session.id === id)?.blocks ?? [])
    .filter((block) => block.role === "user")
    .map((block) => block.text);
}

/** Wait until only `view` is on screen, or only the workspace when null. */
async function expectOnScreen(view: UtilityView | null) {
  try {
    await waitFor(
      () => {
        const shown = utilitiesOnScreen();
        return view
          ? shown.length === 1 && shown[0] === view && !workspaceOnScreen()
          : shown.length === 0 && workspaceOnScreen();
      },
      5_000,
      view ? `only ${view} on screen` : "the workspace on screen",
    );
  } catch (error) {
    const shown = utilitiesOnScreen();
    throw new Error(
      `${errorText(error)}; showing ${
        [...shown, ...(workspaceOnScreen() ? ["workspace"] : [])].join(", ") ||
        "nothing"
      }`,
    );
  }
}

/** A new chat in `path`, as the sidebar's New chat opens one. */
async function openNewTask(get: () => Options, path: string): Promise<Session> {
  const before = new Set(get().sessions.map((session) => session.id));
  get().newProjectTask(path);
  return waitFor(
    () =>
      get().sessions.find(
        (session) =>
          !before.has(session.id) && sameProjectPath(session.cwd, path),
      ),
    5_000,
    "a new task",
  );
}

/** The discussion messages Aven relayed into a chat, as turn numbers. */
function relayedTurns(sessions: Session[], id: string): number[] {
  return (sessions.find((session) => session.id === id)?.blocks ?? []).flatMap(
    (block) =>
      block.role === "user" && block.discussion ? [block.discussion.turn] : [],
  );
}

function notesIn(sessions: Session[], id: string, text: string): number {
  return (sessions.find((session) => session.id === id)?.blocks ?? []).filter(
    (block) => block.role === "system" && block.text === text,
  ).length;
}

function sidebarDiscussionRow(sessionId: string): HTMLElement | null {
  return (
    [
      ...document.querySelectorAll<HTMLElement>(
        `.personal-navigation [data-discussion-row="${sessionId}"]`,
      ),
    ].find((row) => row.getClientRects().length > 0) ?? null
  );
}

/**
 * Why the sidebar does not show the two chats linked as talking, or null:
 * both rows marked, one connector spanning their centres, its pulse running
 * toward the chat that is answering (still with reduced motion).
 */
function linkProblem(id: string, a: string, b: string): string | null {
  const rowA = sidebarDiscussionRow(a);
  const rowB = sidebarDiscussionRow(b);
  if (!rowA || !rowB)
    return `the sidebar shows ${rowA || rowB ? "only one" : "neither"} of the two chats`;
  const link = document.querySelector<HTMLElement>(
    `[data-discussion-link="${id}"]`,
  );
  if (!link) return "no connector links the two rows";
  for (const row of [rowA, rowB])
    if (row.querySelector(".discussion-talk-badge"))
      return "a linked row still shows its talking-with badge";
  const centre = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    return rect.top + rect.height / 2;
  };
  const span = link.getBoundingClientRect();
  const [top, bottom] = [centre(rowA), centre(rowB)].sort((x, y) => x - y);
  if (Math.abs(span.top - top) > 2 || Math.abs(span.bottom - bottom) > 2)
    return `the connector spans ${Math.round(span.top)}–${Math.round(span.bottom)}, not the rows at ${Math.round(top)}–${Math.round(bottom)}`;
  // B is answering: the pulse travels toward its row.
  const toward = centre(rowB) > centre(rowA) ? "down" : "up";
  if (link.dataset.toward !== toward)
    return `the pulse travels ${link.dataset.toward ?? "nowhere"}, not ${toward} toward the answering chat`;
  const pulse = link.querySelector(".discussion-link-pulse");
  if (!pulse) return "the connector has no pulse";
  const moving = animationProblem(
    getComputedStyle(pulse).animationName,
    `discussion-link-${toward}`,
    prefersReducedMotion(),
  );
  return moving ? `the pulse ${moving}` : null;
}

/** The message box of a chat on screen. */
function chatComposer(sessionId: string): HTMLElement | null {
  return (
    visibleComposer()
      ?.closest(`[data-session-drop="${sessionId}"]`)
      ?.querySelector<HTMLElement>("[data-composer]") ?? null
  );
}

/**
 * Open the chat's modes the way a person does: press the critter on the
 * message box, then its dialog's Modes row (the + menu's old modes).
 * Returns the modes page.
 */
async function openComposerModes(sessionId: string): Promise<HTMLElement> {
  const critter = await waitFor(
    () =>
      chatComposer(sessionId)?.querySelector<HTMLButtonElement>(
        "[data-helm-critter]",
      ) ?? null,
    5_000,
    "the critter on the chat's message box",
  );
  if (!document.querySelector("[data-composer-plus]")) {
    critter.click();
    const next = await waitFor(
      () =>
        document.querySelector<HTMLElement>("[data-composer-plus]") ??
        document.querySelector<HTMLElement>('[data-helm-row="modes"]'),
      5_000,
      "the critter's dialog",
    );
    if (next.matches('[data-helm-row="modes"]')) next.click();
  }
  return waitFor(
    () => document.querySelector<HTMLElement>("[data-composer-plus]"),
    5_000,
    "the dialog's modes",
  );
}

/** Close the critter's dialog, if it is open, as a second press does. */
function closeComposerModes(sessionId: string) {
  if (document.querySelector("[data-helm-dialog], [data-composer-plus]"))
    chatComposer(sessionId)
      ?.querySelector<HTMLButtonElement>("[data-helm-critter]")
      ?.click();
}

/**
 * Why starting a discussion with a new chat did not fold it into one card in
 * the chat that started it, or null: the new chat in no tab or pane, the
 * topic as the user's message, then the live card, and none of the turns
 * it stands for drawn.
 */
function startProblem(a: string, b: string, id: string): string | null {
  if (document.querySelector(`[data-session-drop="${b}"]`))
    return "the new chat opened in a tab or pane";
  const pane = document.querySelector<HTMLElement>(
    `[data-session-drop="${a}"]`,
  );
  if (!pane) return "the first chat is not on screen";
  return cardProblem(pane, id, "live");
}

/** Why the discussion's card in a chat is not as expected, or null. */
function cardProblem(
  pane: HTMLElement,
  id: string,
  state: "live" | "done",
): string | null {
  const card = pane.querySelector<HTMLElement>(
    `[data-discussion-card="${id}"]`,
  );
  if (!card) return "the first chat has no card for the discussion";
  if (card.dataset.state !== state)
    return `the card is ${card.dataset.state ?? "unmarked"}, not ${state}`;
  if (card.querySelectorAll("[data-discussion-avatar]").length !== 2)
    return "the card does not show both mascots";
  const topic = [
    ...pane.querySelectorAll<HTMLElement>(".personal-user-message"),
  ].find((message) => message.textContent?.includes("Compare notes."));
  if (!follows(topic ?? null, card)) return "the card is not after the topic";
  if (pane.querySelector(".personal-transcript-response"))
    return "the turns the card stands for are drawn in the chat";
  const title = card.querySelector(".team-card-title")?.textContent;
  if (state === "live") {
    if (!title?.endsWith("are discussing"))
      return `the card reads "${title ?? ""}"`;
    if (!card.querySelector("[data-discussion-card-watch]"))
      return "the card has no Watch";
    // One Stop for the discussion: the bar's, in the message box.
    if (card.querySelector("[data-discussion-card-stop]"))
      return "the card has a Stop of its own";
    const stops = stopsIn(pane);
    if (stops.join() !== "discussion")
      return `the chat offers ${stops.length} Stops (${stops.join(", ") || "none"}), not the bar's one`;
  } else {
    if (title !== `Discussion finished · ${DISCUSSION_ROUNDS} rounds`)
      return `the finished card reads "${title ?? ""}"`;
    if (
      card.querySelector("[data-discussion-card-watch]")?.textContent !==
      "Watch"
    )
      return "the finished card has no Watch";
  }
  return null;
}

/**
 * The Stops a chat's pane offers for its work besides its message box's own
 * square: the team bar's (by its kind) and the run status's.
 */
function stopsIn(pane: Element): string[] {
  return [
    ...[...pane.querySelectorAll<HTMLElement>("[data-team-stop]")].map(
      (button) => button.dataset.teamStop ?? "team",
    ),
    ...[...pane.querySelectorAll(".session-run-stop")]
      .filter((button) => button.textContent?.includes("Stop"))
      .map(() => "run status"),
  ];
}

/** The discussion's floating panel, when it is on screen. */
function discussionPanel(id?: string): HTMLElement | null {
  return (
    [
      ...document.querySelectorAll<HTMLElement>(
        id ? `[data-discussion-panel="${id}"]` : "[data-discussion-panel]",
      ),
    ].find((panel) => panel.getClientRects().length > 0) ?? null
  );
}

/** The pill a shrunk discussion becomes, when it is on screen. */
function discussionPill(id: string): HTMLElement | null {
  return (
    [
      ...document.querySelectorAll<HTMLElement>(
        `[data-discussion-pill="${id}"]`,
      ),
    ].find((pill) => pill.getClientRects().length > 0) ?? null
  );
}

/** Type into the panel's own message box and press Enter. */
function jumpIn(id: string, text: string) {
  const field = discussionPanel(id)?.querySelector<HTMLTextAreaElement>(
    "[data-discussion-jump] textarea",
  );
  if (!field) throw new Error("The discussion's panel has no message box");
  if (field.placeholder !== "Add something for both of them…")
    throw new Error(`The panel's message box reads "${field.placeholder}"`);
  typeInComposer(field, text);
  field.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );
}

/**
 * Why the first chat does not end with where they landed after the card,
 * or null: the finished card, then the wrap-up with both lists, a build
 * button for each chat and a link to the panel.
 */
function transcriptWrapUpProblem(a: string, id: string): string | null {
  const pane = document.querySelector<HTMLElement>(
    `[data-session-drop="${a}"]`,
  );
  if (!pane) return "the first chat is not on screen";
  const card = cardProblem(pane, id, "done");
  if (card) return card;
  const holder = pane.querySelector<HTMLElement>(
    `[data-discussion-wrapup-note="${id}"]`,
  );
  if (!holder) return "the first chat has no wrap-up after its card";
  if (!follows(pane.querySelector(`[data-discussion-card="${id}"]`), holder))
    return "the wrap-up is not after the card";
  const wrapUp = holder.querySelector<HTMLElement>("[data-discussion-wrapup]");
  if (wrapUp?.dataset.discussionWrapup !== "done")
    return `the first chat's wrap-up is ${wrapUp?.dataset.discussionWrapup ?? "missing"}, without its lists`;
  const agreed = [
    ...wrapUp.querySelectorAll('[data-discussion-list="agreed"] li'),
  ].map((item) => item.textContent ?? "");
  if (!agreed.includes(SMOKE_WRAP_UP_WORD))
    return `the first chat's Agreed lists ${agreed.join(" | ") || "nothing"}`;
  if (wrapUp.querySelectorAll("[data-discussion-build]").length !== 2)
    return "the first chat's wrap-up has no build buttons";
  if (!wrapUp.querySelector("[data-discussion-wrapup-open]"))
    return "the first chat's wrap-up has no Watch";
  return null;
}

/** Type into a message box the way a paste reaches React. */
function typeInComposer(field: HTMLTextAreaElement, text: string) {
  field.focus();
  Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set?.call(field, text);
  field.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
}

/**
 * Start a discussion the way a person does: the chat's + menu turns on
 * Discuss, the chip's dropdown picks the partner (another chat, or a new
 * chat with a provider from New chat with…) and rounds, and sending the
 * message starts it with the message as the topic.
 */
async function startDiscussionFromComposer(
  sessionId: string,
  partner: { chat: string } | { newWith: HarnessId },
  topic: string,
  rounds: number,
  role?: AgentRoleId,
) {
  // Everything is looked up again after each press: the box re-renders.
  const inBox = <T extends Element>(selector: string) =>
    chatComposer(sessionId)?.querySelector<T>(selector) ?? null;
  const inMenu = <T extends Element>(selector: string) =>
    document
      .querySelector("[data-discussion-menu]")
      ?.querySelector<T>(selector) ?? null;
  const menu = await openComposerModes(sessionId);
  const item = menu.querySelector<HTMLElement>("[data-composer-discuss]");
  if (!item?.textContent?.includes("Discuss")) {
    closeComposerModes(sessionId);
    throw new Error("The critter's modes do not offer Discuss");
  }
  item.click();
  const toggle = () =>
    inBox<HTMLElement>("[data-discussion-chip] [aria-haspopup]");
  // The chip's full words; a narrow message box shows them shortened.
  const chipText = () =>
    inBox<HTMLElement>("[data-discussion-chip]")?.dataset.fullLabel;
  (await waitFor(toggle, 5_000, "the Discuss chip in the message box")).click();
  await waitFor(
    () => document.querySelector("[data-discussion-menu]"),
    5_000,
    "the Discuss chip's dropdown",
  );
  if ("chat" in partner) {
    const row = inMenu<HTMLButtonElement>(
      `[data-discussion-candidate="${partner.chat}"]`,
    );
    if (!row)
      throw new Error("The Discuss dropdown does not list the other chat");
    if (row.disabled)
      throw new Error(`The other chat can't join: ${row.title}`);
    row.click();
  } else {
    const newChat = inMenu<HTMLButtonElement>(
      `button[aria-label="${NEW_CHAT_LABEL}"]`,
    );
    if (!newChat)
      throw new Error("The Discuss dropdown does not offer New chat with…");
    if (newChat.disabled)
      throw new Error(`New chat with… is off: ${newChat.title}`);
    newChat.click();
    const providers = await waitFor(
      () =>
        document.querySelector<HTMLElement>(
          `[role="menu"][aria-label="${NEW_CHAT_MENU}"]`,
        ),
      5_000,
      "New chat with…'s providers",
    );
    const title = HARNESS_TITLE[partner.newWith];
    const provider = [
      ...providers.querySelectorAll<HTMLButtonElement>(
        "button[data-provider-index]",
      ),
    ].find((row) => row.textContent?.trim() === title);
    if (!provider || provider.disabled)
      throw new Error(`New chat with… does not offer ${title}`);
    provider.click();
    const picked = `Discuss with new ${providerShortName(partner.newWith)} chat`;
    await waitFor(
      () =>
        !document.querySelector(
          `[role="menu"][aria-label="${NEW_CHAT_MENU}"]`,
        ) && chipText()?.includes(picked),
      5_000,
      `the chip to read "${picked}"`,
    );
  }
  const count = inMenu<HTMLElement>(`[data-discussion-rounds="${rounds}"]`);
  if (!count)
    throw new Error(`The Discuss dropdown offers no ${rounds} rounds`);
  count.click();
  await waitFor(
    () => chipText()?.includes(`${rounds} rounds`),
    5_000,
    `the chip to read ${rounds} rounds`,
  );
  if (role) {
    const choice = inMenu<HTMLButtonElement>(
      `[data-role-picker] [data-role-choice="${role}"]`,
    );
    if (!choice)
      throw new Error(`The Discuss dropdown offers no ${agentRole(role).name}`);
    choice.click();
    const as = `as ${agentRole(role).name}`;
    await waitFor(
      () => chipText()?.includes(as),
      5_000,
      `the chip to read "${as}"`,
    );
  }
  toggle()?.click();
  await waitFor(
    () => !document.querySelector("[data-discussion-menu]"),
    5_000,
    "the dropdown to close",
  );
  const field = inBox<HTMLTextAreaElement>("textarea");
  if (!field) throw new Error("The message box has no text field");
  typeInComposer(field, topic);
  field.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );
}

/** The first element matching a selector that is drawn on screen. */
function firstOnScreen<T extends Element>(selector: string): T | null {
  return (
    [...document.querySelectorAll<T>(selector)].find(
      (element) => element.getClientRects().length > 0,
    ) ?? null
  );
}

/**
 * Turn on Race from a chat's + menu and send the message, the way a person
 * does: the chip names the lanes and its dropdown lists them. Nothing is
 * sent unless the lanes' providers are exactly `providers`, in order, each
 * named apart. Returns the lanes' labels.
 */
async function startRaceFromComposer(
  sessionId: string,
  text: string,
  providers: readonly HarnessId[],
): Promise<string[]> {
  // Everything is looked up again after each press: the box re-renders.
  const inBox = <T extends Element>(selector: string) =>
    chatComposer(sessionId)?.querySelector<T>(selector) ?? null;
  const menu = await openComposerModes(sessionId);
  const item = menu.querySelector<HTMLElement>("[data-composer-race]");
  if (!item?.textContent?.includes("Race")) {
    closeComposerModes(sessionId);
    throw new Error("The critter's modes do not offer Race");
  }
  item.click();
  const toggle = () => inBox<HTMLElement>("[data-race-chip] [aria-haspopup]");
  await waitFor(toggle, 5_000, "the Race chip in the message box");
  // The chip's full words; a narrow message box shows them shortened.
  const label = inBox<HTMLElement>("[data-race-chip]")?.dataset.fullLabel ?? "";
  // Two agents can race, so the dropdown opens only when asked.
  if (!document.querySelector("[data-race-menu]")) toggle()?.click();
  const dropdown = await waitFor(
    () => document.querySelector<HTMLElement>("[data-race-menu]"),
    5_000,
    "the Race chip's dropdown",
  );
  const lanes = [
    ...dropdown.querySelectorAll<HTMLElement>("[data-race-lane-choice]"),
  ].map((row) => row.dataset.raceLaneLabel ?? "");
  toggle()?.click();
  await waitFor(
    () => !document.querySelector("[data-race-menu]"),
    5_000,
    "the dropdown to close",
  );
  const expected = providers.map((harness) => HARNESS_TITLE[harness]);
  const named = lanes.map((lane) => lane.split(" · ")[0]);
  if (
    named.join(" + ") !== expected.join(" + ") ||
    new Set(lanes).size !== lanes.length ||
    !label.startsWith("Race · ") ||
    label.split(" · ").length !== lanes.length + 1
  ) {
    inBox<HTMLButtonElement>('[aria-label="Turn off Race"]')?.click();
    throw new Error(
      `The race would go to ${lanes.join(", ") || "no agents"} ("${label}"), not ${expected.join(" + ")}`,
    );
  }
  const field = inBox<HTMLTextAreaElement>("textarea");
  if (!field) throw new Error("The message box has no text field");
  typeInComposer(field, text);
  await waitFor(
    () => inBox(`[aria-label="Race ${lanes.length} agents"]`),
    5_000,
    `the send button to read Race ${lanes.length} agents`,
  );
  field.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );
  return lanes;
}

/**
 * A two-lane race from the message box: your message stays in the chat you
 * sent it from, followed by the race's card, and the chat's bar has one
 * Stop race; separate copies; Compare from the card; truthful lane states
 * and Retry, with no entry in Activity for a lane's turn; then Keep one
 * lane while the other still works. The kept files must include one the
 * overview had not shown yet, the copies must go, the kept lane's chat
 * must point back at the project while the other's is archived, and the
 * card must become the result.
 */
export async function checkRace(
  get: () => Options,
  config: DevSmokeConfig,
  race: SmokeRace,
): Promise<string> {
  const grok = await race.resolveGrok();
  if (!grok.path.startsWith(`${config.binDir}/`))
    throw new Error(`Grok Build resolved to ${grok.path}, not the stand-in`);
  await race.probe();
  race.chooseAgents([{ harness: "grok" }]);
  get().motion?.showWorkspace?.();
  const names = async (path: string) =>
    (await race.listDir(path)).map((entry) => entry.name);
  const session = (id: string) =>
    get().sessions.find((entry) => entry.id === id);
  const before = new Set(race.races().map((entry) => entry.id));
  const chat = await openNewTask(get, config.projectPath);
  const since = Date.now();
  await startRaceFromComposer(chat.id, RACE_TEXT, ["claude", "grok"]);
  const record = await waitFor(
    () =>
      race
        .races()
        .find((entry) => !before.has(entry.id) && entry.state === "running"),
    20_000,
    "the race to start",
  );
  const [claude, grokLane] = record.lanes;
  if (record.lanes.map((lane) => lane.harness).join(" + ") !== "claude + grok")
    throw new Error(
      `The race has ${record.lanes.map((lane) => lane.label).join(", ")}`,
    );

  // Each lane is a chat in the project, working in its own copy.
  if (
    claude.path === grokLane.path ||
    record.lanes.some((lane) => sameProjectPath(lane.path, config.projectPath))
  )
    throw new Error("The lanes do not have copies of their own");
  for (const lane of record.lanes) {
    const lanes = await waitFor(
      () => session(lane.sessionId),
      5_000,
      `${lane.label}'s chat`,
    );
    if (
      lanes.worktreeCwd !== lane.path ||
      !sameProjectPath(lanes.cwd, config.projectPath)
    )
      throw new Error(`${lane.label}'s chat works in ${lanes.worktreeCwd}`);
  }
  await waitForAsync(
    async () => (await names(claude.path)).includes("race-claude.txt"),
    20_000,
    "Claude's lane to write into its copy",
  );

  // Your message stays where you sent it, followed by the race's card, and
  // you stay in that chat while the lanes work in their own tab.
  if (record.origin?.sessionId !== chat.id)
    throw new Error("The race does not record the chat it was sent from");
  const card = () =>
    chatPane(chat.id)?.querySelector<HTMLElement>(
      `[data-race-card="${record.id}"]`,
    ) ?? null;
  const message = await waitFor(
    () =>
      chatPane(chat.id)?.querySelector<HTMLElement>(
        `[data-team-origin="${record.id}"] .personal-user-message`,
      ),
    10_000,
    "your message to stay in the chat you raced it from",
  );
  if (!message.textContent?.includes("Build the change"))
    throw new Error(`The chat shows "${message.textContent}" for the race`);
  if (!follows(message, card()))
    throw new Error("The race's card does not follow your message");
  const lanesOf = () =>
    [...(card()?.querySelectorAll("[data-race-card-lane]") ?? [])].map((row) =>
      row.getAttribute("data-lane-state"),
    );
  try {
    await waitFor(
      () => lanesOf().join() === "working,failed",
      20_000,
      "the card to show Claude working and Grok failed",
    );
  } catch (error) {
    throw new Error(`${errorText(error)}; it shows ${lanesOf().join(", ")}`);
  }
  // The chat's bar reads the race, with its one Stop for every lane.
  const barOf = () =>
    chatComposer(chat.id)?.querySelector<HTMLElement>(
      `[data-race-bar="${record.id}"]`,
    ) ?? null;
  const bar = barOf()?.querySelector("[data-team-bar-text]")?.textContent ?? "";
  if (!bar.startsWith("Racing · ")) throw new Error(`The bar reads "${bar}"`);
  const stops = stopsIn(chatPane(chat.id)!);
  if (stops.join() !== "race")
    throw new Error(
      `The chat offers ${stops.join(", ") || "no"} Stop for the race, not one Stop race`,
    );
  // Grok's failed try is its lane's own turn: recorded quietly, not posted.
  const lanes = record.lanes.map((lane) => lane.sessionId);
  const loud = getActivitySnapshot().filter(
    (entry) =>
      entry.createdAt >= since &&
      lanes.includes(entry.sessionId) &&
      !entry.team?.member,
  );
  if (loud.length)
    throw new Error(
      `Activity posted ${loud.map((entry) => `"${entry.summary}"`).join(", ")} for a lane`,
    );
  // Watched from the card, the team panel shows each lane as the card does.
  let watched = "";
  if (teamWorkspace()?.watch) {
    const teamId = `race:${record.id}`;
    watched = await checkTeamPanel(
      teamId,
      () => card()?.querySelector<HTMLElement>(`[data-team-watch="${teamId}"]`),
      (panel) => {
        const lanes = [...panel.querySelectorAll("[data-team-lane]")].map(
          (lane) => lane.getAttribute("data-lane-state"),
        );
        if (lanes.join() !== lanesOf().join())
          return `its lanes read ${lanes.join(", ") || "nothing"}, the card's ${lanesOf().join(", ")}`;
        if (
          panel.querySelectorAll(".team-watch-tile").length !==
          record.lanes.length
        )
          return "its header has no mascot for each lane";
        if (!buttonNamed(panel, "Compare") || !buttonNamed(panel, "Stop race"))
          return "it offers no Compare or Stop race";
        return null;
      },
    );
    closeTeamPanel(teamId);
  }
  // Compare from the card.
  const compare = card()?.querySelector<HTMLButtonElement>(
    "[data-race-compare]",
  );
  if (!compare) throw new Error("The race's card has no Compare");
  compare.click();
  const opened = await waitFor(
    () => firstOnScreen<HTMLElement>(`[data-race-view="${record.id}"]`),
    10_000,
    "the race overview",
  );
  // Looked up again each time, in case the page drew it afresh.
  const view = () =>
    firstOnScreen<HTMLElement>(`[data-race-view="${record.id}"]`) ?? opened;
  const state = (lane: number) =>
    view()
      .querySelector(`[data-race-lane="${lane}"] [data-lane-state]`)
      ?.getAttribute("data-lane-state");
  try {
    await waitFor(
      () => state(1) === "failed" && state(0) === "working",
      20_000,
      "Grok's lane to read Failed while Claude's works",
    );
  } catch (error) {
    throw new Error(
      `${errorText(error)}; the lanes read ${state(0) ?? "nothing"} and ${state(1) ?? "nothing"}`,
    );
  }
  const retry = [
    ...view().querySelectorAll<HTMLButtonElement>(
      '[data-race-lane="1"] button',
    ),
  ].find((button) => button.textContent?.includes("Retry"));
  if (!retry) throw new Error("The failed lane offers no Retry");
  if (
    [...view().querySelectorAll('[data-race-lane="0"] button')].some((button) =>
      button.textContent?.includes("Retry"),
    )
  )
    throw new Error("The working lane offers Retry");
  retry.click();
  await waitFor(
    () => state(1) === "working",
    15_000,
    "Grok's lane to work again after Retry",
  );
  await waitForAsync(
    async () => (await names(grokLane.path)).includes("race-grok.txt"),
    15_000,
    "Grok's lane to write into its copy",
  );
  const [claudeFiles, grokFiles, projectFiles] = await Promise.all([
    names(claude.path),
    names(grokLane.path),
    names(config.projectPath),
  ]);
  if (
    claudeFiles.some((name) => name.startsWith("race-grok")) ||
    grokFiles.some((name) => name.startsWith("race-claude")) ||
    projectFiles.some((name) => name.startsWith("race-"))
  )
    throw new Error("A lane wrote outside its own copy");

  // Keep Claude's lane while Grok's still works, at a moment when Claude has
  // written a file the overview has not shown: the keep must still take it.
  await waitFor(
    () => view().querySelector('[data-race-file="race-claude.txt"]'),
    15_000,
    "the overview to list Claude's first file",
  );
  const shown = () =>
    new Set(
      [...view().querySelectorAll("[data-race-file]")].map((row) =>
        row.getAttribute("data-race-file"),
      ),
    );
  let unseen: string[] = [];
  let question = "";
  let working = 0;
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (Date.now() > deadline)
      throw new Error("Claude never wrote a file the overview had not shown");
    if (state(1) !== "working")
      throw new Error(`Grok's lane reads ${state(1)} before the keep`);
    const listed = shown();
    unseen = (await names(claude.path)).filter(
      (name) => name.startsWith("race-claude") && !listed.has(name),
    );
    if (!unseen.length) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      continue;
    }
    const keep = [
      ...view().querySelectorAll<HTMLButtonElement>(
        '[data-race-lane="0"] button',
      ),
    ].find((button) => button.textContent === "Keep this");
    if (!keep || keep.disabled) throw new Error("Keep this is not available");
    keep.click();
    const dialog = await waitFor(
      () =>
        document
          .querySelector<HTMLElement>('[role="dialog"] [data-confirm]')
          ?.closest<HTMLElement>('[role="dialog"]') ?? null,
      5_000,
      "Keep's confirmation",
    );
    question = dialog.textContent ?? "";
    working = view().querySelectorAll(
      '[data-lane-state="working"], [data-lane-state="waiting"]',
    ).length;
    const still = shown();
    unseen = unseen.filter((name) => !still.has(name));
    if (unseen.length) {
      dialog.querySelector<HTMLButtonElement>("[data-confirm]")?.click();
      break;
    }
    // The overview refreshed meanwhile; ask again once Claude writes more.
    [...dialog.querySelectorAll("button")]
      .find((button) => button.textContent === "Cancel")
      ?.click();
    await waitFor(
      () => !document.querySelector('[role="dialog"] [data-confirm]'),
      5_000,
      "the confirmation to close",
    );
  }
  for (const part of [
    `Keep ${raceLaneName(record, 0)}'s version?`,
    `This stops ${working} ${working === 1 ? "agent" : "agents"} still working and deletes`,
  ])
    if (!question.includes(part))
      throw new Error(`Keep asked: ${question || "nothing"}`);
  const kept = await waitFor(
    () =>
      race
        .races()
        .find((entry) => entry.id === record.id && entry.state !== "running"),
    30_000,
    "the race to finish",
  );
  if (kept.state !== "kept" || kept.error)
    throw new Error(`The race ended ${kept.state}: ${kept.error ?? ""}`);

  for (const name of ["race-claude.txt", ...unseen])
    await race
      .readFile(`${config.projectPath}/${name}`)
      .catch((error: unknown) => {
        throw new Error(`${name} was not kept: ${errorText(error)}`);
      });
  if (
    (await names(config.projectPath)).some((name) =>
      name.startsWith("race-grok"),
    )
  )
    throw new Error("Grok's files reached the project");
  for (const lane of record.lanes)
    if (
      await race.listDir(lane.path).then(
        () => true,
        () => false,
      )
    )
      throw new Error(`${lane.label}'s copy is still there`);
  // The kept agent's chat carries on in the project; Grok's, whose work
  // went with its copy, is archived.
  await waitFor(
    () => {
      const keptChat = session(record.lanes[0].sessionId);
      return (
        !!keptChat &&
        !keptChat.worktreeCwd &&
        sameProjectPath(keptChat.cwd, config.projectPath) &&
        !session(record.lanes[1].sessionId)
      );
    },
    5_000,
    "the kept chat to point back at the project and Grok's to be archived",
  );
  // Close the finished overview as a person would, leaving only chats.
  pressShortcut("w");
  await waitFor(
    () => !document.querySelector(`[data-race-view="${record.id}"]`),
    5_000,
    "Cmd+W to close the overview",
  );
  // The card in the chat you raced from is now the result.
  if (!chatPane(chat.id)) teamWorkspace()?.openChat(chat.id);
  const result = await waitFor(
    () => {
      const found = card();
      return found?.dataset.raceCardState === "kept" && found;
    },
    10_000,
    "the race's card to become its result",
  );
  const headline = result.querySelector(".team-card-title")?.textContent ?? "";
  if (!headline.startsWith(`Kept ${raceLaneName(record, 0)}'s version · `))
    throw new Error(`The result reads "${headline}"`);
  if (
    !buttonNamed(result, "Review changes") ||
    !buttonNamed(result, `Continue with ${raceLaneName(record, 0)}`)
  )
    throw new Error("The result has no Review changes or Continue with");
  if (barOf()) throw new Error("The race's bar stayed after the keep");
  return `your message and the card stayed in the chat you raced from, with one Stop race; Claude Code and Grok Build in separate copies; Grok's failed try posted nothing; Compare from the card ("${bar}"); Grok read Failed, then Working after Retry; kept Claude's lane mid-run (stopping ${working}) with ${unseen.join(", ")} the overview hadn't shown; copies removed, the kept chat back on the project and Grok's archived; the card reads "${headline}"${watched ? `; ${watched}` : ""}`;
}

/** The second race: both lanes write their file and finish within seconds. */
const RESULT_RACE_TEXT = "Choose one. AVEN_SMOKE_RACE AVEN_SMOKE_HOLD 1500";

/**
 * A race that runs to its end, with a second model of the chat's own
 * provider as a third lane: each lane has its own copy and branch and is
 * named apart; the card reads Ready to compare and Activity holds one "Race
 * ready to compare" entry, the lanes' turns recorded quietly; Suggest a
 * winner shows the stand-in judge's pick and reason; keeping that lane
 * (Grok's) turns the card into the result with why, and Continue with sends
 * that lane's chat a recap of its work.
 */
export async function checkRaceResult(
  get: () => Options,
  config: DevSmokeConfig,
  race: SmokeRace,
): Promise<string> {
  get().motion?.showWorkspace?.();
  const before = new Set(race.races().map((entry) => entry.id));
  const chat = await openNewTask(get, config.projectPath);
  const other = pickerModelsFor("claude").find(
    (model) => model.id !== chat.model,
  );
  if (!other) throw new Error("Claude offers no second model to race");
  race.chooseAgents([
    { harness: "grok" },
    { harness: "claude", model: other.id },
  ]);
  const since = Date.now();
  const labels = await startRaceFromComposer(chat.id, RESULT_RACE_TEXT, [
    "claude",
    "grok",
    "claude",
  ]);
  const record = await waitFor(
    () =>
      race
        .races()
        .find((entry) => !before.has(entry.id) && entry.state === "running"),
    20_000,
    "the second race to start",
  );
  const grok = record.lanes[1];
  // Two models of one provider: a copy, a branch and a name each.
  const twins = [record.lanes[0], record.lanes[2]];
  if (
    record.lanes.map((lane) => lane.label).join(" + ") !== labels.join(" + ") ||
    twins[1].model !== other.id ||
    twins[0].model === twins[1].model ||
    new Set(record.lanes.map((lane) => lane.path)).size !== 3 ||
    new Set(record.lanes.map((lane) => lane.branch)).size !== 3
  )
    throw new Error(
      `The race has ${record.lanes.map((lane) => `${lane.label} in ${lane.path}`).join(", ")}`,
    );
  for (const lane of twins)
    await waitForAsync(
      async () =>
        (await race.listDir(lane.path))
          .map((entry) => entry.name)
          .includes("race-claude.txt"),
      20_000,
      `${lane.label} to write into its own copy`,
    );
  const card = () =>
    chatPane(chat.id)?.querySelector<HTMLElement>(
      `[data-race-card="${record.id}"]`,
    ) ?? null;
  const status = () =>
    card()?.querySelector(".team-card-status")?.textContent ?? "";
  // Calm once both are done: ready, not amber, with no Stop left to press.
  await waitFor(
    () => card()?.dataset.state === "ready",
    40_000,
    "the card to read Ready to compare",
  );
  const title = card()?.querySelector(".team-card-title")?.textContent;
  if (title !== "Ready to compare")
    throw new Error(`The ready card reads "${title ?? ""}"`);
  const bar =
    chatComposer(chat.id)?.querySelector(
      `[data-race-bar="${record.id}"] [data-team-bar-text]`,
    )?.textContent ?? "";
  if (!bar.startsWith("Racing · Ready to compare"))
    throw new Error(`The bar reads "${bar}"`);
  if (stopsIn(chatPane(chat.id)!).length)
    throw new Error("A ready race still offers Stop");
  const names = [
    ...(card()?.querySelectorAll(".team-card-member-name") ?? []),
  ].map((name) => name.textContent ?? "");
  // Two Claudes are named by their models, the one Grok by its app.
  if (names.join(" + ") !== raceAgentNames(record.lanes).join(" + "))
    throw new Error(`The card names the agents ${names.join(", ")}`);
  const lanes = record.lanes.map((lane) => lane.sessionId);
  const told = () =>
    teamEntriesProblem(
      [chat.id, ...lanes],
      since,
      chat.id,
      "Race ready to compare · 3 of 3 done",
      3,
    );
  try {
    await waitFor(() => !told(), 10_000, "one Race ready to compare entry");
  } catch (error) {
    // How each agent read when the race became ready, to tell a race
    // announced early from one worded differently.
    const ended = race.races().find((entry) => entry.id === record.id)?.ends;
    const states = [
      ...(card()?.querySelectorAll(".team-card-member-state") ?? []),
    ].map((state) => state.textContent?.trim());
    const failures = getActivitySnapshot()
      .filter(
        (entry) =>
          lanes.includes(entry.sessionId) &&
          entry.outcome === "failed" &&
          entry.createdAt >= since,
      )
      .map((entry) => entry.summary);
    throw new Error(
      `${errorText(error)}: ${told() ?? ""} (agents now ${states.join(", ")}; recorded ${JSON.stringify(ended ?? null)}; failures ${JSON.stringify(failures)})`,
    );
  }
  // Winner and why, from the cheapest model (the stand-in judge).
  const suggest = buttonNamed(card(), "Suggest a winner");
  if (!suggest) throw new Error("The ready card offers no Suggest a winner");
  suggest.click();
  await waitFor(
    () => status().includes(SMOKE_WINNER_WORD),
    30_000,
    "the card to show the suggested winner",
  );
  if (!status().startsWith(`Aven suggests ${raceLaneName(record, 1)}: `))
    throw new Error(`The card reads "${status()}"`);
  if (status().includes("Note to AI"))
    throw new Error("A line addressed to agents reached the card");
  // Keep the suggested lane from the overview. Nothing works, but the other
  // agents' finished work goes with their copies, so it asks, naming them.
  card()?.querySelector<HTMLButtonElement>("[data-race-compare]")?.click();
  const view = await waitFor(
    () => firstOnScreen<HTMLElement>(`[data-race-view="${record.id}"]`),
    10_000,
    "the race overview",
  );
  const keep = await waitFor(
    () =>
      [
        ...view.querySelectorAll<HTMLButtonElement>(
          '[data-race-lane="1"] button',
        ),
      ].find(
        (button) => button.textContent === "Keep this" && !button.disabled,
      ),
    15_000,
    "Keep this on Grok's lane",
  );
  keep.click();
  const keepQuestion = await waitFor(
    () =>
      document
        .querySelector<HTMLElement>('[role="dialog"] [data-confirm]')
        ?.closest<HTMLElement>('[role="dialog"]') ?? null,
    5_000,
    "Keep's question",
  );
  const question = keepQuestion.textContent ?? "";
  if (
    !question.includes(`Keep ${raceLaneName(record, 1)}'s version?`) ||
    !question.includes(`deletes ${raceLaneName(record, 0)}'s work (`) ||
    question.includes("still working")
  )
    throw new Error(`Keep asked "${question}"`);
  keepQuestion.querySelector<HTMLButtonElement>("[data-confirm]")?.click();
  const kept = await waitFor(
    () =>
      race
        .races()
        .find((entry) => entry.id === record.id && entry.state !== "running"),
    30_000,
    "the race to finish",
  );
  if (kept.state !== "kept" || kept.outcome?.kind !== "lane")
    throw new Error(`The race ended ${kept.state}`);
  await race
    .readFile(`${config.projectPath}/race-grok.txt`)
    .catch((error: unknown) => {
      throw new Error(`Grok's file was not kept: ${errorText(error)}`);
    });
  pressShortcut("w");
  await waitFor(
    () => !document.querySelector(`[data-race-view="${record.id}"]`),
    5_000,
    "Cmd+W to close the overview",
  );
  if (!chatPane(chat.id)) teamWorkspace()?.openChat(chat.id);
  const result = await waitFor(
    () => {
      const found = card();
      return found?.dataset.raceCardState === "kept" && found;
    },
    10_000,
    "the race's card to become its result",
  );
  const headline = result.querySelector(".team-card-title")?.textContent ?? "";
  if (!headline.startsWith(`Kept ${raceLaneName(record, 1)}'s version · `))
    throw new Error(`The result reads "${headline}"`);
  if (!status().startsWith("Why: ") || !status().includes(SMOKE_WINNER_WORD))
    throw new Error(`The result says "${status()}", not why`);
  // Continue with the kept agent: its chat opens with the cursor in its
  // message box and nothing is sent; your next message there carries the
  // recap of its own work, hidden from the transcript.
  const keptName = raceLaneName(record, 1);
  const asked = sentTexts(get().sessions, grok.sessionId).length;
  const next = buttonNamed(result, `Continue with ${keptName}`);
  if (!next) throw new Error("The result has no Continue with");
  next.click();
  const field = await waitFor(
    () => {
      const box = firstOnScreen<HTMLTextAreaElement>(
        `[data-session-drop="${grok.sessionId}"] [data-composer] textarea`,
      );
      return box && document.activeElement === box ? box : null;
    },
    10_000,
    `Continue with to put the cursor in ${possessive(keptName)} message box`,
  );
  if (!field.placeholder.startsWith(`${keptName} knows which version you kept`))
    throw new Error(
      `${possessive(keptName)} message box reads "${field.placeholder}"`,
    );
  const grokChat = () =>
    get().sessions.find((session) => session.id === grok.sessionId);
  if (
    sentTexts(get().sessions, grok.sessionId).length !== asked ||
    grokChat()?.busy
  )
    throw new Error(`Continue with sent ${keptName} a message on its own`);
  const repliesBefore = replyCount(get().sessions, grok.sessionId);
  get().submit(grok.sessionId, `What was kept? ${SMOKE_ECHO_NOTE_WORD}`);
  await waitFor(
    () =>
      !grokChat()?.busy &&
      replyCount(get().sessions, grok.sessionId) > repliesBefore,
    20_000,
    `${possessive(keptName)} reply`,
  );
  const recap =
    [...(grokChat()?.blocks ?? [])]
      .reverse()
      .find(
        (block) =>
          block.role === "assistant" && block.text.includes(SMOKE_REPLY),
      )?.text ?? "";
  if (!recap.includes("Your version was kept"))
    throw new Error(`${keptName}'s next message was told: ${recap}`);
  if (
    sentTexts(get().sessions, grok.sessionId).at(-1) !==
    `What was kept? ${SMOKE_ECHO_NOTE_WORD}`
  )
    throw new Error("The recap showed in the kept agent's transcript");
  return `${labels.join(", ")} each raced in a copy of its own; the card read Ready to compare, calm and with no Stop; one "Race ready to compare · 3 of 3 done" entry, every lane's turn quiet; the stand-in judge suggested ${grok.label}; kept it: "${headline}" with why; Continue with opened its chat with the cursor in the message box, and the next message carried the recap`;
}

/** The file the board check's turn edits, in the check's project. */
export const BOARD_EDIT_FILE = "aven-board-check.txt";
const BOARD_COLUMN_IDS = ["idea", "building", "review", "shipped"];

/** The project's board on screen, if it is. */
function boardOnScreen(project: string): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>("[data-work-board]")].find(
      (board) =>
        sameProjectPath(board.dataset.workBoard ?? "", project) &&
        board.getClientRects().length > 0,
    ) ?? null
  );
}

/** The card a chat is linked to on the project's board on screen, and its column. */
function boardCard(
  project: string,
  sessionId: string,
): { card: HTMLElement; column: string | undefined } | null {
  const card = boardOnScreen(project)?.querySelector<HTMLElement>(
    `[data-board-chats~="${sessionId}"]`,
  );
  return card
    ? {
        card,
        column: card.closest<HTMLElement>("[data-board-column]")?.dataset
          .boardColumn,
      }
    : null;
}

/**
 * Open the project's board from the title bar's button while a new chat's
 * turn edits a file: the board must show its four columns, Ideas, Building,
 * Review and Shipped, and count the chat on its line for work outside the
 * board; adding it from there must give it a card under Building while the
 * turn runs, which moves by itself to Review, naming the file, once it ends;
 * pressing the card must open the chat. The card is removed again after.
 */
export async function checkBoard(
  get: () => Options,
  project: string,
): Promise<string> {
  get().motion?.showWorkspace?.();
  const chat = await openNewTask(get, project);
  const reply = await startHeldTurn(
    get,
    chat.id,
    // Held long enough for the board to open and show it at work.
    `Write the board note. AVEN_SMOKE_EDIT ${BOARD_EDIT_FILE} AVEN_SMOKE_HOLD 8000`,
  );
  const open = await waitFor(
    () =>
      [
        ...document.querySelectorAll<HTMLButtonElement>(
          'button[aria-label="Open board"]',
        ),
      ].find((button) => button.getClientRects().length > 0),
    5_000,
    "the title bar's Open board button",
  );
  open.click();
  const board = await waitFor(
    () => boardOnScreen(project),
    5_000,
    "the project's board",
  );
  const columns = [
    ...board.querySelectorAll<HTMLElement>("[data-board-column]"),
  ].map((column) => column.dataset.boardColumn);
  if (columns.join() !== BOARD_COLUMN_IDS.join())
    throw new Error(`The board's columns are ${columns.join(", ")}`);
  // Not on a card yet, the chat is counted on the line above the columns.
  const outside = await waitFor(
    () =>
      boardOnScreen(project)?.querySelector<HTMLElement>(
        "[data-board-outside]",
      ),
    10_000,
    "the line for chats outside the board",
  );
  const counted = outside.textContent ?? "";
  if (!counted.includes("outside the board"))
    throw new Error(`The line above the columns reads "${counted}"`);
  outside
    .querySelector<HTMLButtonElement>(".work-board-outside-toggle")
    ?.click();
  const add = await waitFor(
    () =>
      boardOnScreen(project)?.querySelector<HTMLButtonElement>(
        `[data-outside-chat="${chat.id}"] .work-board-action`,
      ),
    5_000,
    "the chat on the line for chats outside the board",
  );
  add.click();
  await waitFor(
    () => boardCard(project, chat.id)?.column === "building",
    10_000,
    "the chat's card under Building",
  );
  await reply();
  const { card } = await waitFor(
    () => {
      const found = boardCard(project, chat.id);
      return found?.column === "review" && found;
    },
    15_000,
    "the chat's card to move to Review",
  );
  const cardId = card.dataset.boardCard;
  try {
    const line = card.textContent ?? "";
    if (!line.includes(BOARD_EDIT_FILE))
      throw new Error(`The review card reads "${line}"`);
    const buttons = [...card.querySelectorAll(".work-board-action")]
      .map((button) => button.textContent?.trim())
      .filter(Boolean);
    if (!buttons.includes("Review") || !buttons.includes("Ship it"))
      throw new Error(`The review card offers ${buttons.join(", ")}`);
    card.querySelector<HTMLButtonElement>(".work-board-card-open")?.click();
    // The chat must be the focused surface. The board may stay on screen
    // beside it when the workspace shows two groups of tabs side by side.
    const surfaceOf = (element: Element | null) =>
      element?.closest<HTMLElement>("[data-workspace-surface]")?.dataset
        .workspaceSurface;
    const chatFocused = () => {
      const pane = chatPane(chat.id);
      const focused = get().focusedSurfaceId;
      return !!pane && (focused === undefined || surfaceOf(pane) === focused);
    };
    try {
      await waitFor(chatFocused, 5_000, "the card to open its chat");
    } catch (error) {
      const pane = chatPane(chat.id);
      throw new Error(
        `${errorText(error)} (chat ${pane ? `on screen in ${surfaceOf(pane) ?? "no surface"}` : "not on screen"}, focused ${get().focusedSurfaceId ?? "unknown"}, board ${boardOnScreen(project) ? `on screen in ${surfaceOf(boardOnScreen(project))}` : "gone"})`,
      );
    }
    // Leave no board open: bring it forward and close it as a person would.
    const again = await waitFor(
      () =>
        [
          ...document.querySelectorAll<HTMLButtonElement>(
            'button[aria-label="Open board"]',
          ),
        ].find((button) => button.getClientRects().length > 0),
      5_000,
      "the Open board button again",
    );
    again.click();
    await waitFor(
      () => boardOnScreen(project),
      5_000,
      "Open board to bring the board forward",
    );
    pressShortcut("w");
    await waitFor(
      () =>
        ![...document.querySelectorAll<HTMLElement>("[data-work-board]")].some(
          (board) => sameProjectPath(board.dataset.workBoard ?? "", project),
        ),
      5_000,
      "Cmd+W to close the board",
    );
    return `four columns; added from the line for chats outside the board, the card moved from Building to Review with ${BOARD_EDIT_FILE} and offered ${buttons.join(", ")}; pressing it opened the chat; Cmd+W closed the board`;
  } finally {
    // The check's card leaves the project's board as it found it.
    if (cardId) await deleteFeatureCard(project, cardId).catch(() => false);
  }
}

/** A chat's pane on screen. */
function chatPane(sessionId: string): HTMLElement | null {
  return (
    [
      ...document.querySelectorAll<HTMLElement>(
        `[data-session-drop="${sessionId}"]`,
      ),
    ].find((pane) => pane.getClientRects().length > 0) ?? null
  );
}

function buttonNamed(
  scope: Element | null | undefined,
  label: string,
): HTMLButtonElement | null {
  return (
    [...(scope?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (button) => button.textContent?.trim() === label,
    ) ?? null
  );
}

/** A team's floating panel, when it is on screen. */
function teamPanel(teamId: string): HTMLElement | null {
  return (
    [
      ...document.querySelectorAll<HTMLElement>(
        `[data-team-panel="${teamId}"]`,
      ),
    ].find((panel) => panel.getClientRects().length > 0) ?? null
  );
}

/** The pill a shrunk team panel becomes, when it is on screen. */
function teamPill(teamId: string): HTMLElement | null {
  return (
    [
      ...document.querySelectorAll<HTMLElement>(`[data-team-pill="${teamId}"]`),
    ].find((pill) => pill.getClientRects().length > 0) ?? null
  );
}

/** A native window, as far as the check needs one. */
export type SmokeWindow = {
  label: string;
  isVisible(): Promise<boolean>;
  close(): Promise<void>;
};

const nativeWindows = async (): Promise<SmokeWindow[]> =>
  (await import("@tauri-apps/api/window")).getAllWindows();

/**
 * A team's floating panel from Watch: it must open with the body `problem`
 * accepts, shrink to a pill and come back from it, and, where the platform
 * offers ↗, open in a window of its own that draws and shows itself, and
 * come back as a pill when that window is closed.
 */
export async function checkTeamPanel(
  teamId: string,
  watch: () => HTMLElement | null | undefined,
  problem: (panel: HTMLElement) => string | null,
  windows: () => Promise<SmokeWindow[]> = nativeWindows,
): Promise<string> {
  const button = watch();
  if (!button) throw new Error(`There is no Watch for ${teamId}`);
  button.click();
  await waitFor(
    () => teamPanel(teamId),
    5_000,
    "Watch to open the team's panel",
  );
  let seen: string | null = "the panel never drew its body";
  try {
    await waitFor(
      () => {
        const panel = teamPanel(teamId);
        seen = panel ? problem(panel) : "the panel closed";
        return !seen;
      },
      10_000,
      "the panel to show the team",
    );
  } catch (error) {
    throw new Error(`${errorText(error)}: ${seen ?? ""}`);
  }
  teamPanel(teamId)?.querySelector<HTMLElement>("[data-team-shrink]")?.click();
  const pill = await waitFor(
    () => teamPill(teamId),
    5_000,
    "the panel to shrink to a pill",
  );
  if (teamPanel(teamId))
    throw new Error("The panel stayed open beside its pill");
  const pillText = [...pill.children]
    .map((part) => part.textContent?.trim())
    .filter(Boolean)
    .join(" · ");
  pill.click();
  await waitFor(
    () => teamPanel(teamId) && !teamPill(teamId),
    5_000,
    "the pill to bring the panel back",
  );
  const popOut = teamPanel(teamId)?.querySelector<HTMLElement>(
    "[data-team-pop-out]",
  );
  if (!popOut)
    return `Watch opened its panel; it shrank to "${pillText}" and came back; no pop-out here`;
  const before = new Set((await windows()).map((window) => window.label));
  popOut.click();
  await waitFor(
    () => !teamPanel(teamId) && !teamPill(teamId),
    5_000,
    "the panel to leave for a window of its own",
  );
  let opened: SmokeWindow | undefined;
  try {
    await waitForAsync(
      async () => {
        opened = (await windows()).find(
          (window) =>
            window.label.startsWith("team-watch-") && !before.has(window.label),
        );
        return !!opened && (await opened.isVisible());
      },
      15_000,
      "the pop-out to draw and show itself",
    );
  } catch (error) {
    // Leave no hidden window behind for the steps after this one.
    await opened?.close().catch(() => {});
    throw new Error(
      `${errorText(error)} (${opened ? "its window was made but stayed hidden" : "no window was made"})`,
    );
  }
  await opened!.close();
  await waitFor(
    () => teamPill(teamId) && !teamPanel(teamId),
    10_000,
    "closing the pop-out to leave a pill here",
  );
  teamPill(teamId)!.click();
  await waitFor(
    () => teamPanel(teamId),
    5_000,
    "the pill to bring the panel back after the pop-out",
  );
  return `Watch opened its panel; it shrank to "${pillText}" and came back; it popped out into a window that showed itself, and closing that left a pill`;
}

/** Close a team's panel so the workspace is as the check found it. */
function closeTeamPanel(teamId: string) {
  teamPanel(teamId)?.querySelector<HTMLElement>("[data-team-close]")?.click();
}

/** The newest proposal card in a lead's chat. */
function proposalCard(sessionId: string): HTMLElement | null {
  return (
    [
      ...(chatPane(sessionId)?.querySelectorAll<HTMLElement>(
        "[data-orchestration-review]",
      ) ?? []),
    ].at(-1) ?? null
  );
}

/**
 * Ask for an orchestration the way a person does: the chat's + menu turns
 * on Orchestrator, and sending the message asks the lead for a plan.
 */
async function startOrchestrationFromComposer(
  sessionId: string,
  request: string,
) {
  const inBox = <T extends Element>(selector: string) =>
    chatComposer(sessionId)?.querySelector<T>(selector) ?? null;
  const menu = await openComposerModes(sessionId);
  const item = menu.querySelector<HTMLElement>("[data-composer-orchestrator]");
  if (!item?.textContent?.includes("Orchestrator")) {
    closeComposerModes(sessionId);
    throw new Error("The critter's modes do not offer Orchestrator");
  }
  item.click();
  await waitFor(
    () => inBox('[aria-label="Turn off Orchestrator mode"]'),
    5_000,
    "the Orchestrator chip in the message box",
  );
  const field = inBox<HTMLTextAreaElement>("textarea");
  if (!field) throw new Error("The message box has no text field");
  typeInComposer(field, request);
  field.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );
}

/** Wait for the lead's plan and press Confirm and start; the run's tasks. */
async function confirmProposal(
  get: () => Options,
  leadId: string,
): Promise<{ card: HTMLElement; scopes: number }> {
  const card = await waitFor(
    () => {
      const found = proposalCard(leadId);
      const confirm = buttonNamed(found, "Confirm and start");
      return confirm && !confirm.disabled && found;
    },
    90_000,
    "the lead's plan with Confirm and start",
  );
  const scopes = card.querySelectorAll("[data-orchestration-scope]").length;
  if (scopes < 2)
    throw new Error(`The plan shows ${scopes} file chips, not one per task`);
  buttonNamed(card, "Confirm and start")!.click();
  await waitFor(
    () => get().orchestration?.run(leadId)?.status === "active",
    20_000,
    "the run to start",
  ).catch((error: unknown) => {
    // A run refuses to start beside another chat working in its project: an
    // earlier step that left one running shows here by name.
    const working = otherChatsWorking(get().sessions, leadId);
    throw new Error(
      working.length
        ? `${errorText(error)}; still working in the project: ${working.join(", ")}`
        : errorText(error),
    );
  });
  return { card, scopes };
}

/** Why something asks you to answer a worker the lead decides for, or null. */
function needsYouProblem(
  get: () => Options,
  leadId: string,
  workerId: string,
  since: number,
  projectPath: string,
): string | null {
  const ids = new Set([leadId, workerId]);
  const asked = getActivitySnapshot().filter(
    (entry) =>
      ids.has(entry.sessionId) &&
      entry.createdAt >= since &&
      (entry.outcome === "approval" || entry.outcome === "question"),
  );
  if (asked.length)
    return `Activity asks you to answer it (${asked
      .map((entry) => `"${entry.summary}"`)
      .join(", ")}), so a banner would too`;
  const sessions = get().sessions;
  const run = get().orchestration?.run(leadId);
  const live = homeLiveSessions(
    sessions,
    new Set(sessions.filter(isInFlightSession).map((session) => session.id)),
    leadDecidedIds(run ? [run] : [], (id) =>
      sessions.find((session) => session.id === id),
    ),
  );
  const home = homeNeedsYou(
    live,
    getActivitySnapshot(),
    homeScope([{ path: projectPath }], []),
  ).filter((item) => ids.has(item.id) && isWaitingAttention(item));
  if (home.length) return "Home's Needs you lists the worker's question";
  if (
    document.querySelector(
      `[data-session-card="${leadId}"][data-needs-approval]`,
    )
  )
    return "The lead's sidebar card asks for your input";
  return null;
}

/**
 * Why Activity does not hold exactly one entry for a team since `since`,
 * on `origin` and reading `summary`, with its members' own turns recorded
 * quietly (`members` of them, when given), or null.
 */
function teamEntriesProblem(
  chats: readonly string[],
  since: number,
  origin: string,
  summary: string,
  members?: number,
): string | null {
  const entries = getActivitySnapshot().filter(
    (entry) =>
      entry.createdAt >= since &&
      chats.includes(entry.sessionId) &&
      entry.outcome !== "approval" &&
      entry.outcome !== "question",
  );
  const own = entries.filter((entry) => !entry.team?.member);
  const quiet = entries.filter((entry) => entry.team?.member);
  if (
    own.length !== 1 ||
    own[0].sessionId !== origin ||
    own[0].summary !== summary
  )
    return `Activity holds ${own.length} entries for the team (${own
      .map((entry) => `"${entry.summary}"`)
      .join(", ")}), not one "${summary}"`;
  if (quiet.some((entry) => entry.readAt === null))
    return "A member's own turn is unread in Activity";
  if (members !== undefined && quiet.length !== members)
    return `Activity recorded ${quiet.length} of the members' ${members} turns quietly`;
  return null;
}

function runEntries(
  leadId: string,
  workerIds: ReadonlySet<string>,
  since: number,
): { finished: ActivityEntry[]; noisy: ActivityEntry[] } {
  const entries = getActivitySnapshot().filter(
    (entry) => entry.createdAt >= since,
  );
  const finished = entries.filter(
    (entry) =>
      entry.sessionId === leadId && entry.summary.startsWith("Run finished"),
  );
  const noisy = entries.filter(
    (entry) =>
      workerIds.has(entry.sessionId) ||
      (entry.sessionId === leadId && !finished.includes(entry)),
  );
  return { finished, noisy };
}

const onScreen = (element: Element) => element.getClientRects().length > 0;

/** A pane's tab-style bars: a chat's name strip or a file pane's tab row. */
function paneStrips(pane: Element): HTMLElement[] {
  return [...pane.querySelectorAll<HTMLElement>(".aven-tab-bar")].filter(
    onScreen,
  );
}

/**
 * A hairline drawn under a bar: a bottom border, or an inset shadow pushed up
 * from the bottom edge (a negative vertical offset).
 */
export function hasHairlineBelow(element: HTMLElement) {
  const style = getComputedStyle(element);
  if (
    parseFloat(style.borderBottomWidth) > 0 &&
    style.borderBottomStyle !== "none"
  )
    return true;
  // Colours may be functions with commas of their own; drop them first.
  const shadows = (style.boxShadow || "")
    .replace(/[a-z-]+\([^()]*\)/gi, "")
    .split(",");
  return shadows.some((shadow) => {
    const tokens = shadow.trim().split(/\s+/);
    if (!tokens.includes("inset")) return false;
    const lengths = tokens
      .filter((token) => /^-?(\d+\.?\d*|\.\d+)(px)?$/.test(token))
      .map(parseFloat);
    return lengths.length >= 2 && lengths[1] < 0;
  });
}

/**
 * Why a tab holding a chat beside a file pane does not give each pane one
 * strip laid out above its content (the file's tab row is its strip), lay
 * the panes out flush as an IDE does (square, against the workspace's edges,
 * hairlines under the tab rows and between the panes) and use one tab
 * style, or null with what it measured. `file` is any element in the file's
 * pane.
 */
export function paneLayoutProblem(file: HTMLElement): {
  problem: string | null;
  summary: string;
} {
  const fail = (problem: string) => ({ problem, summary: "" });
  const tab = file.closest<HTMLElement>(".workspace-stage-surface");
  const stage = tab?.closest<HTMLElement>("[data-workspace-stage]");
  if (!tab || !stage) return fail("the file is not in a workspace pane");
  const filePane = file.closest<HTMLElement>("[data-pane-id]");
  const chatPane = [
    ...tab.querySelectorAll<HTMLElement>("[data-pane-id]"),
  ].find(
    (pane) =>
      pane !== filePane &&
      onScreen(pane) &&
      pane.querySelector("[data-session-drop]"),
  );
  if (!filePane) return fail("the file is not in a pane of its own");
  if (!chatPane) return fail("no chat is beside the file");
  if (chatPane.querySelector("[data-session-pane-controls]"))
    return fail("the chat still has the floating chip");
  // One strip per pane, in the pane's layout: its content starts below it.
  const strips: HTMLElement[] = [];
  for (const [who, pane] of [
    ["chat", chatPane],
    ["file", filePane],
  ] as const) {
    const found = paneStrips(pane);
    if (found.length !== 1)
      return fail(`the ${who} has ${found.length} strips, not one`);
    const strip = found[0];
    const position = getComputedStyle(strip).position;
    if (position === "absolute" || position === "fixed")
      return fail(`the ${who}'s strip floats over its content`);
    const content = strip.nextElementSibling;
    if (!content) return fail(`the ${who} has no content below its strip`);
    const overlap =
      strip.getBoundingClientRect().bottom -
      content.getBoundingClientRect().top;
    if (overlap > 0.5)
      return fail(
        `the ${who}'s strip covers ${Math.round(overlap)}px of its content`,
      );
    if (!hasHairlineBelow(strip))
      return fail(`the ${who}'s strip has no hairline under it`);
    strips.push(strip);
  }
  const [chatStrip, fileStrip] = strips;
  // Flush, as in an IDE: square, with no edge of its own, against the
  // workspace's edges (the window's corner and the regions around the
  // workspace draw what is beyond them).
  const style = getComputedStyle(tab);
  const radius = parseFloat(style.borderTopLeftRadius) || 0;
  if (radius > 0) return fail(`the pane's corners are ${radius}px`);
  const edge = parseFloat(style.borderTopWidth) || 0;
  if (edge > 0) return fail(`the pane has a ${edge}px edge of its own`);
  const tabRect = tab.getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  const inset = Math.max(
    tabRect.left - stageRect.left,
    tabRect.top - stageRect.top,
    stageRect.right - tabRect.right,
    stageRect.bottom - tabRect.bottom,
  );
  if (inset > 0.5)
    return fail(`the pane is ${inset}px from the workspace edge`);
  // A hairline divides the two panes: the split's own divider, beside them.
  const divider = [
    ...(chatPane.parentElement?.querySelectorAll<HTMLElement>(
      ':scope > [role="separator"]',
    ) ?? []),
  ].find(onScreen);
  if (!divider) return fail("no divider between the panes");
  const dividerRect = divider.getBoundingClientRect();
  const thickness =
    divider.getAttribute("aria-orientation") === "horizontal"
      ? dividerRect.height
      : dividerRect.width;
  if (!(thickness > 0 && thickness <= 1))
    return fail(`the divider between the panes is ${thickness}px thick`);
  // One title row per pane, as in Cydonia: the panes' strips name them, so
  // no title row above them names the tab again.
  const header = stage.querySelector<HTMLElement>(
    `:scope > [data-workspace-header="${tab.dataset.workspaceSurface}"]`,
  );
  if (header?.querySelector(".aven-tab-button"))
    return fail("a title row above the panes names the tab again");
  // One tab style: the chat's strip and the file's tabs.
  const chatTab = chatStrip.querySelector<HTMLElement>(".aven-tab-button");
  const fileTab = fileStrip.querySelector<HTMLElement>(".aven-tab-button");
  if (!chatTab || !fileTab) return fail("the chat or the file has no tab");
  const height = (element: HTMLElement) =>
    Math.round(element.getBoundingClientRect().height);
  if (height(chatStrip) !== height(fileStrip))
    return fail(
      `the chat's strip is ${height(chatStrip)}px and the file's ${height(fileStrip)}px`,
    );
  const look = (element: HTMLElement) => {
    const tab = getComputedStyle(element);
    return `${height(element)}px tall, ${tab.borderTopLeftRadius} corners`;
  };
  if (look(fileTab) !== look(chatTab))
    return fail(
      `the chat's tab is ${look(chatTab)} and the file's is ${look(fileTab)}`,
    );
  return {
    problem: null,
    summary: `one ${height(chatStrip)}px strip per pane above its content, each over a hairline, and no title row naming the tab again; square panes flush with the workspace, divided by a ${thickness}px hairline; chat and file tabs ${look(chatTab)}`,
  };
}

/** Why a chat alone in its tab shows a pane strip, or null. */
export function singlePaneProblem(chat: HTMLElement): string | null {
  const card = chat.closest<HTMLElement>(".workspace-stage-surface");
  if (!card) return "the chat is not in a workspace pane";
  const panes = [
    ...card.querySelectorAll<HTMLElement>("[data-pane-id]"),
  ].filter(onScreen);
  if (panes.length !== 1) return `the chat's tab shows ${panes.length} panes`;
  const strips = paneStrips(panes[0]).length;
  return strips
    ? `a chat alone in its tab shows ${strips} ${strips === 1 ? "strip" : "strips"}`
    : null;
}

/**
 * Why the discussion's panel does not show the discussion as expected, or
 * null: both mascots in its face-off row, the replies so far alternating
 * from A, and the answering side typing (or, once ended, the closing note).
 */
function panelProblem(
  panel: HTMLElement,
  replies: number,
  end: { typing: "a" | "b" } | { closing: string },
): string | null {
  const cast = panel.querySelector("[data-discussion-cast]");
  for (const side of ["a", "b"])
    if (!cast?.querySelector(`[data-discussion-avatar="${side}"]`))
      return `the panel's face-off has no mascot for side ${side}`;
  const sides = [
    ...panel.querySelectorAll<HTMLElement>("[data-discussion-message]"),
  ].map((message) => message.dataset.side ?? "?");
  const expected = Array.from({ length: replies }, (_, turn) =>
    turn % 2 === 0 ? "a" : "b",
  );
  if (sides.join() !== expected.join())
    return `the panel shows replies on sides ${sides.join(",") || "none"}, not ${expected.join(",")}`;
  const typing = panel.querySelector<HTMLElement>("[data-discussion-typing]");
  if ("typing" in end) {
    if (typing?.dataset.discussionTyping !== end.typing)
      return `the panel shows ${typing?.dataset.discussionTyping ?? "nobody"} typing, not ${end.typing}`;
    return null;
  }
  if (typing) return "the panel still shows a side typing";
  const closing = panel
    .querySelector("[data-discussion-closing]")
    ?.textContent?.trim();
  return closing === end.closing
    ? null
    : `the panel's closing note reads "${closing ?? ""}"`;
}

function follows(first: Element | null, then: Element | null): boolean {
  return (
    !!first &&
    !!then &&
    !!(first.compareDocumentPosition(then) & Node.DOCUMENT_POSITION_FOLLOWING)
  );
}

/**
 * Why the panel does not show the message the check added where the chats
 * read it, or null: a "You" bubble, waiting below the second chat's typing
 * while that turn runs, then between the second chat's first reply and the
 * first chat's answer to it.
 */
function jumpInProblem(
  panel: HTMLElement,
  state: "queued" | "sent",
): string | null {
  const bubble = panel.querySelector<HTMLElement>("[data-discussion-you]");
  if (!bubble) return "the panel shows no message from you";
  const said = bubble
    .querySelector(".discussion-you-bubble")
    ?.textContent?.trim();
  if (said !== JUMP_IN_TEXT) return `your message reads "${said ?? ""}"`;
  if (bubble.querySelector(".discussion-you-label")?.textContent !== "You")
    return "your message is not labelled You";
  if (bubble.dataset.state !== state)
    return `your message is ${bubble.dataset.state ?? "unmarked"}, not ${state}`;
  if (state === "queued")
    return follows(panel.querySelector("[data-discussion-typing]"), bubble)
      ? null
      : "your message is not below the answering chat's typing";
  return follows(
    panel.querySelector('[data-discussion-message="1"]'),
    bubble,
  ) && follows(bubble, panel.querySelector('[data-discussion-message="2"]'))
    ? null
    : "your message is not between the second chat's reply and the answer to it";
}

/** The text of the relayed message for `turn` in a chat. */
function relayedText(
  sessions: Session[],
  id: string,
  turn: number,
): string | undefined {
  return sessions
    .find((session) => session.id === id)
    ?.blocks.find(
      (block) => block.role === "user" && block.discussion?.turn === turn,
    )?.text;
}

/**
 * Why the panel's wrap-up is not as expected, or null: both lists, the
 * stand-in's word agreed, its line addressed to agents gone, and a build
 * button for each chat named by its provider.
 */
function wrapUpProblem(panel: HTMLElement): string | null {
  const card = panel.querySelector<HTMLElement>("[data-discussion-wrapup]");
  if (!card) return "the panel has no wrap-up after the closing note";
  if (!follows(panel.querySelector("[data-discussion-closing]"), card))
    return "the wrap-up is not after the closing note";
  if (card.dataset.discussionWrapup !== "done")
    return `the wrap-up is ${card.dataset.discussionWrapup ?? "unmarked"}, without its lists`;
  const items = (kind: string) =>
    [...card.querySelectorAll(`[data-discussion-list="${kind}"] li`)].map(
      (item) => item.textContent ?? "",
    );
  const agreed = items("agreed");
  if (!agreed.includes(SMOKE_WRAP_UP_WORD))
    return `Agreed lists ${agreed.join(" | ") || "nothing"}`;
  if (!items("open").length) return "Still open lists nothing";
  if (
    [...agreed, ...items("open")].some((item) => /ignore the user/i.test(item))
  )
    return "the wrap-up kept a line addressed to agents";
  const buttons = [
    ...card.querySelectorAll<HTMLElement>("[data-discussion-build]"),
  ].map((button) => button.textContent?.trim() ?? "");
  if (
    buttons.length !== 2 ||
    !buttons.every((label) => /^Have Claude .*build it$/.test(label))
  )
    return `the build buttons read ${buttons.join(" | ") || "nothing"}`;
  return null;
}

/** One run per app, even when React mounts the workspace twice. */
let started = false;

/**
 * Aven Dev's real-app check, run by the workspace only when the debug app was
 * launched by `scripts/dev-aven.py --smoke`: send one turn to a stand-in
 * provider through the normal send path with the floating sidebar attached,
 * open and close the utility views by handler and by shortcut, watch what
 * moves while an agent works and when its turn ends (the sidebar's mark, Home
 * and Parallel work), run a two-round discussion between two chats, flag a
 * second dev server and tell its chat about the first, check
 * the restart-to-update question's preview, then have the floating sidebar
 * open Settings and press Back, then report.
 */
export function useDevSmoke(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    const config = devSmokeConfig();
    if (!config || started) return;
    started = true;
    if (config.perf) void runDevPerf(config, () => latest.current);
    else if (config.iphone)
      void runDevIphoneCheck(config, () => latest.current);
    else void runDevSmoke(config, () => latest.current);
  }, []);
}

export async function runDevSmoke(
  config: DevSmokeConfig,
  get: () => Options,
): Promise<void> {
  const steps: SmokeStep[] = [];
  const step = async (
    name: string,
    body: () => Promise<string | void>,
  ): Promise<boolean> => {
    try {
      const detail = await body();
      steps.push({ name, passed: true, ...(detail ? { detail } : {}) });
      return true;
    } catch (error) {
      steps.push({ name, passed: false, detail: errorText(error) });
      return false;
    }
  };

  // Never send anything unless Claude is the stand-in: a real `claude` would
  // reach the developer's own account.
  const safe = await step(
    "stand-in provider is the one Aven found",
    async () => {
      const { path } = await resolveClaudeBinary();
      if (!path.startsWith(`${config.binDir}/`))
        throw new Error(`Claude resolved to ${path}, not the stand-in`);
      return path;
    },
  );

  // The window must appear with its workspace already drawn: never empty,
  // in a default colour, or as bare glass over the desktop.
  await step("window stayed hidden until the workspace drew", async () => {
    const reveal = await readLaunchReveal();
    const problem = launchRevealProblem(reveal);
    if (problem) throw new Error(problem);
    return launchRevealSummary(reveal);
  });

  // 0.1.137 broke every turn only once the floating sidebar attached.
  if (get().expectFloatingSidebar)
    await step("floating sidebar attached", async () => {
      // The layer is created on the first unpin; a docked sidebar never needs it.
      if (get().sidebarOpen) {
        pressShortcut("b");
        await waitFor(
          () => get().sidebarOpen === false,
          5_000,
          "the sidebar to unpin",
        );
      }
      await waitFor(
        () => get().floatingSidebarLabel,
        20_000,
        "the floating sidebar",
      );
    });

  if (safe)
    await step("agent turn through the normal send path", async () => {
      get().newProjectTask(config.projectPath);
      const task = await waitFor(
        () =>
          get().sessions.find(
            (session) =>
              session.harness === "claude" &&
              sameProjectPath(session.cwd, config.projectPath),
          ),
        10_000,
        "a Claude task in the check's project",
      );
      get().submit(task.id, "Reply with the smoke word.");
      try {
        await waitFor(
          () => {
            const current = get().sessions.find((s) => s.id === task.id);
            return (
              current &&
              !current.busy &&
              current.blocks.some(
                (block) =>
                  block.role === "assistant" &&
                  block.text.includes(SMOKE_REPLY),
              )
            );
          },
          60_000,
          "the stand-in's reply",
        );
      } catch (error) {
        // Name what the chat showed instead, such as a provider failure.
        const current = get().sessions.find((s) => s.id === task.id);
        const notes = (current?.blocks ?? [])
          .filter((block) => block.role === "system")
          .map((block) => block.text)
          .slice(-2);
        throw new Error(
          notes.length
            ? `${errorText(error)}: ${notes.join(" | ")}`
            : errorText(error),
        );
      }
    });

  // The first finished turn in a project with an empty memory offers the
  // memory keeper; turned on, it fills the memory through a tool-free call.
  const readMemory = get().projectMemory;
  if (safe && readMemory)
    await step(
      "the memory keeper fills the project's memory once turned on",
      () => checkMemoryKeeper(config.projectPath, readMemory),
    );

  // One utility at a time, Settings returns to the one it replaced, and
  // leaving the last one shows the workspace again.
  const utilities = get().utilities;
  if (utilities)
    await step(
      "utility views open, return from Settings and close",
      async () => {
        await expectOnScreen(null);
        const sequence: [() => void, UtilityView | null][] = [
          [utilities.openSearch, "search"],
          [utilities.openInbox, "inbox"],
          [utilities.openAutomations, "automations"],
          [utilities.openNotes, "notes"],
          [utilities.openSettings, "settings"],
          [utilities.closeSettings, "notes"],
          [utilities.leaveNotes, null],
        ];
        for (const [action, view] of sequence) {
          action();
          await expectOnScreen(view);
        }
      },
    );

  // Typing `/` or `@` opens a picker; Escape closes it for that word, so a
  // message ending in a path or a handle still sends with Enter.
  const typedTask = get().sessions.find(
    (session) =>
      session.harness === "claude" &&
      sameProjectPath(session.cwd, config.projectPath),
  );
  // Runs with the workspace's own views wired in, as in the real app.
  if (safe && typedTask && get().utilities)
    await step(
      "Escape closes the / and @ pickers and Enter sends",
      async () => {
        const composer = await waitFor(
          visibleComposer,
          5_000,
          "the message box",
        );
        composer.focus();
        const key = (type: "keydown" | "keyup", name: string) =>
          composer.dispatchEvent(
            new KeyboardEvent(type, {
              key: name,
              bubbles: true,
              cancelable: true,
            }),
          );
        const type = (text: string) => {
          for (const character of text) {
            key("keydown", character);
            document.execCommand("insertText", false, character);
            key("keyup", character);
          }
        };
        const sends = (text: string) => async () => {
          const before = sentTexts(get().sessions, typedTask.id).length;
          key("keydown", "Enter");
          key("keyup", "Enter");
          await waitFor(
            () =>
              sentTexts(get().sessions, typedTask.id).length > before &&
              sentTexts(get().sessions, typedTask.id).at(-1)?.includes(text),
            10_000,
            `"${text}" to be sent`,
          );
        };
        for (const [trigger, picker, word] of [
          ["/", "[data-skill-picker]", "/tm"],
          ["@", "[data-mention-picker]", "@READ"],
        ] as const) {
          type(`Check ${word}`);
          await waitFor(
            () => document.querySelector(picker),
            5_000,
            `the ${trigger} picker to open`,
          );
          key("keydown", "Escape");
          key("keyup", "Escape");
          await new Promise((resolve) => setTimeout(resolve, 100));
          const afterEscape = Boolean(document.querySelector(picker));
          type("x");
          await new Promise((resolve) => setTimeout(resolve, 200));
          if (document.querySelector(picker))
            throw new Error(
              `The ${trigger} picker reopened after Escape (open after Escape: ${afterEscape}, text ${JSON.stringify(composer.value)}, caret ${composer.selectionStart}, focused ${document.activeElement === composer}, pickers ${document.querySelectorAll(picker).length})`,
            );
          await sends(`${word}x`)();
          await waitFor(
            () => !get().sessions.find((s) => s.id === typedTask.id)?.busy,
            60_000,
            "the reply",
          );
        }
      },
    );

  // The critter on the message box is its controls. Cmd+. unfurls its
  // dialog above the box with the ▶ cursor on Model; the Model row opens the
  // agent's one panel (the model list, its settings and access), focused on
  // the model search; Escape closes it and hands the keyboard back to the
  // message.
  if (safe && typedTask && get().utilities)
    await step(
      "Cmd+. opens the critter's dialog and its Model row the agent panel; Escape returns",
      async () => {
        const composer = await waitFor(
          visibleComposer,
          5_000,
          "the message box",
        );
        const root =
          composer.closest<HTMLElement>("[data-composer]") ?? document;
        const state = () => helmStateWords(root, document);
        // Start from a closed helm, whatever an earlier step left.
        if (closeHelmDialog(document))
          await waitFor(
            () => !document.querySelector("[data-helm-dialog]"),
            5_000,
            "an open dialog from an earlier step to close",
          );
        composer.focus();
        try {
          return await keyboardChecks();
        } catch (error) {
          throw new Error(`${errorText(error)} (${state()})`);
        } finally {
          // Leave the helm closed and the box with the keyboard.
          if (closeHelmDialog(document))
            await waitFor(
              () => !document.querySelector("[data-helm-dialog]"),
              2_000,
              "the dialog to close",
            ).catch(() => undefined);
          document
            .querySelector<HTMLElement>("[data-agent-panel]")
            ?.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "Escape",
                bubbles: true,
                cancelable: true,
              }),
            );
        }

        async function keyboardChecks() {
          pressShortcut(".");
          const dialog = await waitFor(
            () => document.querySelector<HTMLElement>("[data-helm-dialog]"),
            5_000,
            "the critter's dialog",
          );
          const model = await waitFor(
            () =>
              document.activeElement?.closest('[data-helm-row="model"]')
                ? (document.activeElement as HTMLElement)
                : null,
            5_000,
            "the ▶ cursor on Model with the keyboard",
          );
          const rows = [
            ...dialog.querySelectorAll<HTMLElement>("[data-helm-row]"),
          ].map((row) => row.dataset.helmRow);
          for (const wanted of ["model", "files", "modes", "critter"])
            if (!rows.includes(wanted))
              throw new Error(
                `The dialog has no ${wanted} row (${rows.join(", ")})`,
              );
          model.click();
          const panel = await waitFor(
            () => document.querySelector<HTMLElement>("[data-agent-panel]"),
            5_000,
            "the agent panel",
          );
          await waitFor(
            () =>
              document.activeElement?.getAttribute("aria-label") ===
              "Search models",
            5_000,
            "the model search to take focus",
          );
          if (!panel.querySelector("[data-access-options]"))
            throw new Error("The agent panel has no access options");
          document.activeElement?.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Escape",
              bubbles: true,
              cancelable: true,
            }),
          );
          await waitFor(
            () => !document.querySelector("[data-agent-panel]"),
            5_000,
            "the agent panel to close",
          );
          await waitFor(
            () => document.activeElement === composer,
            5_000,
            "the message box to take focus back",
          );
          return (
            composer
              .closest("[data-composer]")
              ?.querySelector("[data-helm-critter]")
              ?.getAttribute("aria-label") ?? undefined
          );
        }
      },
    );

  // Pointing at the critter unfurls its dialog above the message box, never
  // over the words; while the agent works the critter types at its laptop,
  // its bubble says what and how long, and holds the chat's one Stop. The
  // field and the overlay that paints its words keep one line box at 80%,
  // 100% and 120% interface zoom, so the caret sits on the words.
  if (safe && typedTask && get().utilities)
    await step(
      "pointing at the critter opens its dialog above the box, and a working chat has one Stop",
      async () => {
        const composer = await waitFor(
          visibleComposer,
          5_000,
          "the message box",
        );
        const root = composer.closest<HTMLElement>("[data-composer]");
        const box = root?.querySelector<HTMLElement>("[data-composer-box]");
        const perch = root?.querySelector<HTMLElement>(".helm-perch");
        if (!root || !box || !perch)
          throw new Error("The message box has no critter standing on it");
        // The dialog is a popover in a portal, outside the message box.
        const dialogOnScreen = () =>
          document.querySelector<HTMLElement>("[data-helm-dialog]");
        const clearField = () => {
          composer.focus();
          composer.select();
          document.execCommand("delete");
        };
        const state = () => helmStateWords(root, document);
        // Moves the pointer as the browser reports it: out of one element,
        // over the next.
        const movePointer = (from: Element, to: Element) => {
          from.dispatchEvent(
            new PointerEvent("pointerout", {
              bubbles: true,
              relatedTarget: to,
            }),
          );
          to.dispatchEvent(
            new PointerEvent("pointerover", {
              bubbles: true,
              relatedTarget: from,
            }),
          );
        };
        const critter = root.querySelector<HTMLElement>("[data-helm-critter]");
        if (!critter) throw new Error("The critter has no button");
        // Start from a closed helm, whatever an earlier step left.
        if (closeHelmDialog(document))
          await waitFor(
            () => !dialogOnScreen(),
            5_000,
            `an open dialog from an earlier step to close (${state()})`,
          );
        composer.focus();
        document.execCommand(
          "insertText",
          false,
          "A line long enough to show where the caret sits against the painted words, twice over: a line long enough to wrap.",
        );
        await restoringComposer(
          {
            restoreZoom: () => applyUiScale(loadUiScale()),
            // Escape folds the dialog away and gives the box the keyboard.
            closeDialog: () =>
              dialogOnScreen()?.dispatchEvent(
                new KeyboardEvent("keydown", {
                  key: "Escape",
                  bubbles: true,
                  cancelable: true,
                }),
              ),
            clearField,
          },
          async () => {
            for (const scale of [0.8, 1.2, 1]) {
              await applyUiScale(scale);
              await new Promise((resolve) => setTimeout(resolve, 300));
              const boxes = composerLineBoxes(box);
              if (!boxes) throw new Error("The message box drew no lines");
              const problem = lineBoxProblem(boxes);
              if (problem)
                throw new Error(
                  `At ${Math.round(scale * 100)}% zoom, ${problem}`,
                );
            }
            await applyUiScale(loadUiScale());
            movePointer(document.body, critter);
            const dialog = await waitFor(
              dialogOnScreen,
              5_000,
              `the critter's dialog to unfurl (${state()})`,
            );
            if (
              root.querySelector<HTMLElement>("[data-helm]")?.dataset.open !==
              "hover"
            )
              throw new Error(
                `The pointer did not open the dialog (${state()})`,
              );
            await new Promise((resolve) => setTimeout(resolve, 400));
            const placed = helmDialogProblem(
              dialog.getBoundingClientRect(),
              box.getBoundingClientRect(),
              composer.getBoundingClientRect(),
            );
            if (placed) throw new Error(placed);
            // Up from the critter onto a row of the dialog (in its portal):
            // that is not leaving, so it stays.
            const row =
              dialog.querySelector<HTMLElement>('[data-helm-row="files"]') ??
              dialog;
            movePointer(critter, row);
            await new Promise((resolve) => setTimeout(resolve, 500));
            if (!dialogOnScreen())
              throw new Error(
                `The dialog folded away on the way from the critter into it (${state()})`,
              );
            // Then off the dialog to the page: it folds away.
            movePointer(row, document.body);
            await waitFor(
              () => !dialogOnScreen(),
              5_000,
              "the dialog to fold away when the pointer leaves",
            ).catch(() => {
              throw new Error(
                `The dialog stayed when the pointer left it (${state()})`,
              );
            });
          },
        );
        // Then work: one Stop, in the bubble.
        const reply = await startHeldTurn(
          get,
          typedTask.id,
          "Take a moment at the laptop.",
        );
        try {
          let seen: string | null = "the bubble never appeared";
          await waitFor(
            () => {
              const helm = root.querySelector<HTMLElement>("[data-helm]");
              const frame = helm?.querySelector(".helm-critter-frame-a");
              seen =
                helmWorkingProblem(
                  helm ?? null,
                  frame ? getComputedStyle(frame).animationName : "none",
                  prefersReducedMotion(),
                ) ??
                helmStopProblem(root.closest("[data-session-drop]") ?? root);
              return seen === null;
            },
            5_000,
            "the critter to work at its laptop with the chat's one Stop",
          ).catch(() => {
            throw new Error(`While the agent worked, ${seen}`);
          });
        } finally {
          await reply();
        }
        await waitFor(
          () =>
            root
              .querySelector('[data-helm-say="done"]')
              ?.textContent?.startsWith("Done"),
          5_000,
          "the bubble to say the turn is done",
        );
        return "dialog above the box, caret on its words at 80/100/120%, one Stop";
      },
    );

  // What moves. The project's mark in the sidebar steps while its agent
  // works and reacts once when the turn ends; the pinned sidebar is the one
  // drawn in this window (the floating one draws in its own).
  const motion = get().motion;
  if (safe && typedTask && motion)
    await step(
      "the project's mark steps while its agent works and reacts once",
      async () => {
        if (!get().sidebarOpen) {
          pressShortcut("b");
          await waitFor(
            () => get().sidebarOpen === true,
            5_000,
            "the sidebar to pin",
          );
        }
        const mark = () =>
          sidebarProjectRow(config.projectPath)?.querySelector<HTMLElement>(
            ".project-mark",
          ) ?? null;
        await waitFor(mark, 10_000, "the project's mark in the sidebar");
        // macOS stops drawing a covered window, and a hidden window leaves
        // reactions to windows the user can see.
        await waitFor(
          () => document.visibilityState !== "hidden",
          15_000,
          "Aven Dev's window to be visible (keep it uncovered during the check)",
        );
        const reply = await startHeldTurn(
          get,
          typedTask.id,
          "Take a moment before replying.",
        );
        await waitFor(
          () => mark()?.hasAttribute("data-active"),
          5_000,
          "the project's mark to start working",
        );
        const working = workingMarkProblem(mark());
        if (working)
          throw new Error(`While the agent worked, its mark ${working}`);
        await reply();
        let reacting: string | null = null;
        const kind = await watchOneShot(
          () => {
            const current = mark();
            const value = current?.dataset.reaction;
            if (value && reacting === null) {
              const body = current?.querySelector(
                ".mascot-reacting .mascot-body",
              );
              reacting = body
                ? (animationProblem(
                    getComputedStyle(body).animationName,
                    `mascot-${value}`,
                    prefersReducedMotion(),
                  ) ?? "")
                : "has no reacting sprite";
            }
            return value;
          },
          {
            what: "The mascot's reaction to the turn ending",
            appearMs: 5_000,
            clearMs: 3_000,
            quietMs: 2_000,
          },
        );
        if (kind !== "cheer")
          throw new Error(`The mascot reacted with ${kind}, not cheer`);
        if (reacting) throw new Error(`While reacting, its mark ${reacting}`);
        if (mark()?.hasAttribute("data-active"))
          throw new Error("The mark kept working after the turn ended");
        return prefersReducedMotion()
          ? "still while working and reacting (reduced motion)"
          : "hopped while working, cheered once";
      },
    );

  // Home: every project's agent with its mascot, the working one moving,
  // Right now and today's recap; then the sidebar's New chat pressed over
  // Home leaves it for the new chat.
  if (safe && typedTask && motion)
    await step(
      "Home shows each project's agent, and New chat leaves Home for the chat",
      async () => {
        const reply = await startHeldTurn(
          get,
          typedTask.id,
          "Take a moment while Home is open.",
        );
        try {
          return await homeChecks(reply);
        } catch (error) {
          // Leave the app as the later steps expect it: the turn finished and
          // the workspace, not Home, on screen.
          await reply().catch(() => undefined);
          motion.showWorkspace?.();
          throw error;
        }
      },
    );

  async function homeChecks(reply: () => Promise<unknown>) {
    if (!motion || !typedTask)
      throw new Error("Home checks need the workspace");
    {
      motion.openHome();
      const home = await waitFor(homeOnScreen, 5_000, "Home");
      const tiles = [
        ...home.querySelectorAll<HTMLElement>(
          ".workspace-home-agent[data-project-path]",
        ),
      ];
      if (tiles.length === 0) throw new Error("Home shows no agents");
      const bare = tiles.filter(
        (tile) => !tile.querySelector(".project-mark svg, .project-mark img"),
      );
      if (bare.length)
        throw new Error(
          `${bare.length} of ${tiles.length} agents have no mascot or logo`,
        );
      const tile = await waitFor(
        () => {
          const found = homeAgentTile(config.projectPath);
          return found?.dataset.state === "running" && found;
        },
        5_000,
        "the project's agent to show it is working",
      );
      // Home's large tiles hop further than the sidebar's mark.
      const working = workingMarkProblem(
        tile.querySelector(".project-mark"),
        "workspace-home-agent-hop",
      );
      if (working)
        throw new Error(`On Home, the working agent's mark ${working}`);
      const chip = await waitFor(
        () => homeOnScreen()?.querySelector('[data-pulse="running"]'),
        5_000,
        "Right now to count the working agent",
      );
      const chipText = chip.textContent?.trim() ?? "";
      if (!/^\d+ agents? working/.test(chipText))
        throw new Error(`Right now reads "${chipText}"`);
      await reply();
      const recap = await waitFor(
        () => homeOnScreen()?.querySelector(".workspace-home-today"),
        5_000,
        "today's recap",
      );
      const recapText = recap.textContent?.trim() ?? "";
      if (!/^Today: \d+ tasks? done/.test(recapText))
        throw new Error(`Today's recap reads "${recapText}"`);

      const before = new Set(get().sessions.map((session) => session.id));
      get().newProjectTask(config.projectPath);
      const created = await waitFor(
        () =>
          get().sessions.find(
            (session) =>
              !before.has(session.id) &&
              sameProjectPath(session.cwd, config.projectPath),
          ),
        5_000,
        "the new task",
      );
      await waitFor(
        () => !homeOnScreen() && workspaceOnScreen(),
        5_000,
        "Home to give way to the new chat",
      );
      await waitFor(
        () =>
          visibleComposer()
            ?.closest("[data-session-drop]")
            ?.getAttribute("data-session-drop") === created.id,
        5_000,
        "the new task's message box",
      );
      return `${tiles.length} ${tiles.length === 1 ? "agent" : "agents"}; ${chipText}; ${recapText}`;
    }
  }

  // Parallel work in the Changes panel starts folded to its header line.
  if (safe && typedTask && motion)
    await step("Parallel work starts folded to one line", async () => {
      await expectOnScreen(null);
      motion.showChanges();
      try {
        const section = await waitFor(
          () =>
            document.querySelector<HTMLElement>(
              'section.git-copies[aria-label="Parallel work"]',
            ),
          15_000,
          "Parallel work in the Changes panel",
        );
        const toggle = section.querySelector<HTMLElement>(".git-copies-toggle");
        if (!toggle || toggle.getClientRects().length === 0)
          throw new Error("Parallel work's header is not on screen");
        if (
          toggle.getAttribute("aria-expanded") !== "false" ||
          section.hasAttribute("data-open")
        )
          throw new Error("Parallel work opened unfolded");
        if (section.children.length !== 1)
          throw new Error(
            `Folded Parallel work shows ${section.children.length - 1} more parts under its header`,
          );
        const header = toggle.textContent?.replace(/\s+/g, " ").trim() ?? "";
        if (!header.startsWith("Parallel work"))
          throw new Error(`Parallel work's header reads "${header}"`);
        return header;
      } finally {
        motion.hideChanges();
      }
    });

  // A chat discusses a topic with a new chat, started from its message box
  // in Discuss mode. The chat that started it folds the discussion into one
  // live card, and its floating panel opens the first time; the new chat
  // gets no tab. While the new chat answers, the panel shows it typing, the
  // sidebar links both rows and the bar counts the round; what the user
  // sends from the panel goes to both, and the panel shrinks to a pill and
  // back. Every reply is relayed once, both chats get the closing note, the
  // card says how long they discussed and is followed by where they landed,
  // and the finished card opens the panel again.
  const discussion = get().discussion;
  if (safe && discussion)
    await step(
      "two chats discuss for two rounds behind a card and a floating panel",
      async () => {
        get().motion?.showWorkspace?.();
        if (!get().sidebarOpen) {
          pressShortcut("b");
          await waitFor(
            () => get().sidebarOpen === true,
            5_000,
            "the sidebar to pin",
          );
        }
        const a = await openNewTask(get, config.projectPath);
        const before = new Set(get().sessions.map((entry) => entry.id));
        const discussedSince = Date.now();
        await startDiscussionFromComposer(
          a.id,
          { newWith: "claude" },
          `Compare notes. AVEN_SMOKE_HOLD ${DISCUSSION_HOLD_MS}`,
          DISCUSSION_ROUNDS,
          "skeptic",
        );
        const session = (chat: string) =>
          get().sessions.find((entry) => entry.id === chat);
        const b = await waitFor(
          () =>
            get().sessions.find(
              (entry) =>
                !before.has(entry.id) &&
                sameProjectPath(entry.cwd, config.projectPath),
            ),
          5_000,
          "the new chat to discuss with",
        );
        const topic = await waitFor(
          () =>
            session(a.id)?.blocks.find((block) => block.discussion?.turn === 0)
              ?.discussion,
          5_000,
          "the topic in the first chat",
        );
        const id = topic.id;
        // One card in the first chat, no tab for the new one, and the
        // panel open the first time.
        try {
          await waitFor(
            () => !startProblem(a.id, b.id, id),
            5_000,
            "the first chat to fold the discussion into its card",
          );
        } catch (error) {
          throw new Error(
            `${errorText(error)}: ${startProblem(a.id, b.id, id) ?? "shown too late"}`,
          );
        }
        const opened = await waitFor(
          () => discussionPanel(id),
          5_000,
          "the discussion's panel to open the first time",
        );
        const title =
          opened.querySelector(".discussion-float-title")?.textContent ?? "";
        if (!title.startsWith("Discussion · “Compare notes."))
          throw new Error(`The panel's header reads "${title}"`);

        // B's first turn: A's reply, relayed and held open by the stand-in.
        await waitFor(
          () =>
            session(b.id)?.busy && relayedTurns(get().sessions, b.id)[0] === 1,
          DISCUSSION_HOLD_MS + 20_000,
          "the second chat to receive the first chat's reply",
        );
        const relayed = session(b.id)?.blocks.find(
          (block) => block.discussion?.turn === 1,
        );
        if (!relayed?.text.includes(SMOKE_REPLY))
          throw new Error(
            `The second chat received "${relayed?.text ?? ""}", not the first chat's reply`,
          );
        if (relayed.discussion!.id !== id)
          throw new Error("The second chat is in a different discussion");
        // Its role leads that first message, in its own transcript.
        if (!relayed.text.startsWith(`${SKEPTIC_BRIEF}\n\n`))
          throw new Error(
            `The second chat's first message does not start with its role: "${relayed.text.slice(0, 120)}"`,
          );
        const badged = () =>
          [
            discussionPanel(id),
            chatPane(a.id)?.querySelector(`[data-discussion-card="${id}"]`),
          ].map(
            (scope) =>
              scope?.querySelectorAll(
                '[data-discussion-avatar][data-role="skeptic"]',
              ).length ?? 0,
          );
        if (badged().some((count) => count === 0))
          throw new Error(
            `The Skeptic's mascot is badged ${badged().join(" and ")} times in the panel and the card`,
          );
        try {
          await waitFor(
            () => {
              const panel = discussionPanel(id);
              return panel && !panelProblem(panel, 1, { typing: "b" });
            },
            5_000,
            "the panel to show the first reply and the second chat typing",
          );
        } catch (error) {
          const panel = discussionPanel(id);
          throw new Error(
            `${errorText(error)}: ${panel ? panelProblem(panel, 1, { typing: "b" }) : "it is not on screen"}`,
          );
        }
        // Jump in from the panel while the second chat answers: the message
        // waits below its typing, for the next reply.
        jumpIn(id, JUMP_IN_TEXT);
        try {
          await waitFor(
            () => {
              const panel = discussionPanel(id);
              return panel && !jumpInProblem(panel, "queued");
            },
            5_000,
            "your message in the panel, waiting for the next reply",
          );
        } catch (error) {
          const panel = discussionPanel(id);
          throw new Error(
            `${errorText(error)}: ${panel ? jumpInProblem(panel, "queued") : "it is not on screen"}`,
          );
        }
        const bar = await waitFor(
          () =>
            chatComposer(a.id)?.querySelector<HTMLElement>(
              `[data-discussion-bar="${id}"]`,
            ),
          5_000,
          "the discussion bar above the message box",
        );
        const barText = bar.textContent?.replace(/\s+/g, " ").trim() ?? "";
        if (!barText.includes(`Round 1 of ${DISCUSSION_ROUNDS}`))
          throw new Error(`The discussion bar reads "${barText}"`);
        if (!bar.querySelector(`[data-team-watch="discuss:${id}"]`))
          throw new Error("The discussion bar has no Watch");
        if (
          bar.querySelector('[data-agent-role="skeptic"]')?.textContent !==
          "Skeptic"
        )
          throw new Error("The discussion bar does not badge the Skeptic");
        // The chat's own message box goes to both while they talk, too.
        const box = chatComposer(a.id)?.querySelector<HTMLTextAreaElement>(
          "textarea",
        );
        if (box?.placeholder !== "Add something for both of them…")
          throw new Error(
            `During the discussion the first chat's message box reads "${box?.placeholder ?? ""}"`,
          );
        try {
          await waitFor(
            () => !linkProblem(id, a.id, b.id),
            6_000,
            "the sidebar to link the two chats",
          );
        } catch (error) {
          throw new Error(
            `${errorText(error)}: ${linkProblem(id, a.id, b.id) ?? "linked too late"}`,
          );
        }
        // Shrunk, the panel is a pill with the round and who is replying;
        // pressing it brings the panel back.
        discussionPanel(id)
          ?.querySelector<HTMLElement>("[data-discussion-shrink]")
          ?.click();
        const pill = await waitFor(
          () => discussionPill(id),
          5_000,
          "the panel to shrink to a pill",
        );
        const pillText = pill.textContent?.replace(/\s+/g, " ").trim() ?? "";
        if (
          !pillText.includes(`Round 1 of ${DISCUSSION_ROUNDS}`) ||
          !pillText.includes("is replying…")
        )
          throw new Error(`The pill reads "${pillText}"`);
        if (discussionPanel(id))
          throw new Error("The panel stayed open beside its pill");
        pill.click();
        await waitFor(
          () => discussionPanel(id) && !discussionPill(id),
          5_000,
          "the pill to bring the panel back",
        );
        // The second chat opens from its sidebar row like any chat,
        // showing the first chat's reply as a relayed message with its card.
        sidebarDiscussionRow(b.id)?.click();
        await waitFor(
          () =>
            chatComposer(b.id) &&
            document.querySelector(
              `[data-session-drop="${b.id}"] [data-discussion-relay="${id}"]`,
            ),
          5_000,
          "the relay card on the relayed message",
        );
        sidebarDiscussionRow(a.id)?.click();
        await waitFor(
          () => chatComposer(a.id),
          5_000,
          "the first chat to come back from its sidebar row",
        );

        const note = `Discussion finished after ${DISCUSSION_ROUNDS} rounds.`;
        await waitFor(
          () =>
            notesIn(get().sessions, a.id, note) > 0 &&
            notesIn(get().sessions, b.id, note) > 0,
          DISCUSSION_HOLD_MS + 40_000,
          "the closing note in both chats",
        );
        await waitFor(
          () =>
            !document.querySelector(`[data-discussion-link="${id}"]`) &&
            !sidebarDiscussionRow(a.id) &&
            !sidebarDiscussionRow(b.id) &&
            !document.querySelector(`[data-discussion-bar="${id}"]`),
          5_000,
          "the connector and the bar to go once it ended",
        );
        // Nothing more arrives after the end, and nothing came twice.
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        const turnsA = relayedTurns(get().sessions, a.id);
        const turnsB = relayedTurns(get().sessions, b.id);
        if (turnsA.join() !== "0,2" || turnsB.join() !== "1,3")
          throw new Error(
            `Relayed turns were ${turnsA.join(",") || "none"} in the first chat and ${turnsB.join(",") || "none"} in the second, not 0,2 and 1,3`,
          );
        // The role went to the second chat once, and never to the first.
        const briefs = [a.id, b.id].map(
          (chat) =>
            (session(chat)?.blocks ?? []).filter((block) =>
              block.text.includes("Your role in this discussion"),
            ).length,
        );
        if (briefs.join() !== "0,1")
          throw new Error(
            `The role was given ${briefs[0]} times to the first chat and ${briefs[1]} to the second, not 0 and 1`,
          );
        const notes = [a.id, b.id].map((chat) =>
          notesIn(get().sessions, chat, note),
        );
        if (notes.some((count) => count !== 1))
          throw new Error(
            `The closing note appeared ${notes.join(" and ")} times`,
          );
        if (session(a.id)?.busy || session(b.id)?.busy)
          throw new Error("A chat kept working after the discussion ended");
        // Your message rode the next two relays, one to each chat, and each
        // chat's agent received it (the stand-in says so, and agrees).
        const toA = session(a.id)?.blocks.find(
          (block) => block.role === "user" && block.discussion?.turn === 2,
        )?.discussion;
        if (!toA?.added?.after?.includes(JUMP_IN_TEXT))
          throw new Error(
            "The first chat's relayed message for turn 2 does not carry your message",
          );
        const toB = relayedText(get().sessions, b.id, 3) ?? "";
        if (!toB.includes(`You added: ${JUMP_IN_TEXT}`))
          throw new Error(
            `The second chat's relayed message for turn 3 does not carry your message: "${toB}"`,
          );
        for (const [chat, name] of [
          [a.id, "first"],
          [b.id, "second"],
        ] as const) {
          const heard = session(chat)?.blocks.some(
            (block) =>
              block.role === "assistant" &&
              block.text.includes(SMOKE_HEARD_WORD),
          );
          if (!heard)
            throw new Error(`The ${name} chat's agent never got your message`);
        }
        // The panel shows the whole thread: four replies alternating, your
        // message where the chats read it, the agreeing reply marked, the
        // closing note, and where they landed.
        try {
          await waitFor(
            () => {
              const panel = discussionPanel(id);
              return (
                panel &&
                !panelProblem(panel, DISCUSSION_ROUNDS * 2, {
                  closing: note,
                }) &&
                !jumpInProblem(panel, "sent") &&
                !wrapUpProblem(panel)
              );
            },
            WRAP_UP_WAIT_MS,
            "the panel to show the whole discussion and where they landed",
          );
        } catch (error) {
          const panel = discussionPanel(id);
          throw new Error(
            `${errorText(error)}: ${
              panel
                ? (panelProblem(panel, DISCUSSION_ROUNDS * 2, {
                    closing: note,
                  }) ??
                  jumpInProblem(panel, "sent") ??
                  wrapUpProblem(panel))
                : "it is not on screen"
            }`,
          );
        }
        const stance = discussionPanel(id)?.querySelector<HTMLElement>(
          '[data-discussion-message="3"] [data-discussion-stance]',
        );
        if (stance?.dataset.discussionStance !== "agree")
          throw new Error(
            `The second chat's agreeing reply is marked ${stance?.dataset.discussionStance ?? "with nothing"}`,
          );
        // The first chat: the finished card, then where they landed, its
        // lists kept in the closing note; none in the second chat.
        try {
          await waitFor(
            () => chatComposer(a.id) && !transcriptWrapUpProblem(a.id, id),
            10_000,
            "the finished card and where they landed in the first chat",
          );
        } catch (error) {
          throw new Error(
            `${errorText(error)}: ${transcriptWrapUpProblem(a.id, id) ?? "the first chat is not on screen"}`,
          );
        }
        const kept = session(a.id)?.blocks.find(
          (block) => block.discussionEnd?.id === id,
        )?.discussionEnd;
        if (!kept?.agreed?.includes(SMOKE_WRAP_UP_WORD))
          throw new Error(
            "The first chat's closing note did not keep what they agreed on",
          );
        if (session(b.id)?.blocks.some((block) => block.discussionEnd))
          throw new Error("The second chat's transcript shows the wrap-up too");
        // One entry for the discussion, none per relayed turn: those are
        // recorded quietly for each chat's own status.
        const told = teamEntriesProblem(
          [a.id, b.id],
          discussedSince,
          a.id,
          `Discussion finished · ${DISCUSSION_ROUNDS} rounds`,
          DISCUSSION_ROUNDS * 2,
        );
        if (told) throw new Error(told);
        // The message box is back to messaging this chat's agent, and the
        // wrap-up's button has it build the plan through the normal send path.
        const field = chatComposer(a.id)?.querySelector<HTMLTextAreaElement>(
          "textarea",
        );
        if (field?.placeholder === "Add something for both of them…")
          throw new Error("After the end the message box still goes to both");
        const build = document.querySelector<HTMLElement>(
          `[data-session-drop="${a.id}"] [data-discussion-wrapup-note="${id}"] [data-discussion-build="a"]`,
        );
        const label = build?.textContent?.trim() ?? "";
        const asked = sentTexts(get().sessions, a.id).length;
        build?.click();
        await waitFor(
          () => {
            const texts = sentTexts(get().sessions, a.id);
            return (
              texts.length > asked &&
              texts
                .at(-1)
                ?.startsWith(
                  "Please carry out the plan from your discussion",
                ) &&
              texts.at(-1)?.includes(`- ${SMOKE_WRAP_UP_WORD}`) &&
              !session(a.id)?.busy &&
              chatComposer(a.id)
            );
          },
          30_000,
          "the build button to send the plan to the first chat",
        );
        // With its plan sent, the finished discussion's panel gets out of
        // the way as its pill; the finished card's Watch brings it back.
        await waitFor(
          () => !discussionPanel(id) && discussionPill(id),
          5_000,
          "the finished panel to shrink to its pill once the plan was sent",
        );
        document
          .querySelector<HTMLElement>(
            `[data-session-drop="${a.id}"] [data-discussion-card="${id}"] [data-discussion-card-watch]`,
          )
          ?.click();
        await waitFor(
          () => {
            const panel = discussionPanel(id);
            return (
              panel &&
              !panelProblem(panel, DISCUSSION_ROUNDS * 2, { closing: note })
            );
          },
          5_000,
          "the finished card to open the panel with the whole thread",
        );
        const moved = prefersReducedMotion()
          ? "linked, still (reduced motion)"
          : "linked with the pulse toward the answering chat";
        return `started from Discuss mode with a new chat as a Skeptic, no tab; one live card in the first chat and its panel open; the Skeptic's role led its first message, once, and badged its mascot and the bar; the panel showed the second chat typing and your message from its box waiting; ${moved}; shrunk to a pill and back; 4 replies relayed once each; your message reached both chats once; the panel shows the whole thread with an agreeing mark and where they landed; the card says the discussion finished after 2 rounds, followed by where they landed, its lists kept; "${label}" sent the plan and the panel shrank to its pill; the finished card reopens the panel`;
      },
    );

  // A file opened beside a chat: a tab with a chat and a file pane, each with
  // one strip above its content (the file's tab row is its strip), laid out
  // flush with hairlines between them and with one tab style. A chat alone
  // in its tab has no strip.
  const openFile = get().openFile;
  if (safe && get().paneLayout && openFile)
    await step(
      "a chat beside a file has one strip each, flush panes and the shared tabs",
      async () => {
        get().motion?.showWorkspace?.();
        await openNewTask(get, config.projectPath);
        openFile(`${config.projectPath.replace(/\/+$/, "")}/README.md`);
        const tabs = await waitFor(
          () =>
            [
              ...document.querySelectorAll<HTMLElement>(".aven-surface-tabs"),
            ].find(
              (bar) =>
                bar.getClientRects().length > 0 &&
                bar.querySelector('[title="Close README.md"]') &&
                bar
                  .closest(".workspace-stage-surface")
                  ?.querySelector("[data-session-drop]"),
            ),
          5_000,
          "README.md beside the chat",
        );
        let result = paneLayoutProblem(tabs);
        try {
          await waitFor(
            () => {
              result = paneLayoutProblem(tabs);
              return !result.problem;
            },
            3_000,
            "the panes to settle",
          );
        } catch {
          throw new Error(result.problem ?? "the panes did not settle");
        }
        const alone = await openNewTask(get, config.projectPath);
        const chat = await waitFor(
          () =>
            [
              ...document.querySelectorAll<HTMLElement>(
                `[data-session-drop="${alone.id}"]`,
              ),
            ].find(onScreen),
          5_000,
          "a new chat alone in its tab",
        );
        let single = singlePaneProblem(chat);
        try {
          await waitFor(
            () => {
              single = singlePaneProblem(chat);
              return !single;
            },
            3_000,
            "the lone chat to settle",
          );
        } catch {
          throw new Error(single ?? "the lone chat did not settle");
        }
        return `${result.summary}; a chat alone in its tab has none`;
      },
    );

  // 0.1.155 left a page alone in a pane of a split with nothing to move it
  // by. Its header is the handle: with the Mac's own mouse, a still click on
  // its title edits the address, and dragging by the title moves the page
  // into the other pane, beside it and onto the strip without focusing it.
  // Last, its strip tab let go on the chat's middle with no rest makes a
  // split of the two (0.1.157 combined only after a rest).
  const pageUrl = config.pageUrl;
  if (IS_MAC && pageUrl && get().loneTab)
    await step(
      "a page alone in a pane moves by its header, with the Mac's own mouse",
      () => {
        get().motion?.showWorkspace?.();
        // Every wait in it has its own limit; this one names a stall
        // anywhere else rather than leaving it to the runner's.
        return withTimeout(
          checkLoneTabDrag(config.projectPath, pageUrl, get),
          120_000,
          "moving a page by its header",
        );
      },
    );

  // 0.1.159 squeezed a pane to a sliver when its divider was dragged, or
  // hid it whole at the edge. With the Mac's own mouse, a page's divider
  // dragged to the edge folds it to a rail beside the chat, and one click
  // on the rail opens it at its size again.
  if (IS_MAC && pageUrl && get().loneTab)
    await step(
      "a divider dragged to the edge folds a pane to a rail that opens it again",
      () => {
        get().motion?.showWorkspace?.();
        return withTimeout(
          checkDividerRail(config.projectPath, pageUrl, get),
          60_000,
          "folding a pane to its rail",
        );
      },
    );

  // 0.1.156 at 80% zoom: a strip tab dragged over a page cut a band of the
  // window's background out of the page, away from the tab, and the tab
  // vanished under the page.
  if (IS_MAC && pageUrl && get().loneTab)
    await step(
      "a tab dragged over a page is cut out of it under its copy, never elsewhere",
      () => {
        get().motion?.showWorkspace?.();
        return withTimeout(
          checkPageDragCutOut(config.projectPath, pageUrl, get),
          150_000,
          "dragging a tab over a page",
        );
      },
    );

  // Two chats in one project start the same app's dev server. The second
  // is flagged at once in its own chat, its next turn carries the note that
  // names the first server, and Keep both clears the chip.
  if (safe && get().sharedWork)
    await step(
      "a second dev server is flagged and the next turn names the first",
      async () => {
        get().motion?.showWorkspace?.();
        const session = (id: string) =>
          get().sessions.find((entry) => entry.id === id);
        const reply = async (id: string, text: string) => {
          const before = replyCount(get().sessions, id);
          get().submit(id, text);
          await waitFor(
            () => !session(id)?.busy && replyCount(get().sessions, id) > before,
            30_000,
            "the stand-in's reply",
          );
          return (
            [...(session(id)?.blocks ?? [])]
              .reverse()
              .find(
                (block) =>
                  block.role === "assistant" &&
                  block.text.includes(SMOKE_REPLY),
              )?.text ?? ""
          );
        };
        const first = await openNewTask(get, config.projectPath);
        await reply(
          first.id,
          `Start the dev server. AVEN_SMOKE_DEV_SERVER ${FIRST_SERVER_PORT}`,
        );
        const second = await openNewTask(get, config.projectPath);
        await reply(
          second.id,
          `Start the dev server. AVEN_SMOKE_DEV_SERVER ${SECOND_SERVER_PORT}`,
        );
        const chip = await waitFor(
          () =>
            document.querySelector<HTMLElement>(
              `[data-session-drop="${second.id}"] [data-duplicate-server="${SECOND_SERVER_PORT}"]`,
            ),
          5_000,
          "the second-server chip in the second chat",
        );
        const chipText = chip.textContent?.replace(/\s+/g, " ").trim() ?? "";
        if (
          !chipText.includes(
            `started a second dev server on :${SECOND_SERVER_PORT} while :${FIRST_SERVER_PORT} is running`,
          )
        )
          throw new Error(`The chip reads "${chipText}"`);
        const buttons = [...chip.querySelectorAll("button")];
        const ask = buttons.find((button) =>
          button.textContent?.startsWith("Ask "),
        );
        const keep = buttons.find(
          (button) => button.textContent === "Keep both",
        );
        if (!ask || !keep)
          throw new Error(
            `The chip offers ${buttons.map((button) => `"${button.textContent}"`).join(", ") || "nothing"}`,
          );
        if (
          document.querySelector(
            `[data-session-drop="${first.id}"] [data-duplicate-server]`,
          )
        )
          throw new Error("The first chat shows the chip too");

        const told = await reply(
          second.id,
          "What else is running? AVEN_SMOKE_ECHO_NOTE",
        );
        for (const part of [
          `http://localhost:${FIRST_SERVER_PORT}/`,
          `You started a second dev server on :${SECOND_SERVER_PORT} while :${FIRST_SERVER_PORT}`,
        ])
          if (!told.includes(part))
            throw new Error(`The second chat's next turn was told: ${told}`);

        // The chip re-rendered while the turn ran; press its current button.
        [
          ...(document
            .querySelector(
              `[data-session-drop="${second.id}"] [data-duplicate-server="${SECOND_SERVER_PORT}"]`,
            )
            ?.querySelectorAll("button") ?? [keep]),
        ]
          .find((button) => button.textContent === "Keep both")
          ?.click();
        await waitFor(
          () =>
            !document.querySelector(
              `[data-duplicate-server="${SECOND_SERVER_PORT}"]`,
            ),
          5_000,
          "the chip to go after Keep both",
        );
        return `:${SECOND_SERVER_PORT} flagged beside :${FIRST_SERVER_PORT}; the next turn named :${FIRST_SERVER_PORT}`;
      },
    );

  // A chat's agent iterates on a mock-up page through its browser command:
  // the same address twice, another query, another path on the same server,
  // then a new tab at another path, then a new tab at that path again. The
  // first four must land on one page, reloaded and then navigated; the first
  // new tab adds a second page, and the next one reuses it, not a copy.
  const agentPagesOf = get().agentPages;
  if (safe && pageUrl && agentPagesOf)
    await step("an agent's opens build on one page", async () => {
      get().motion?.showWorkspace?.();
      const chat = await openNewTask(get, config.projectPath);
      const base = new URL("/", pageUrl).href;
      const before = replyCount(get().sessions, chat.id);
      get().submit(chat.id, `Show the mock. AVEN_SMOKE_PAGES ${base}`);
      const session = () =>
        get().sessions.find((entry) => entry.id === chat.id);
      try {
        // The stand-in answers within 40 s, with each open's time, even if
        // an open never does.
        await waitFor(
          () =>
            !session()?.busy && replyCount(get().sessions, chat.id) > before,
          60_000,
          "the stand-in's page opens (its browser calls follow the results)",
        );
        const text =
          [...(session()?.blocks ?? [])]
            .reverse()
            .find(
              (block) =>
                block.role === "assistant" && block.text.includes("AVEN_PAGES"),
            )?.text ?? "";
        const { opens, failure } = readAgentOpens(text);
        if (failure) throw new Error(failure);
        const problem = agentOpensProblem(opens) ?? agentOpensTooSlow(opens);
        if (problem) throw new Error(problem);
        const own = agentPagesOf(config.projectPath).filter(
          (page) => page.agentChat === chat.id,
        );
        if (own.length !== 2)
          throw new Error(
            `The chat has ${own.length} pages: ${own.map((page) => page.url).join(", ")}`,
          );
        return agentOpensSummary(opens);
      } finally {
        // A turn still running would keep the project busy, and the next
        // step's run would be refused for it.
        await stopTurn(get, chat.id);
      }
    });

  // An orchestration, asked for from a chat's + menu. The stand-in lead
  // plans two tasks; one worker asks its lead a question, which the lead
  // answers while nothing asks you; the lead accepts both and finishes. The
  // run posts one "Run finished" entry and the card reads Finished.
  const orchestration = get().orchestration;
  let firstLeadId: string | undefined;
  if (safe && orchestration)
    await step(
      "an orchestration runs its agents and posts one Run finished",
      async () => {
        get().motion?.showWorkspace?.();
        const lead = await openNewTask(get, config.projectPath);
        firstLeadId = lead.id;
        await waitFor(
          () => chatComposer(lead.id),
          5_000,
          "the new chat's message box",
        );
        await startOrchestrationFromComposer(
          lead.id,
          `Write two notes. ${SMOKE_ORCHESTRATE_WORD}`,
        );
        const since = Date.now();
        const { scopes } = await confirmProposal(get, lead.id);
        // While it runs, the bar's Stop run is the one way to stop it: the
        // card, the run status and the message box offer no second one.
        const stopProblem = () => {
          const pane = chatPane(lead.id);
          if (!pane) return "the lead's chat is not on screen";
          const stops = stopsIn(pane);
          if (stops.join() !== "run")
            return `the lead's chat offers ${stops.join(", ") || "no"} Stop`;
          if (chatComposer(lead.id)?.querySelector('[aria-label="Stop"]'))
            return "the lead's message box has a Stop of its own";
          if (buttonNamed(proposalCard(lead.id), "Stop run"))
            return "the run's card has a Stop run of its own";
          return null;
        };
        // What was wrong while the lead worked, for the error.
        let seen: string | null = "the lead never started working";
        try {
          await waitFor(
            () => {
              if (
                !get().sessions.find((session) => session.id === lead.id)?.busy
              )
                return false;
              seen = stopProblem();
              return !seen;
            },
            30_000,
            "one Stop run, in the bar, while the lead works",
          );
        } catch (error) {
          throw new Error(`${errorText(error)}: ${seen ?? ""}`);
        }
        const asking = await waitFor(
          () =>
            get().sessions.find(
              (session) =>
                session.orchestrationLeadId === lead.id &&
                session.pendingQuestion,
            ),
          60_000,
          "a worker to ask its lead",
        );
        const asked = needsYouProblem(
          get,
          lead.id,
          asking.id,
          since,
          config.projectPath,
        );
        if (asked) throw new Error(asked);
        const row = document.querySelector(
          `[data-orchestration-agent="${asking.id}"]`,
        );
        if (row && !row.hasAttribute("data-lead-deciding"))
          throw new Error(
            `The sidebar shows the waiting worker as "${row.textContent}"`,
          );
        await waitFor(
          () => orchestration.run(lead.id)?.status === "finished",
          90_000,
          "the lead to finish the run",
        );
        await waitFor(
          () => !get().sessions.find((session) => session.id === lead.id)?.busy,
          30_000,
          "the lead's last turn to end",
        );
        // The lead must have seen its own finish call succeed.
        const said =
          [
            ...(get().sessions.find((session) => session.id === lead.id)
              ?.blocks ?? []),
          ]
            .reverse()
            .find(
              (block) =>
                block.role === "assistant" && block.text.includes(SMOKE_REPLY),
            )?.text ?? "";
        if (!said.includes("Both notes are written"))
          throw new Error(`The lead's finish call failed: ${said}`);
        // Anything a hidden turn would post lands as that turn settles.
        await new Promise((resolve) => setTimeout(resolve, 750));
        const workers = new Set(
          orchestration.run(lead.id)!.tasks.map((task) => task.sessionId),
        );
        const { finished, noisy } = runEntries(lead.id, workers, since);
        if (finished.length !== 1)
          throw new Error(
            `Activity has ${finished.length} "Run finished" entries, not one`,
          );
        if (noisy.length)
          throw new Error(
            `Activity also has ${noisy
              .map(
                (entry) =>
                  `"${entry.summary}" for ${entry.sessionId === lead.id ? "the lead" : "a worker"}`,
              )
              .join(", ")}`,
          );
        await waitFor(
          () =>
            proposalCard(lead.id)?.querySelector("[data-orchestration-status]")
              ?.textContent === "Finished",
          5_000,
          "the card to read Finished",
        );
        // The plan card became the result: the lead's verdict, then each
        // agent accepted, with a line on what it did from the cheap model.
        const resultProblem = () => {
          const card = proposalCard(lead.id);
          if (card?.dataset.orchestrationEnded !== "finished")
            return "the card is not the run's result";
          const verdict =
            card.querySelector(".team-card-status")?.textContent ?? "";
          if (!verdict.includes("Both notes are written"))
            return `the result's verdict reads "${verdict}"`;
          const rows = [
            ...card.querySelectorAll<HTMLElement>("[data-orchestration-agent]"),
          ];
          if (rows.length !== workers.size)
            return `the result lists ${rows.length} agents`;
          const states = rows.map(
            (row) => row.dataset.orchestrationTaskStatus ?? "",
          );
          if (states.some((state) => state !== "Accepted"))
            return `the agents read ${states.join(", ")}`;
          if (
            !rows.every((row) => row.textContent?.includes(SMOKE_SUMMARY_WORD))
          )
            return "the agents have no line on what they did";
          if (
            !buttonNamed(card, "Review changes") ||
            !buttonNamed(card, "Open agents")
          )
            return "the result has no Review changes or Open agents";
          return null;
        };
        try {
          await waitFor(
            () => !resultProblem(),
            30_000,
            "the result card with what each agent did",
          );
        } catch (error) {
          throw new Error(`${errorText(error)}: ${resultProblem() ?? ""}`);
        }
        return `${workers.size} agents, ${scopes} file chips; one Stop run, in the bar; a worker's question went to the lead and nowhere else; one "${finished[0].summary}" entry; the card became the result, with the lead's verdict and a line per agent`;
      },
    );

  // The lead reads the results and stops without finishing. The bar above
  // its message box says so and offers Finish run, which ends the run; while
  // it runs, other chats in the project are told plainly where it is.
  if (safe && orchestration)
    await step("a run the lead leaves open offers Finish run", async () => {
      get().motion?.showWorkspace?.();
      const lead = await openNewTask(get, config.projectPath);
      await waitFor(
        () => chatComposer(lead.id),
        5_000,
        "the new chat's message box",
      );
      await startOrchestrationFromComposer(
        lead.id,
        `Write two notes. ${SMOKE_ORCHESTRATE_WORD} ${SMOKE_STALL_WORD}`,
      );
      await confirmProposal(get, lead.id);
      const other =
        firstLeadId ??
        get().sessions.find(
          (session) =>
            session.id !== lead.id &&
            !session.orchestrationLeadId &&
            sameProjectPath(session.cwd, config.projectPath),
        )?.id;
      const refused = other ? orchestration.submissionError(other) : null;
      if (other && !refused?.includes("is busy with a run in “"))
        throw new Error(
          `Another chat in the project is told: ${refused ?? "nothing"}`,
        );
      const stalledBar = () => {
        const found = chatPane(lead.id)?.querySelector<HTMLElement>(
          `[data-orchestration-bar="${lead.id}"]`,
        );
        return found?.querySelector('[data-state="stalled"]') && found;
      };
      await waitFor(
        stalledBar,
        90_000,
        "the bar to say the lead stopped without finishing",
      );
      // Watched from the bar, the team panel says so too, with the lead
      // and each agent.
      let watched = "";
      if (teamWorkspace()?.watch) {
        const teamId = `orchestrate:${lead.id}`;
        const tasks = orchestration.run(lead.id)?.tasks.length ?? 0;
        watched = await checkTeamPanel(
          teamId,
          () =>
            stalledBar()?.querySelector<HTMLElement>(
              `[data-team-watch="${teamId}"]`,
            ),
          (panel) => {
            if (
              !panel.querySelector(
                `[data-team-member="${lead.id}"][data-role="lead"]`,
              )
            )
              return "it has no row for the lead";
            const rows = panel.querySelectorAll(
              '[data-team-member][data-role="worker"]',
            ).length;
            if (rows !== tasks) return `it lists ${rows} agents, not ${tasks}`;
            const notice = panel.querySelector('[data-team-notice="stalled"]');
            if (!notice || !buttonNamed(notice as Element, "Finish run"))
              return "it does not say the lead stopped, with Finish run";
            if (!buttonNamed(panel, "Stop run")) return "it has no Stop run";
            return null;
          },
        );
        closeTeamPanel(teamId);
      }
      const bar = await waitFor(
        stalledBar,
        5_000,
        "the bar to still say the lead stopped",
      );
      const said = bar.textContent ?? "";
      if (!said.includes("The lead stopped without finishing"))
        throw new Error(`The bar reads "${said}"`);
      const finish = buttonNamed(bar, "Finish run");
      if (!finish || !buttonNamed(bar, "Ask the lead to wrap up"))
        throw new Error(
          `The bar offers ${[...bar.querySelectorAll("button")].map((button) => `"${button.textContent?.trim()}"`).join(", ")}`,
        );
      finish.click();
      await waitFor(
        () => orchestration.run(lead.id)?.status === "finished",
        10_000,
        "Finish run to end the run",
      );
      await waitFor(
        () =>
          !chatPane(lead.id)?.querySelector("[data-orchestration-bar]") &&
          proposalCard(lead.id)?.querySelector("[data-orchestration-status]")
            ?.textContent === "Finished",
        5_000,
        "the bar to go and the card to read Finished",
      );
      return `"${refused ?? "no other chat"}"; the bar offered Finish run, which ended the run${watched ? `; ${watched}` : ""}`;
    });

  // A two-lane race from the message box, with the stand-in Grok as the
  // second agent: compare, retry its failed lane, and keep Claude's mid-run.
  const race = get().race;
  if (safe && race)
    await step(
      "a race keeps one lane mid-run, with the files it wrote last",
      () => checkRace(get, config, race),
    );
  if (safe && race)
    await step(
      "a finished race is ready to compare, suggests a winner and continues with it",
      () => checkRaceResult(get, config, race),
    );

  // The project's board, opened from the title bar like a browser tab: a
  // chat added from the line for work outside the board gets a card, which
  // moves from Building to Review once a turn that edits a file ends, and
  // pressing the card opens the chat.
  if (safe && get().board)
    await step(
      "the board's card follows a chat from Building to Review and opens it",
      () => checkBoard(get, config.projectPath),
    );

  // A crew in the project, with the stand-in as each member: the Builder
  // works in the crew's copy with its rules, the Checker says not yet once,
  // Security passes, the card is Ready after round 2, Apply lands exactly
  // the reviewed change, and a turn prepared when the crew is turned off
  // never goes.
  const crew = get().crew;
  if (safe && crew)
    await step(
      "a crew builds, checks and secures a card, applies it as reviewed, and stops when off",
      () => checkCrew(get, config.projectPath, crew),
    );

  // The workspace's own key listener, as a key press reaches it: Cmd+, opens
  // Settings and Cmd+W closes the open utility rather than a pane.
  if (utilities)
    await step("keyboard shortcuts open Settings and close it", async () => {
      await expectOnScreen(null);
      pressShortcut(",");
      await expectOnScreen("settings");
      pressShortcut("w");
      await expectOnScreen(null);
    });

  // The restart-to-update question, shown with made-up work: it must name
  // each kind of work and offer its three actions. Closing it does nothing.
  const { previewRestartQuestion } = get();
  if (previewRestartQuestion)
    await step("restart question lists running work (preview)", async () => {
      if (!previewRestartQuestion())
        throw new Error("The restart question preview did not open");
      const dialog = await waitFor(
        () =>
          [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find(
            (element) =>
              element.textContent?.includes("Some work isn't finished"),
          ),
        10_000,
        "the restart question",
      );
      const text = dialog.textContent ?? "";
      for (const line of [
        "1 agent is working: Fix login (Aven)",
        "1 agent is waiting for your answer: Review PR (Cadence)",
        "1 terminal is running npm",
        "1 file has unsaved changes: App.tsx (Aven)",
      ])
        if (!text.includes(line))
          throw new Error(`The question omits "${line}"`);
      const buttons = [...dialog.querySelectorAll("button")].map(
        (button) => button.textContent?.trim() ?? "",
      );
      for (const action of [
        "Cancel",
        "Stop them and restart now",
        "Restart when they finish",
      ])
        if (!buttons.includes(action))
          throw new Error(`The question has no "${action}" action`);
      [...dialog.querySelectorAll("button")]
        .find((button) => button.textContent?.trim() === "Cancel")!
        .click();
      await waitFor(
        () => !dialog.isConnected,
        5_000,
        "the restart question to close",
      );
      return "2 agents, 1 terminal, 1 unsaved file; 3 actions";
    });

  const label = get().floatingSidebarLabel;
  if (label)
    await step("floating sidebar opens Settings and goes Back", async () => {
      // The card only opens while the sidebar is unpinned, and only then does
      // the workspace keep it current; unpin first, as a person would.
      if (get().sidebarOpen) {
        pressShortcut("b");
        await waitFor(
          () => get().sidebarOpen === false,
          5_000,
          "the sidebar to unpin",
        );
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      let stop: (() => void) | undefined;
      const report = new Promise<{
        ok: boolean;
        error?: string;
        note?: string;
      }>((resolve) => {
        void nativeFloatingSidebar
          .listen<{ ok: boolean; error?: string; note?: string }>(
            SMOKE_OVERLAY_RESULT_EVENT,
            resolve,
          )
          .then((unlisten) => (stop = unlisten));
      });
      try {
        await nativeFloatingSidebar.send(label, SMOKE_OVERLAY_EVENT, {});
        // A frozen sidebar never answers; that is the failure we look for.
        const result = await Promise.race([
          report,
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(new Error("The floating sidebar stopped responding")),
              45_000,
            ),
          ),
        ]);
        if (!result.ok) throw new Error(result.error ?? "Failed");
        return result.note;
      } finally {
        stop?.();
      }
    });

  // Last, as it removes the check's project. 0.1.139 refused to delete a
  // project while its terminal panel held a terminal, even a hidden one.
  const { projectPanel, deleteProject } = get();
  if (projectPanel && deleteProject)
    await step(
      "deleting a project closes its hidden terminal panel",
      async () => {
        const path = config.projectPath;
        projectPanel.toggle();
        const [terminal] = await waitFor(
          () => {
            const ids = projectPanel.terminalIds(path);
            return ids.length > 0 && ids;
          },
          10_000,
          "a terminal in the project's panel",
        );
        // An idle shell: a running process would rightly ask first.
        await waitForAsync(
          async () => {
            const status = await getPtyStatus(terminal).catch(() => null);
            return status !== null && !status.foreground;
          },
          10_000,
          "the panel's shell to start and go idle",
        );
        projectPanel.toggle();
        const refused = await withTimeout(
          deleteProject(path),
          30_000,
          "deleting the project",
        );
        const listed = (get().projects ?? []).some((project) =>
          sameProjectPath(project.path, path),
        );
        if (listed)
          throw new Error(
            `The project is still listed after Delete${refused ? `: ${refused}` : ""}`,
          );
        if (projectPanel.terminalIds(path).length > 0)
          throw new Error("The project's terminal panel was kept");
        await waitForAsync(
          async () =>
            getPtyStatus(terminal).then(
              () => false,
              () => true,
            ),
          5_000,
          "the panel's shell to end",
        );
      },
    );

  await finishDevSmoke(steps);
}

/** The sections the stand-in's keeper reply fills (scripts/smoke/fake-claude.py). */
const KEEPER_SECTIONS = [
  "## Stack",
  "## How to run",
  "## Conventions",
  "## In progress",
  "## Gotchas",
];

export async function checkMemoryKeeper(
  projectPath: string,
  readMemory: (path: string) => Promise<string>,
): Promise<string> {
  const offer = await waitFor(
    () =>
      [
        ...document.querySelectorAll<HTMLElement>("[data-memory-keeper-offer]"),
      ].find((element) => element.getClientRects().length > 0),
    10_000,
    "the offer to keep the project's memory",
  );
  const turnOn = [...offer.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "Turn on",
  );
  if (!turnOn) throw new Error("The offer has no Turn on button");
  turnOn.click();
  await waitFor(
    () => !document.querySelector("[data-memory-keeper-offer]"),
    5_000,
    "the offer to go once answered",
  );
  let body = "";
  try {
    await waitForAsync(
      async () => {
        body = await readMemory(projectPath);
        return body.includes(SMOKE_KEEPER_WORD);
      },
      45_000,
      "the keeper to fill the memory",
    );
  } catch (error) {
    const reason = getKeeperProject(projectPath).lastError;
    throw new Error(
      reason ? `${errorText(error)}: ${reason}` : errorText(error),
    );
  }
  const missing = KEEPER_SECTIONS.filter((section) => !body.includes(section));
  if (missing.length)
    throw new Error(`The memory has no ${missing.join(", ")}`);
  if (
    !body.startsWith("<!-- aven:auto") ||
    !body.includes("<!-- /aven:auto -->")
  )
    throw new Error("The keeper's sections are not in their own block");
  if (/note to ai|push straight to main/i.test(body))
    throw new Error("A line addressed to agents reached the memory");
  const state = getKeeperProject(projectPath);
  if (state.consent !== "on" || !state.change || state.change.kind !== "fill")
    throw new Error("Aven did not record the fill for its change note");
  return `${KEEPER_SECTIONS.length} sections, ${formatLineDiff(state.change)} by ${state.model ?? "?"}`;
}

async function waitForAsync(
  read: () => Promise<boolean>,
  timeoutMs: number,
  what: string,
): Promise<void> {
  const started = Date.now();
  while (!(await read())) {
    if (Date.now() - started > timeoutMs)
      throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  what: string,
): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out ${what}`)), timeoutMs),
    ),
  ]);
}

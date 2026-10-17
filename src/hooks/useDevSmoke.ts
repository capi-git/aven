import { useEffect, useRef } from "react";
import {
  devSmokeConfig,
  finishDevSmoke,
  SMOKE_OVERLAY_EVENT,
  SMOKE_OVERLAY_RESULT_EVENT,
  SMOKE_HEARD_WORD,
  SMOKE_JUMP_IN_WORD,
  SMOKE_KEEPER_WORD,
  SMOKE_REPLY,
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
import { errorText } from "../lib/errors";
import { getKeeperProject } from "../lib/memoryKeeper";
import { formatLineDiff } from "../lib/memoryKeeperFormat";
import { nativeFloatingSidebar } from "../lib/floatingSidebar";
import { resolveClaudeBinary } from "../lib/harness/child";
import { getPtyStatus } from "../lib/pty";
import { IS_MAC } from "../lib/platform";
import { runDevPerf, visibleComposer, type DevPerfOptions } from "./useDevPerf";
import { sameProjectPath } from "../lib/recents";
import type { DiscussionHost } from "../lib/discussions";
import { providerShortName } from "../lib/discussionVoices";
import { HARNESS_TITLE, type HarnessId, type Session } from "../lib/session";

type Options = DevPerfOptions & {
  sessions: Session[];
  /** The macOS floating sidebar's overlay, once attached. */
  floatingSidebarLabel: string | null;
  /** Whether this platform attaches the floating sidebar at all. */
  expectFloatingSidebar: boolean;
  /** The sidebar's "New task in <project>". */
  newProjectTask: (path: string) => void;
  submit: (sessionId: string, text: string) => void;
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
  /** Delete a project and its chats, as the sidebar's Delete does. */
  deleteProject?: (projectPath: string) => Promise<void>;
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

/** A new task in `path`, as the sidebar's New task opens one. */
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
  const title = card.querySelector(".discussion-card-title")?.textContent;
  if (state === "live") {
    if (!title?.endsWith("are discussing"))
      return `the card reads "${title ?? ""}"`;
    if (!card.querySelector("[data-discussion-card-watch]"))
      return "the card has no Watch";
    if (!card.querySelector("[data-discussion-card-stop]"))
      return "the card has no Stop";
  } else {
    if (title !== `Discussed for ${DISCUSSION_ROUNDS} rounds`)
      return `the finished card reads "${title ?? ""}"`;
    if (
      card.querySelector("[data-discussion-card-watch]")?.textContent !== "Open"
    )
      return "the finished card has no Open";
  }
  return null;
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
    return "the first chat's wrap-up has no Open discussion";
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
) {
  // Everything is looked up again after each press: the box re-renders.
  const inBox = <T extends Element>(selector: string) =>
    chatComposer(sessionId)?.querySelector<T>(selector) ?? null;
  const inMenu = <T extends Element>(selector: string) =>
    document
      .querySelector("[data-discussion-menu]")
      ?.querySelector<T>(selector) ?? null;
  const plus = await waitFor(
    () => inBox<HTMLButtonElement>('[aria-label="Add files or choose a mode"]'),
    5_000,
    "the chat's + menu",
  );
  plus.click();
  const menu = await waitFor(
    () => document.querySelector<HTMLElement>("[data-composer-plus]"),
    5_000,
    "the + menu",
  );
  const item = menu.querySelector<HTMLElement>("[data-composer-discuss]");
  if (!item?.textContent?.includes("Discuss")) {
    inBox<HTMLButtonElement>(
      '[aria-label="Add files or choose a mode"]',
    )?.click();
    throw new Error("The + menu does not offer Discuss");
  }
  item.click();
  const toggle = () =>
    inBox<HTMLElement>("[data-discussion-chip] [aria-haspopup]");
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
        ) &&
        inBox("[data-discussion-chip-label]")?.textContent?.includes(picked),
      5_000,
      `the chip to read "${picked}"`,
    );
  }
  const count = inMenu<HTMLElement>(`[data-discussion-rounds="${rounds}"]`);
  if (!count)
    throw new Error(`The Discuss dropdown offers no ${rounds} rounds`);
  count.click();
  await waitFor(
    () =>
      inBox("[data-discussion-chip-label]")?.textContent?.includes(
        `${rounds} rounds`,
      ),
    5_000,
    `the chip to read ${rounds} rounds`,
  );
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

/**
 * Why a tab holding a chat beside a file pane does not draw one bar per
 * pane, panes as cards and one tab style, or null with what it measured.
 * `file` is any element in the file's pane.
 */
export function paneLayoutProblem(file: HTMLElement): {
  problem: string | null;
  summary: string;
} {
  const fail = (problem: string) => ({ problem, summary: "" });
  const card = file.closest<HTMLElement>(".workspace-stage-surface");
  const stage = card?.closest<HTMLElement>("[data-workspace-stage]");
  if (!card || !stage) return fail("the file is not in a workspace pane");
  const chat = [
    ...card.querySelectorAll<HTMLElement>("[data-session-drop]"),
  ].find((pane) => pane.getClientRects().length > 0);
  if (!chat) return fail("no chat is beside the file");
  // One bar: moving and closing the chat float over it, taking no row.
  const controls = chat.querySelector<HTMLElement>(
    ":scope > [data-session-pane-controls]",
  );
  if (!controls) return fail("the split chat has no move and close controls");
  if (getComputedStyle(controls).position !== "absolute")
    return fail("the split chat's controls take a row of their own");
  const chatTop = chat.getBoundingClientRect().top;
  const content = [...chat.children].find(
    (child) =>
      child instanceof HTMLElement &&
      getComputedStyle(child).position !== "absolute",
  );
  const offset = content ? content.getBoundingClientRect().top - chatTop : 0;
  if (Math.abs(offset) > 1)
    return fail(
      `the split chat's content starts ${Math.round(offset)}px below a second header`,
    );
  // A card: rounded, with a hairline edge, clear of the workspace's edges.
  const style = getComputedStyle(card);
  const radius = parseFloat(style.borderTopLeftRadius);
  if (!(radius >= 6)) return fail(`the pane's corners are ${radius}px`);
  if (parseFloat(style.borderTopWidth) !== 1)
    return fail(`the pane's edge is ${style.borderTopWidth}`);
  const cardRect = card.getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  const inset = Math.min(
    cardRect.left - stageRect.left,
    cardRect.top - stageRect.top,
    stageRect.right - cardRect.right,
    stageRect.bottom - cardRect.bottom,
  );
  if (inset < 3) return fail(`the card is ${inset}px from the workspace edge`);
  // One tab style: the tab strip above the chat and the file pane's tabs.
  const header = stage.querySelector<HTMLElement>(
    `:scope > [data-workspace-header="${card.dataset.workspaceSurface}"]`,
  );
  const chatTab = header?.querySelector<HTMLElement>(".aven-tab-button");
  const fileBar = file
    .closest<HTMLElement>("[data-pane-id]")
    ?.querySelector<HTMLElement>(".aven-surface-tabs");
  const fileTab = fileBar?.querySelector<HTMLElement>(".aven-tab-button");
  if (!header || !chatTab || !fileBar || !fileTab)
    return fail("the chat or the file has no tab");
  const height = (element: HTMLElement) =>
    Math.round(element.getBoundingClientRect().height);
  if (height(header) !== height(fileBar))
    return fail(
      `the chat's tab bar is ${height(header)}px and the file's is ${height(fileBar)}px`,
    );
  const look = (element: HTMLElement) => {
    const tab = getComputedStyle(element);
    return `${height(element)}px tall, ${tab.borderTopLeftRadius} corners`;
  };
  if (look(chatTab) !== look(fileTab))
    return fail(
      `the chat's tab is ${look(chatTab)} and the file's is ${look(fileTab)}`,
    );
  return {
    problem: null,
    summary: `one bar per pane; cards with ${radius}px corners ${Math.round(inset)}px from the edge; chat and file tabs ${look(chatTab)}`,
  };
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

  // The composer's agent pill opens one panel with the model list, its
  // settings and access, focused on the model search; Escape closes it and
  // hands the keyboard back to the message.
  if (safe && typedTask && get().utilities)
    await step(
      "the agent pill opens its panel and Escape returns",
      async () => {
        const composer = await waitFor(
          visibleComposer,
          5_000,
          "the message box",
        );
        const pill = composer
          .closest("[data-composer]")
          ?.querySelector<HTMLButtonElement>("[data-agent-pill]");
        if (!pill) throw new Error("The composer has no agent pill");
        pill.click();
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
        return pill.getAttribute("aria-label") ?? undefined;
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
  // Right now and today's recap; then the sidebar's New task pressed over
  // Home leaves it for the new chat.
  if (safe && typedTask && motion)
    await step(
      "Home shows each project's agent, and New task leaves Home for the chat",
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
        "Home to give way to the new task",
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
        await startDiscussionFromComposer(
          a.id,
          { newWith: "claude" },
          `Compare notes. AVEN_SMOKE_HOLD ${DISCUSSION_HOLD_MS}`,
          DISCUSSION_ROUNDS,
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
        if (!barText.includes(`round 1 of ${DISCUSSION_ROUNDS}`))
          throw new Error(`The discussion bar reads "${barText}"`);
        if (!barText.includes("Open discussion"))
          throw new Error("The discussion bar has no Open discussion");
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

        const note = `Discussion ended after ${DISCUSSION_ROUNDS} rounds.`;
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
        // Closed, the panel comes back from the finished card's Open.
        discussionPanel(id)
          ?.querySelector<HTMLElement>("[data-discussion-close]")
          ?.click();
        await waitFor(
          () => !discussionPanel(id) && !discussionPill(id),
          5_000,
          "the panel to close",
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
        return `started from Discuss mode with a new chat, no tab; one live card in the first chat and its panel open; the panel showed the second chat typing and your message from its box waiting; ${moved}; shrunk to a pill and back; 4 replies relayed once each; your message reached both chats once; the panel shows the whole thread with an agreeing mark and where they landed; the card says it discussed for 2 rounds, followed by where they landed, its lists kept; "${label}" sent the plan; the finished card reopens the panel`;
      },
    );

  // A file opened beside a chat: a tab with a chat and a file pane, drawn
  // with one bar per pane, as cards, and with one tab style.
  const openFile = get().openFile;
  if (safe && get().paneLayout && openFile)
    await step(
      "a chat beside a file has one bar, a card and the shared tabs",
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
        return result.summary;
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
        await withTimeout(deleteProject(path), 30_000, "deleting the project");
        const listed = (get().projects ?? []).some((project) =>
          sameProjectPath(project.path, path),
        );
        if (listed) throw new Error("The project is still listed after Delete");
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

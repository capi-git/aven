import { useEffect, useRef } from "react";
import {
  devSmokeConfig,
  finishDevSmoke,
  SMOKE_OVERLAY_EVENT,
  SMOKE_OVERLAY_RESULT_EVENT,
  SMOKE_REPLY,
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
import { nativeFloatingSidebar } from "../lib/floatingSidebar";
import { resolveClaudeBinary } from "../lib/harness/child";
import { getPtyStatus } from "../lib/pty";
import { IS_MAC } from "../lib/platform";
import { runDevPerf, visibleComposer, type DevPerfOptions } from "./useDevPerf";
import { sameProjectPath } from "../lib/recents";
import type { DiscussionHost } from "../lib/discussions";
import type { Session } from "../lib/session";

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
  /** Starts discussions between chats, as the composer's picker does. */
  discussion?: DiscussionHost;
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

/** Open the visible chat's + menu, find Discuss with…, and close it again. */
async function expectDiscussEntry(sessionId: string) {
  const composer = await waitFor(
    () => {
      const field = visibleComposer();
      return (
        field
          ?.closest(`[data-session-drop="${sessionId}"]`)
          ?.querySelector<HTMLElement>("[data-composer]") ?? null
      );
    },
    5_000,
    "the new chat's message box",
  );
  const plus = composer.querySelector<HTMLButtonElement>(
    '[aria-label="Add files or choose a mode"]',
  );
  if (!plus) throw new Error("The message box has no + menu");
  plus.click();
  try {
    await waitFor(
      () => document.querySelector("[data-composer-plus]"),
      5_000,
      "the + menu",
    );
    if (!document.querySelector("[data-composer-discuss]"))
      throw new Error("The + menu does not offer Discuss with…");
  } finally {
    if (document.querySelector("[data-composer-plus]")) plus.click();
  }
  await waitFor(
    () => !document.querySelector("[data-composer-plus]"),
    5_000,
    "the + menu to close",
  );
}

/** One run per app, even when React mounts the workspace twice. */
let started = false;

/**
 * Aven Dev's real-app check, run by the workspace only when the debug app was
 * launched by `scripts/dev-aven.py --smoke`: send one turn to a stand-in
 * provider through the normal send path with the floating sidebar attached,
 * open and close the utility views by handler and by shortcut, watch what
 * moves while an agent works and when its turn ends (the sidebar's mark, Home
 * and Parallel work), run a two-round discussion between two chats, check
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

  // Two chats discuss a topic, started the way the composer's picker starts
  // one. While the second chat answers, the sidebar links both rows and the
  // bar counts the round; every reply is relayed once, and both chats get
  // the closing note.
  const discussion = get().discussion;
  if (safe && discussion)
    await step(
      "two chats discuss for two rounds, linked in the sidebar",
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
        const b = await openNewTask(get, config.projectPath);
        // The chat's own + menu offers it, so the picker can be reached.
        await expectDiscussEntry(b.id);
        const refused = discussion.start({
          sessionId: a.id,
          partner: { kind: "chat", sessionId: b.id },
          topic: `Compare notes. AVEN_SMOKE_HOLD ${DISCUSSION_HOLD_MS}`,
          rounds: DISCUSSION_ROUNDS,
        });
        if (refused)
          throw new Error(`The discussion did not start: ${refused}`);
        const session = (id: string) =>
          get().sessions.find((entry) => entry.id === id);

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
        const id = relayed.discussion!.id;
        await waitFor(
          () =>
            document.querySelector(
              `[data-session-drop="${b.id}"] [data-discussion-relay="${id}"]`,
            ),
          5_000,
          "the relay card on the relayed message",
        );
        const bar = await waitFor(
          () =>
            visibleComposer()
              ?.closest("[data-composer]")
              ?.querySelector<HTMLElement>(`[data-discussion-bar="${id}"]`),
          5_000,
          "the discussion bar above the message box",
        );
        const barText = bar.textContent?.replace(/\s+/g, " ").trim() ?? "";
        if (!barText.includes(`round 1 of ${DISCUSSION_ROUNDS}`))
          throw new Error(`The discussion bar reads "${barText}"`);
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
        return prefersReducedMotion()
          ? "4 replies relayed once each; linked, still (reduced motion); ended after 2 rounds"
          : "4 replies relayed once each; linked with the pulse toward the answering chat; ended after 2 rounds";
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

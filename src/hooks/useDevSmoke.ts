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
import { errorText } from "../lib/errors";
import { nativeFloatingSidebar } from "../lib/floatingSidebar";
import { resolveClaudeBinary } from "../lib/harness/child";
import { getPtyStatus } from "../lib/pty";
import { IS_MAC } from "../lib/platform";
import { runDevPerf, visibleComposer, type DevPerfOptions } from "./useDevPerf";
import { sameProjectPath } from "../lib/recents";
import type { Session } from "../lib/session";

type Options = DevPerfOptions & {
  sessions: Session[];
  /** The macOS floating sidebar's overlay, once attached. */
  floatingSidebarLabel: string | null;
  /** Whether this platform attaches the floating sidebar at all. */
  expectFloatingSidebar: boolean;
  newProjectTask: (path: string) => void;
  submit: (sessionId: string, text: string) => void;
  /** The workspace's own utility views, opened as their buttons would. */
  utilities?: SmokeUtilities;
  /** Remembered projects, for checking that a deleted one is gone. */
  projects?: readonly { path: string }[];
  /** The current project's terminal panel. */
  projectPanel?: {
    toggle: () => void;
    terminalIds: (projectPath: string) => string[];
  };
  /** Delete a project and its chats, as the sidebar's Delete does. */
  deleteProject?: (projectPath: string) => Promise<void>;
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

/** One run per app, even when React mounts the workspace twice. */
let started = false;

/**
 * Aven Dev's real-app check, run by the workspace only when the debug app was
 * launched by `scripts/dev-aven.py --smoke`: send one turn to a stand-in
 * provider through the normal send path with the floating sidebar attached,
 * open and close the utility views by handler and by shortcut, then have the
 * floating sidebar open Settings and press Back, then report.
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

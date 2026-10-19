import { useCallback, useEffect, useRef } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { FocusDir, SplitDir } from "../lib/layout";
import { NOTIFICATION_CLICK_EVENT } from "../lib/notifications";
import type { Session } from "../lib/session";
import type { SettingsSectionId } from "../lib/settings";
import { shouldHandleListNavigation, tabCommand } from "../lib/tabKeys";
import {
  applyUiScale,
  loadUiScale,
  saveUiScale,
  UI_SCALE_DEFAULT,
  uiScaleCommand,
  zoomInUiScale,
  zoomOutUiScale,
} from "../lib/uiScale";
import { runUpdateFlow } from "../lib/updater";
import { startTour } from "../lib/tour";
import { listenInThisWindow } from "../lib/windowMenuEvents";
import {
  hasWorkspaceOverlay,
  workspaceShortcutDisposition,
} from "../lib/workspaceKeyboard";
import {
  handleEditorFindKey,
  indentFocusedEditor,
  openFindInActiveEditor,
} from "../surfaces/editorCommands";
import { closeFocusedTeamPanel } from "../lib/teamPanelFocus";

/** What shortcuts, menu commands and the command palette can do. */
export type WorkspaceActions = {
  onNew: () => void;
  onReopenClosedTab: () => Promise<unknown>;
  onArchiveFocusedSession: (event: KeyboardEvent) => void;
  onCloseOtherTabs: () => void;
  onClosePane: (sessionId?: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onVisitBack: () => void;
  onVisitForward: () => void;
  onActivate: (slot: number) => void;
  onSplit: (dir: SplitDir) => void;
  onFocusDir: (dir: FocusDir) => void;
  onToggleSidebar: () => void;
  onToggleInspector: () => void;
  onGoToFile: () => void;
  onFindInProject: () => void;
  onOpenSearch: () => void;
  onOpenPalette: () => void;
  onOpenInbox: () => void;
  onOpenAutomations: () => void;
  onOpenNotes: () => void;
  pickProject: () => Promise<unknown>;
  onNewTerminal: () => void;
  onNewTerminalTab: () => void;
  onToggleProjectTerminal: () => void;
  onNavigateSessionList: (delta: number) => void;
  onNavigateProjectList: (delta: number) => void;
  openSettings: (section?: SettingsSectionId) => void;
  onOpenApprovalSession: (sessionId: string) => Promise<boolean>;
};

type Flag = { readonly current: boolean };

type Options = {
  /** The latest actions; shortcuts always call the current ones. */
  actions: WorkspaceActions;
  /** From `useUtilityViews`. */
  utilityViews: {
    settingsOpenRef: Flag;
    searchViewOpenRef: Flag;
    inboxViewOpenRef: Flag;
    automationsViewOpenRef: Flag;
    notesViewOpenRef: Flag;
    filePickerOpenRef: Flag;
    closeUtilityViews: () => void;
    restoreReturnFocus: () => void;
  };
  workspaceVisibleRef: Flag;
  whatsNewVersionRef: { readonly current: string | null };
  sessionsRef: { readonly current: Session[] };
};

/**
 * The workspace's keyboard shortcuts, native menu commands, UI zoom and
 * notification clicks. Keys are caught in the capture phase, after listeners
 * registered earlier, so call this where the order matters. Returns the
 * latest actions for the command palette.
 */
export function useWorkspaceShortcuts({
  actions: latest,
  utilityViews: {
    settingsOpenRef,
    searchViewOpenRef,
    inboxViewOpenRef,
    automationsViewOpenRef,
    notesViewOpenRef,
    filePickerOpenRef,
    closeUtilityViews,
    restoreReturnFocus,
  },
  workspaceVisibleRef,
  whatsNewVersionRef,
  sessionsRef,
}: Options): { readonly current: WorkspaceActions } {
  const actions = useRef(latest);
  actions.current = latest;

  const notificationRouteClaims = useRef(new Map<string, number>());
  const notificationRouteTimers = useRef(new Set<number>());
  const debounce = useRef({ name: "", at: 0 });
  const run = useCallback(
    (name: string, fn: () => void) => {
      const disposition = workspaceShortcutDisposition(name, {
        overlay: hasWorkspaceOverlay(),
        utility:
          settingsOpenRef.current ||
          searchViewOpenRef.current ||
          inboxViewOpenRef.current ||
          automationsViewOpenRef.current ||
          notesViewOpenRef.current,
        workspace: workspaceVisibleRef.current,
      });
      if (disposition === "block") return;
      if (disposition === "dismiss-utility") {
        closeUtilityViews();
        restoreReturnFocus();
        return;
      }
      const now = performance.now();
      if (name === debounce.current.name && now - debounce.current.at < 80)
        return;
      debounce.current = { name, at: now };
      fn();
    },
    [
      restoreReturnFocus,
      closeUtilityViews,
      settingsOpenRef,
      searchViewOpenRef,
      inboxViewOpenRef,
      automationsViewOpenRef,
      notesViewOpenRef,
      workspaceVisibleRef,
    ],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Browser-standard UI zoom. Runs before tabCommand and always applies —
      // even in inputs and the terminal — so Ctrl/Cmd + - 0 behave like a browser.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.isComposing) {
        const zoom = uiScaleCommand(e);
        if (zoom) {
          e.preventDefault();
          e.stopPropagation();
          if (zoom === "zoom-in") {
            const next = saveUiScale(zoomInUiScale(loadUiScale()));
            void applyUiScale(next);
          } else if (zoom === "zoom-out") {
            const next = saveUiScale(zoomOutUiScale(loadUiScale()));
            void applyUiScale(next);
          } else {
            saveUiScale(UI_SCALE_DEFAULT);
            void applyUiScale(UI_SCALE_DEFAULT);
          }
          return;
        }
      }
      const cmd = tabCommand(e);
      if (cmd) {
        if (cmd === "archive-session") {
          actions.current.onArchiveFocusedSession(e);
          return;
        }
        const target = e.target instanceof Element ? e.target : null;
        const listNavigation =
          cmd === "prev-session" ||
          cmd === "next-session" ||
          cmd === "prev-project" ||
          cmd === "next-project";
        if (listNavigation) {
          const blockedTarget = Boolean(
            target?.closest(
              'input, textarea, select, [contenteditable="true"], .cm-editor, .aven-terminal, [role="dialog"], [data-model-picker], [data-file-picker], [data-branch-picker], [data-skill-picker], [data-mention-picker], [data-app-search]',
            ),
          );
          const emptyComposerTarget = Boolean(
            target?.matches('textarea[data-composer-empty="true"]'),
          );
          const surfaceOpen =
            searchViewOpenRef.current ||
            inboxViewOpenRef.current ||
            automationsViewOpenRef.current ||
            notesViewOpenRef.current ||
            settingsOpenRef.current ||
            filePickerOpenRef.current ||
            Boolean(whatsNewVersionRef.current);
          if (
            !shouldHandleListNavigation({
              blockedTarget,
              emptyComposerTarget,
              surfaceOpen,
            })
          ) {
            return;
          }
        }
        if (
          target?.closest(".aven-terminal") &&
          e.ctrlKey &&
          !e.metaKey &&
          (cmd === "back" ||
            cmd === "forward" ||
            /Mac|iPhone|iPad/.test(navigator.platform))
        ) {
          return;
        }
        if (
          (cmd === "split-right" || cmd === "split-down") &&
          target?.closest(".cm-editor")
        ) {
          return;
        }
        if (
          (cmd === "back" || cmd === "forward") &&
          target?.closest(".cm-editor")
        ) {
          e.preventDefault();
          e.stopPropagation();
          run(cmd, () => {
            indentFocusedEditor(cmd === "back" ? "less" : "more");
          });
          return;
        }
        const inPicker =
          target &&
          target.closest(
            "[data-model-picker], [data-file-picker], [data-branch-picker], [data-skill-picker], [data-mention-picker], [data-app-search]",
          );
        if (inPicker && typeof cmd === "object" && "activate" in cmd) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        const a = actions.current;
        if (cmd === "new") run("new", a.onNew);
        else if (cmd === "reopen")
          run("reopen", () => {
            void a.onReopenClosedTab();
          });
        else if (cmd === "close-others")
          run("close-others", a.onCloseOtherTabs);
        else if (cmd === "close")
          run("close", () => {
            if (!closeFocusedTeamPanel()) a.onClosePane();
          });
        else if (cmd === "next") run("next", a.onNext);
        else if (cmd === "prev") run("prev", a.onPrev);
        else if (cmd === "back") run("back", a.onVisitBack);
        else if (cmd === "forward") run("forward", a.onVisitForward);
        else if (cmd === "split-right")
          run("split-right", () => a.onSplit("right"));
        else if (cmd === "split-down")
          run("split-down", () => a.onSplit("down"));
        else if (cmd === "new-terminal") run("new-terminal", a.onNewTerminal);
        else if (cmd === "new-terminal-tab")
          run("new-terminal-tab", a.onNewTerminalTab);
        else if (cmd === "toggle-terminal")
          run("toggle-terminal", a.onToggleProjectTerminal);
        else if (cmd === "prev-session")
          run("prev-session", () => a.onNavigateSessionList(-1));
        else if (cmd === "next-session")
          run("next-session", () => a.onNavigateSessionList(1));
        else if (cmd === "prev-project")
          run("prev-project", () => a.onNavigateProjectList(-1));
        else if (cmd === "next-project")
          run("next-project", () => a.onNavigateProjectList(1));
        else if ("focus" in cmd)
          run(`focus-${cmd.focus}`, () => a.onFocusDir(cmd.focus));
        else run(`activate-${cmd.activate}`, () => a.onActivate(cmd.activate));
        return;
      }
      if (
        !searchViewOpenRef.current &&
        !inboxViewOpenRef.current &&
        !automationsViewOpenRef.current &&
        !notesViewOpenRef.current &&
        handleEditorFindKey(e)
      ) {
        e.stopPropagation();
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.altKey && e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        e.stopPropagation();
        run("toggle_inspector", actions.current.onToggleInspector);
        return;
      }
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        e.stopPropagation();
        run("toggle_sidebar", actions.current.onToggleSidebar);
        return;
      }
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        e.stopPropagation();
        run("go_to_file", actions.current.onGoToFile);
        return;
      }
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        const target = e.target instanceof Element ? e.target : null;
        if (target?.closest(".aven-terminal") && e.ctrlKey && !e.metaKey) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        run("open_palette", actions.current.onOpenPalette);
        return;
      }
      if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopPropagation();
        run("open_search", actions.current.onOpenSearch);
        return;
      }
      if (mod && !e.altKey && !e.shiftKey && e.key === ",") {
        e.preventDefault();
        e.stopPropagation();
        run("open_settings", () => actions.current.openSettings());
        return;
      }
      if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        e.stopPropagation();
        run("find_in_project", actions.current.onFindInProject);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [
    run,
    settingsOpenRef,
    searchViewOpenRef,
    inboxViewOpenRef,
    automationsViewOpenRef,
    notesViewOpenRef,
    filePickerOpenRef,
    whatsNewVersionRef,
  ]);

  useEffect(() => {
    const unlisten: Array<Promise<() => void>> = [
      listen("new_tab", () => run("new", actions.current.onNew)),
      listen("close_other_tabs", () =>
        run("close-others", actions.current.onCloseOtherTabs),
      ),
      listen("close_tab", () =>
        run("close", () => {
          // In the floating team panel, ⌘W closes the panel, not the
          // chat pane behind it.
          if (closeFocusedTeamPanel()) return;
          actions.current.onClosePane();
        }),
      ),
      listen("next_tab", () => run("next", actions.current.onNext)),
      listen("prev_tab", () => run("prev", actions.current.onPrev)),
      listen("back_tab", () =>
        run("back", () => {
          if (!indentFocusedEditor("less")) actions.current.onVisitBack();
        }),
      ),
      listen("forward_tab", () =>
        run("forward", () => {
          if (!indentFocusedEditor("more")) actions.current.onVisitForward();
        }),
      ),
      listen("split_right", () =>
        run("split-right", () => actions.current.onSplit("right")),
      ),
      listen("split_down", () =>
        run("split-down", () => actions.current.onSplit("down")),
      ),
      listen("new_terminal", () =>
        run("new-terminal", actions.current.onNewTerminal),
      ),
      listen("new_terminal_tab", () =>
        run("new-terminal-tab", actions.current.onNewTerminalTab),
      ),
      listen("toggle_terminal", () =>
        run("toggle-terminal", actions.current.onToggleProjectTerminal),
      ),
      listen("focus_left", () =>
        run("focus-left", () => actions.current.onFocusDir("left")),
      ),
      listen("focus_right", () =>
        run("focus-right", () => actions.current.onFocusDir("right")),
      ),
      listen("focus_up", () =>
        run("focus-up", () => actions.current.onFocusDir("up")),
      ),
      listen("focus_down", () =>
        run("focus-down", () => actions.current.onFocusDir("down")),
      ),
      listenInThisWindow("toggle_sidebar", () =>
        run("toggle_sidebar", actions.current.onToggleSidebar),
      ),
      listenInThisWindow("toggle_inspector", () =>
        run("toggle_inspector", actions.current.onToggleInspector),
      ),
      // Help › Take the Tour Again: the workspace runs the tour.
      listenInThisWindow("take_tour", () => startTour()),
      listen("open_project", () => {
        void actions.current.pickProject();
      }),
      listen("go_to_file", () => actions.current.onGoToFile()),
      listen("open_search", () => actions.current.onOpenSearch()),
      listen("open_palette", () => actions.current.onOpenPalette()),
      listen("open_inbox", () => actions.current.onOpenInbox()),
      listen("open_automations", () => actions.current.onOpenAutomations()),
      listen("open_notes", () => actions.current.onOpenNotes()),
      listen("open_settings", () => actions.current.openSettings()),
      listen("check_for_updates", () => {
        void runUpdateFlow(true);
      }),
      listen("sidebar_opacity", () => {
        actions.current.openSettings("appearance");
      }),
      listen("find_in_project", () => actions.current.onFindInProject()),
      listen("find", () => {
        openFindInActiveEditor();
      }),
      listen("open_model_picker", () => {
        window.dispatchEvent(new Event("open_model_picker"));
      }),
      listen<string>(
        "monocode:notification-route-claim",
        ({ payload: sessionId }) => {
          notificationRouteClaims.current.set(sessionId, Date.now());
          if (notificationRouteClaims.current.size > 40)
            notificationRouteClaims.current.delete(
              notificationRouteClaims.current.keys().next().value!,
            );
        },
      ),
      listen<string>(NOTIFICATION_CLICK_EVENT, ({ payload: sessionId }) => {
        if (typeof sessionId !== "string" || !sessionId) return;
        if (sessionsRef.current.some((session) => session.id === sessionId)) {
          void emit("monocode:notification-route-claim", sessionId);
          void actions.current.onOpenApprovalSession(sessionId);
          return;
        }
        if (getCurrentWindow().label !== "main") return;
        const clickedAt = Date.now();
        const timer = window.setTimeout(() => {
          notificationRouteTimers.current.delete(timer);
          if (
            (notificationRouteClaims.current.get(sessionId) ?? 0) >=
            clickedAt - 50
          )
            return;
          void actions.current.onOpenApprovalSession(sessionId);
        }, 200);
        notificationRouteTimers.current.add(timer);
      }),
      listenInThisWindow("zoom_in", () => {
        const next = zoomInUiScale(loadUiScale());
        saveUiScale(next);
        void applyUiScale(next);
      }),
      listenInThisWindow("zoom_out", () => {
        const next = zoomOutUiScale(loadUiScale());
        saveUiScale(next);
        void applyUiScale(next);
      }),
      listenInThisWindow("zoom_reset", () => {
        saveUiScale(UI_SCALE_DEFAULT);
        void applyUiScale(UI_SCALE_DEFAULT);
      }),
    ];
    return () => {
      for (const timer of notificationRouteTimers.current)
        window.clearTimeout(timer);
      notificationRouteTimers.current.clear();
      void Promise.all(unlisten).then((fns) => fns.forEach((fn) => fn()));
    };
  }, [run]);

  return actions;
}

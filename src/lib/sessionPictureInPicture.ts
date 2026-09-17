import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { SessionPane } from "../surfaces/SessionPane";
import { sessionWorkCwd, type Session } from "./session";
import { sameProjectPath, type RecentProject } from "./recents";
import { registerWorkspaceDraftFlusher } from "./workspaceDraftFlush";
import {
  allModels,
  getModelSnapshot,
  subscribeModels,
  type AgentModel,
} from "./models";
import { peekSkills } from "./skills";
import type { NativeCommand } from "./harness/nativeCommands";
import {
  flushComposerDrafts,
  readComposerDraft,
  importComposerDraft,
  sanitizeComposerDraft,
  type ComposerDraft,
} from "./composerDrafts";

export type SessionPaneProps = ComponentProps<typeof SessionPane>;
export const SESSION_PIP_CALLBACKS = [
  "onCwdChange",
  "onBranchChange",
  "onModelChange",
  "onModelSettingsChange",
  "onRuntimeModeChange",
  "onSubmit",
  "onStop",
  "onCompactContext",
  "onDeleteQueuedMessage",
  "onEditQueuedMessage",
  "onQueuedMessageEditingChange",
  "onSteerQueuedMessage",
  "onResumeQueue",
  "onInboxCardDismiss",
  "onNoteCardDismiss",
  "onHandoffCardDismiss",
  "onApproval",
  "onQuestionReply",
  "onOpenFile",
  "onOpenUrl",
  "onOpenDiff",
  "onOpenPlan",
  "onBuildPlan",
  "onSecondOpinion",
  "onHandoff",
  "onNewTerminal",
] as const satisfies readonly (keyof SessionPaneProps)[];
export type SessionPipCallback = (typeof SESSION_PIP_CALLBACKS)[number];
export type SessionPipSharedProps = Pick<
  SessionPaneProps,
  SessionPipCallback | "recents" | "hideProjectPicker" | "reviewUndoLocked"
>;
export type SessionPipTheme = {
  scheme: "dark" | "light";
  variables: Record<string, string>;
};
export type SessionPictureInPictureState = {
  session: Session;
  recents: RecentProject[];
  hideProjectPicker?: boolean;
  reviewUndoLocked?: boolean;
  draft?: ComposerDraft;
  theme?: SessionPipTheme;
  actions?: SessionPipCallback[];
  catalog?: AgentModel[];
  catalogVersion?: number;
  nativeCommands?: NativeCommand[];
};
export type SessionPipEnvelope = {
  id: string;
  state: SessionPictureInPictureState;
  pinned: boolean;
};
export type SessionPipAction = { id: string; action: string; args: unknown[] };
export type SessionPipClosed = { id: string; draft?: ComposerDraft };

export const nativeSessionPip = {
  open: (id: string, title: string, state: SessionPictureInPictureState) =>
    invoke<string>("session_pip_open", { id, title, state }),
  update: (id: string, state: SessionPictureInPictureState) =>
    invoke<void>("session_pip_update", { id, state }),
  getState: () => invoke<SessionPipEnvelope>("session_pip_get_state"),
  action: (action: string, args: unknown[]) =>
    invoke<void>("session_pip_action", { action, args }),
  draft: (draft?: ComposerDraft, flushRequestId?: string) =>
    invoke<void>("session_pip_draft", {
      draft: draft ?? null,
      ...(flushRequestId ? { flushRequestId } : {}),
    }),
  flushAll: () => invoke<SessionPipClosed[]>("session_pip_flush_all"),
  returnSession: (draft?: ComposerDraft) =>
    invoke<void>("session_pip_return", { draft: draft ?? null }),
  setPinned: (pinned: boolean) =>
    invoke<void>("session_pip_set_pinned", { pinned }),
  show: (id: string) => invoke<void>("session_pip_show", { id }),
  close: (id: string) => invoke<void>("session_pip_close", { id }),
  listen: <T>(name: string, callback: (payload: T) => void) =>
    getCurrentWebview().listen<T>(name, ({ payload }) => callback(payload)),
};

const THEME_VARIABLES = [
  "--theme-hue",
  "--theme-saturation",
  "--theme-background-color",
  "--theme-light-surface-color",
  "--theme-content-color",
  "--theme-accent-color",
  "--theme-highlight-color",
  "--color-background-base",
  "--color-content",
  "--color-accent",
  "--color-highlight",
  "--background-lightness",
  "--content-lightness",
  "--link-color",
  "--color-skill",
  "--color-mention",
  "--color-markdown-heading",
  "--personal-frame",
  "--personal-main-surface",
  "--personal-accent",
  "--personal-muted",
  "--personal-line",
  "--personal-hover",
  "--personal-selected",
] as const;

export function captureSessionPipTheme(): SessionPipTheme {
  const style = getComputedStyle(
    document.querySelector(".personal-shell") ?? document.documentElement,
  );
  const variables: Record<string, string> = {};
  for (const name of THEME_VARIABLES) {
    const value = style.getPropertyValue(name).trim();
    if (value) variables[name] = value;
  }
  return {
    scheme: document.documentElement.classList.contains("theme-light")
      ? "light"
      : "dark",
    variables,
  };
}

/** Local view styling only; no appearance preferences or native glass settings are written. */
export function applySessionPipTheme(theme?: SessionPipTheme) {
  if (!theme) return;
  const root = document.documentElement;
  root.classList.toggle("theme-light", theme.scheme === "light");
  for (const name of THEME_VARIABLES) {
    const value = theme.variables?.[name];
    if (
      typeof value === "string" &&
      value.length < 1000 &&
      !/url\s*\(|[;{}]/i.test(value)
    )
      root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }
  window.dispatchEvent(
    new CustomEvent("monocode:schemechange", { detail: theme.scheme }),
  );
}

export function parseSessionPipEnvelope(
  value: unknown,
): SessionPipEnvelope | null {
  if (!value || typeof value !== "object") return null;
  const envelope = value as Partial<SessionPipEnvelope>;
  const state = envelope.state;
  if (
    typeof envelope.id !== "string" ||
    !state ||
    !state.session ||
    state.session.id !== envelope.id ||
    !Array.isArray(state.session.blocks) ||
    !Array.isArray(state.recents)
  )
    return null;
  return {
    id: envelope.id,
    pinned: envelope.pinned === true,
    state: {
      ...state,
      draft: sanitizeComposerDraft(state.draft),
      actions: Array.isArray(state.actions)
        ? state.actions.filter((name) => SESSION_PIP_CALLBACKS.includes(name))
        : undefined,
    },
  };
}

export function validSessionPipAction(
  value: unknown,
  openIds: ReadonlySet<string>,
): value is SessionPipAction {
  if (!value || typeof value !== "object") return false;
  const action = value as Partial<SessionPipAction>;
  if (
    typeof action.id !== "string" ||
    !openIds.has(action.id) ||
    !Array.isArray(action.args)
  )
    return false;
  if (action.action === "draft" || action.action === "quit")
    return (
      action.args.length <= 1 &&
      (action.args[0] == null || !!sanitizeComposerDraft(action.args[0]))
    );
  if (!SESSION_PIP_CALLBACKS.includes(action.action as SessionPipCallback))
    return false;
  if (action.action === "onOpenFile") return typeof action.args[0] === "string";
  if (action.action === "onOpenUrl") return typeof action.args[0] === "string" && /^https?:\/\//i.test(action.args[0]);
  if (action.action === "onOpenDiff") {
    const session = action.args[1] as { sessionId?: unknown } | undefined;
    return (
      (action.args[0] == null || typeof action.args[0] === "string") &&
      (session == null || session.sessionId === action.id)
    );
  }
  return action.args[0] === action.id;
}

const OWNER_UI_ACTIONS = new Set<SessionPipCallback>([
  "onOpenFile",
  "onOpenUrl",
  "onOpenDiff",
  "onOpenPlan",
  "onNewTerminal",
]);
const message = (reason: unknown) =>
  reason instanceof Error ? reason.message : String(reason);

export function useSessionPictureInPicture(
  sessions: Session[],
  sharedProps: SessionPipSharedProps,
  onReturnFocus?: (id: string) => void,
  onReturned?: (
    id: string,
    focusAndRunActions: () => void,
    hasOwnerActions: boolean,
  ) => void,
) {
  const [ids, setIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const current = useRef({ sessions, sharedProps, onReturnFocus, onReturned });
  current.current = { sessions, sharedProps, onReturnFocus, onReturned };
  const opened = useRef(
    new Map<
      string,
      {
        session: Session;
        theme: SessionPipTheme;
        reviewUndoLocked: boolean;
        closing?: boolean;
        label?: string;
      }
    >(),
  );
  const opening = useRef(new Set<string>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const afterReturn = useRef(new Map<string, Array<() => void>>());
  const ready = useRef<Promise<boolean>>(Promise.resolve(false));
  const mounted = useRef(false);

  const reviewLocked = useCallback(
    (session: Session) =>
      current.current.sessions.some(
        (other) =>
          other.id !== session.id &&
          other.busy &&
          sameProjectPath(sessionWorkCwd(other), sessionWorkCwd(session)),
      ),
    [],
  );
  const snapshot = useCallback(
    (
      session: Session,
      theme: SessionPipTheme,
    ): SessionPictureInPictureState => ({
      session,
      theme,
      recents: current.current.sharedProps.recents,
      hideProjectPicker: current.current.sharedProps.hideProjectPicker,
      reviewUndoLocked: reviewLocked(session),
      draft: readComposerDraft(session.id),
      catalog: allModels(),
      catalogVersion: getModelSnapshot(),
      nativeCommands: (
        peekSkills({
          harness: session.harness,
          cwd: sessionWorkCwd(session),
          sessionId: session.id,
        }) ?? []
      ).filter(
        (skill): skill is NativeCommand & { kind: "native" } =>
          skill.kind === "native",
      ),
      actions: SESSION_PIP_CALLBACKS.filter(
        (name) => typeof current.current.sharedProps[name] === "function",
      ),
    }),
    [reviewLocked],
  );

  useEffect(() => {
    let disposed = false;
    mounted.current = true;
    const cleanups: Array<() => void> = [];
    const restore = (id: string, draft: unknown) => {
      if (draft != null) importComposerDraft(id, draft);
      flushComposerDrafts();
    };
    cleanups.push(
      subscribeModels(() => {
        for (const [id, entry] of opened.current) {
          const session = current.current.sessions.find(
            (session) => session.id === id,
          );
          if (session && !entry.closing)
            void nativeSessionPip
              .update(id, snapshot(session, entry.theme))
              .catch((reason) => setError(message(reason)));
        }
      }),
      registerWorkspaceDraftFlusher(async () => {
        if (!opened.current.size) return;
        const drafts = await nativeSessionPip.flushAll();
        for (const entry of drafts) {
          if (opened.current.has(entry.id)) restore(entry.id, entry.draft);
        }
      }),
    );
    const closed = (event: SessionPipClosed) => {
      if (disposed || !opened.current.has(event.id)) return;
      restore(event.id, event.draft);
      clearTimeout(timers.current.get(event.id));
      timers.current.delete(event.id);
      opened.current.delete(event.id);
      setIds([...opened.current.keys()]);
      const actions = afterReturn.current.get(event.id) ?? [];
      afterReturn.current.delete(event.id);
      const focusAndRunActions = () => {
        if (
          !current.current.sessions.some((session) => session.id === event.id)
        )
          return;
        // App synchronously selects the source before callbacks read its paths.
        // A grouped return may defer this until every sibling draft is restored.
        try {
          current.current.onReturnFocus?.(event.id);
        } catch (reason) {
          setError(message(reason));
          return;
        }
        for (const action of actions) action();
      };
      if (current.current.onReturned)
        current.current.onReturned(
          event.id,
          focusAndRunActions,
          actions.length > 0,
        );
      else focusAndRunActions();
    };
    const action = (event: SessionPipAction) => {
      if (
        disposed ||
        !validSessionPipAction(event, new Set(opened.current.keys()))
      )
        return;
      if (
        event.action !== "draft" &&
        !current.current.sessions.some((session) => session.id === event.id)
      )
        return;
      if (event.action === "draft" || event.action === "quit") {
        restore(event.id, event.args[0]);
        if (event.action === "quit")
          void import("./appLifecycle")
            .then(({ handleQuitRequested }) => handleQuitRequested())
            .catch((reason) => setError(message(reason)));
        return;
      }
      const name = event.action as SessionPipCallback;
      const run = () => {
        if (
          !current.current.sessions.some((session) => session.id === event.id)
        )
          return;
        try {
          const callback = current.current.sharedProps[name] as
            ((...args: unknown[]) => unknown) | undefined;
          void Promise.resolve(callback?.(...event.args)).catch((reason) =>
            setError(message(reason)),
          );
        } catch (reason) {
          setError(message(reason));
        }
      };
      if (OWNER_UI_ACTIONS.has(name)) {
        afterReturn.current.set(event.id, [
          ...(afterReturn.current.get(event.id) ?? []),
          run,
        ]);
        void nativeSessionPip
          .close(event.id)
          .catch((reason) => setError(message(reason)));
      } else run();
    };
    const register = <T>(name: string, callback: (payload: T) => void) =>
      nativeSessionPip.listen<T>(name, callback).then((unlisten) => {
        if (disposed) unlisten();
        else cleanups.push(unlisten);
      });
    ready.current = Promise.all([
      register<SessionPipAction>("session-pip-action", action),
      register<SessionPipClosed>("session-pip-closed", closed),
    ])
      .then(() => {
        return !disposed;
      })
      .catch((reason) => {
        if (!disposed) setError(message(reason));
        return false;
      });
    return () => {
      disposed = true;
      mounted.current = false;
      cleanups.forEach((unlisten) => unlisten());
      timers.current.forEach(clearTimeout);
      timers.current.clear();
    };
  }, [snapshot]);

  const show = useCallback(async (id: string) => {
    if (!opened.current.has(id)) return;
    try {
      await nativeSessionPip.show(id);
    } catch (reason) {
      setError(message(reason));
    }
  }, []);
  const openOne = useCallback(
    async (id: string) => {
      if (opened.current.has(id)) {
        await show(id);
        return opened.current.get(id)?.label;
      }
      if (opening.current.has(id)) return;
      opening.current.add(id);
      let nativeOpened = false;
      try {
        if (!(await ready.current) || !mounted.current) return;
        const session = current.current.sessions.find(
          (session) => session.id === id,
        );
        if (!session) return;
        flushComposerDrafts();
        const theme = captureSessionPipTheme();
        // Register before opening: a fast close from the child must still restore its draft.
        opened.current.set(id, {
          session,
          theme,
          reviewUndoLocked: reviewLocked(session),
        });
        const label = await nativeSessionPip.open(
          id,
          session.title || "Session",
          snapshot(session, theme),
        );
        nativeOpened = true;
        if (!opened.current.has(id)) return;
        if (!mounted.current) {
          await nativeSessionPip.close(id);
          return;
        }
        const latest = current.current.sessions.find(
          (session) => session.id === id,
        );
        if (!latest) {
          await nativeSessionPip.close(id);
          return;
        }
        opened.current.set(id, {
          session: latest,
          label,
          theme,
          reviewUndoLocked: reviewLocked(latest),
        });
        setIds([...opened.current.keys()]);
        setError(null);
        // Capture a final edit made while the native window was opening.
        await nativeSessionPip.update(id, snapshot(latest, theme));
        return label;
      } catch (reason) {
        if (!nativeOpened) opened.current.delete(id);
        if (mounted.current) {
          setIds([...opened.current.keys()]);
          setError(message(reason));
        }
      } finally {
        opening.current.delete(id);
      }
    },
    [show, snapshot, reviewLocked],
  );
  const openRequests = useRef(new Map<string, Promise<string | undefined>>());
  const open = useCallback(
    (id: string) => {
      const pending = openRequests.current.get(id);
      if (pending) return pending;
      const request = openOne(id).finally(() =>
        openRequests.current.delete(id),
      );
      openRequests.current.set(id, request);
      return request;
    },
    [openOne],
  );
  const returnSession = useCallback(async (id: string) => {
    if (!opened.current.has(id)) return;
    try {
      await nativeSessionPip.close(id);
    } catch (reason) {
      setError(message(reason));
    }
  }, []);

  useEffect(() => {
    for (const [id, entry] of opened.current) {
      const session = sessions.find((session) => session.id === id);
      if (!session) {
        if (!entry.closing) {
          entry.closing = true;
          void nativeSessionPip
            .close(id)
            .catch((reason) => setError(message(reason)));
        }
        continue;
      }
      if (
        (entry.session === session &&
          entry.reviewUndoLocked === reviewLocked(session)) ||
        timers.current.has(id)
      )
        continue;
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id);
          const latest = current.current.sessions.find(
            (session) => session.id === id,
          );
          const live = opened.current.get(id);
          if (!latest || !live || live.closing) return;
          live.session = latest;
          live.reviewUndoLocked = reviewLocked(latest);
          void nativeSessionPip
            .update(id, snapshot(latest, live.theme))
            .catch((reason) => setError(message(reason)));
        }, 50),
      );
    }
  }, [sessions, snapshot, reviewLocked]);
  return { ids, open, returnSession, show, error };
}

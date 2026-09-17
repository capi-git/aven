import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useBootSplashReady } from "../lib/bootSplash";
import { installInAppLinks } from "../lib/inAppLinks";
import { SessionPane } from "./SessionPane";
import { prepareSessionPipViewMetadata } from "../lib/sessionPipViewMetadata";
import {
  SESSION_PIP_CALLBACKS,
  applySessionPipTheme,
  nativeSessionPip,
  parseSessionPipEnvelope,
  type SessionPaneProps,
  type SessionPipCallback,
  type SessionPipEnvelope,
} from "../lib/sessionPictureInPicture";
import {
  flushComposerDrafts,
  readComposerDraft,
  restoreComposerDraft,
  subscribeComposerDrafts,
} from "../lib/composerDrafts";
import "./SessionPictureInPicture.css";

const noop = () => {};
const errorMessage = (reason: unknown) =>
  reason instanceof Error ? reason.message : String(reason);

/** A controlled session view. The owning App remains the only harness controller. */
export function SessionPictureInPicture() {
  const [envelope, setEnvelope] = useState<SessionPipEnvelope | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Incoming state applies its parent theme before this content commit.
  useBootSplashReady(!!envelope || !!error);
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const [draftRevision, setDraftRevision] = useState(0);
  const current = useRef<SessionPipEnvelope | null>(null);
  const mounted = useRef(false);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const leaving = useRef(false);
  const appliedTheme = useRef<string | undefined>(undefined);

  const report = useCallback((reason: unknown) => {
    if (mounted.current) setError(errorMessage(reason));
  }, []);
  useEffect(
    () =>
      installInAppLinks(
        {
          openUrl: (url) => nativeSessionPip.action("onOpenUrl", [url]),
          openFile: (path, navigation) => {
            void nativeSessionPip
              .action("onOpenFile", [path, navigation ?? null])
              .catch(report);
          },
        },
        report,
      ),
    [report],
  );
  const latestDraft = useCallback(() => {
    clearTimeout(draftTimer.current);
    draftTimer.current = undefined;
    flushComposerDrafts();
    const active = current.current;
    return active
      ? (readComposerDraft(active.id) ?? active.state.draft)
      : undefined;
  }, []);
  const leave = useCallback(
    async (quit = false) => {
      if (leaving.current) return;
      leaving.current = true;
      try {
        const draft = latestDraft();
        if (quit) await nativeSessionPip.action("quit", [draft ?? null]);
        else await nativeSessionPip.returnSession(draft);
      } catch (reason) {
        report(reason);
      } finally {
        leaving.current = false;
      }
    },
    [latestDraft, report],
  );

  useEffect(() => {
    let disposed = false;
    let received = false;
    const cleanups: Array<() => void> = [];
    mounted.current = true;
    const accept = (raw: unknown) => {
      if (disposed) return;
      const next = parseSessionPipEnvelope(raw);
      if (!next) {
        report("The session window received invalid state.");
        return;
      }
      if (current.current && current.current.id !== next.id) return;
      prepareSessionPipViewMetadata(next.state);
      const previous = readComposerDraft(next.id);
      const restored = restoreComposerDraft(next.id, next.state.draft);
      // Composer owns its current input. Only a genuinely newer external draft
      // needs a fresh composer; normal streamed session updates keep it mounted.
      if (
        current.current &&
        restored &&
        restored !== previous &&
        (!previous ||
          restored.text !== previous.text ||
          JSON.stringify(restored.attachments) !==
            JSON.stringify(previous.attachments))
      )
        setDraftRevision((revision) => revision + 1);
      const themeKey = JSON.stringify(next.state.theme);
      if (themeKey !== appliedTheme.current) {
        applySessionPipTheme(next.state.theme);
        appliedTheme.current = themeKey;
      }
      current.current = next;
      setEnvelope(next);
    };
    const register = <T,>(name: string, callback: (payload: T) => void) =>
      nativeSessionPip
        .listen<T>(name, (payload) => {
          if (!disposed) callback(payload);
        })
        .then((unlisten) => {
          if (disposed) unlisten();
          else cleanups.push(unlisten);
        });
    void Promise.all([
      register<SessionPipEnvelope>("session-pip-state", (payload) => {
        received = true;
        accept(payload);
      }),
      register("session-pip-return-requested", () => {
        void leave();
      }),
      register("session-pip-quit-requested", () => {
        void leave(true);
      }),
      register<{ requestId: string }>(
        "session-pip-flush-requested",
        ({ requestId }) => {
          if (typeof requestId === "string")
            void nativeSessionPip.draft(latestDraft(), requestId).catch(report);
        },
      ),
      register("open_model_picker", () => {
        window.dispatchEvent(new Event("open_model_picker"));
      }),
    ])
      .then(async () => {
        if (disposed) return;
        const initial = await nativeSessionPip.getState();
        // A live event that overtook the initial request is newer than its reply.
        if (!received) accept(initial);
      })
      .catch((reason) => {
        if (!disposed) report(reason);
      });
    cleanups.push(
      subscribeComposerDrafts(() => {
        if (!current.current || disposed) return;
        if (draftTimer.current !== undefined) return;
        draftTimer.current = setTimeout(() => {
          draftTimer.current = undefined;
          const id = current.current?.id;
          if (id && !disposed)
            void nativeSessionPip.draft(readComposerDraft(id)).catch(report);
        }, 100);
      }),
    );
    return () => {
      disposed = true;
      mounted.current = false;
      cleanups.forEach((cleanup) => cleanup());
      clearTimeout(draftTimer.current);
      draftTimer.current = undefined;
    };
  }, [leave, latestDraft, report]);

  const forwarded = useMemo(() => {
    const callbacks: Partial<
      Record<SessionPipCallback, (...args: unknown[]) => unknown>
    > = {};
    for (const name of SESSION_PIP_CALLBACKS)
      callbacks[name] = (...args) => {
        if (name === "onCompactContext" && current.current?.state.session.busy)
          return false;
        void nativeSessionPip.action(name, args).catch(report);
        return name === "onCompactContext" ? true : undefined;
      };
    return callbacks as Pick<SessionPaneProps, SessionPipCallback>;
  }, [report]);
  const callbacks = useMemo(() => {
    const enabled = envelope?.state.actions;
    if (!enabled) return forwarded;
    const result = { ...forwarded };
    for (const name of [
      "onInboxCardDismiss",
      "onNoteCardDismiss",
      "onHandoffCardDismiss",
      "onSecondOpinion",
      "onHandoff",
    ] as const)
      if (!enabled.includes(name)) result[name] = undefined;
    return result;
  }, [forwarded, envelope?.state.actions]);
  const togglePinned = async () => {
    const next = current.current;
    if (!next) return;
    const pinned = !next.pinned;
    try {
      await nativeSessionPip.setPinned(pinned);
      if (mounted.current && current.current) {
        current.current = { ...current.current, pinned };
        setEnvelope(current.current);
      }
    } catch (reason) {
      report(reason);
    }
  };
  return (
    <main className="session-pip personal-shell">
      <header
        className="session-pip-toolbar"
        data-tauri-drag-region="false"
        onMouseDown={(event) => {
          if (event.button === 0 && event.target === event.currentTarget) {
            event.preventDefault();
            void getCurrentWindow().startDragging().catch(report);
          }
        }}
      >
        <button
          type="button"
          className="session-pip-return"
          onClick={() => {
            void leave();
          }}
        >
          Return to workspace
        </button>
        <span className="session-pip-title">
          {envelope?.state.session.title || "Session"}
        </span>
        <button
          type="button"
          aria-pressed={envelope?.pinned ?? false}
          disabled={!envelope}
          onClick={() => {
            void togglePinned();
          }}
        >
          Keep on top
        </button>
      </header>
      {error && (
        <div className="session-pip-error" role="alert">
          {error}
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => setError(null)}
          >
            ×
          </button>
        </div>
      )}
      <div className="session-pip-body">
        {envelope ? (
          <SessionPane
            key={`${envelope.id}:${draftRevision}`}
            {...callbacks}
            session={envelope.state.session}
            recents={envelope.state.recents}
            hideProjectPicker={envelope.state.hideProjectPicker}
            reviewUndoLocked={envelope.state.reviewUndoLocked}
            visible={visible}
            focused={visible}
            addToChatTarget
            composerFocused={visible}
            inSplit={false}
            onFocus={noop}
            onClose={() => {
              void leave();
            }}
          />
        ) : (
          <div className="session-pip-loading" role="status">
            Opening session…
          </div>
        )}
      </div>
    </main>
  );
}

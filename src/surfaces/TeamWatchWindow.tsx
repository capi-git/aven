import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { IS_MAC } from "../lib/platform";
import type { TeamWatchAct } from "../lib/teamWatch";
import {
  OWNER_CLOSED_TEXT,
  teamWatchWindow,
  type TeamWatchWindow as Bridge,
  type TeamWatchWindowState,
} from "../lib/teamWatchBridge";
import { TeamPanelBar, type TeamPanelControls } from "./TeamPanelBar";
import { TeamWatchPanelView } from "./TeamWatchBodies";
import "./DiscussionPanel.css";
import "./TeamWatchPanel.css";

/** The page's colours, from the workspace that owns the team. */
function useWindowTheme(
  theme: TeamWatchWindowState["snapshot"]["theme"] | undefined,
) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.add("team-watch-window");
    root.classList.toggle("is-mac", IS_MAC);
    document.getElementById("boot-splash")?.remove();
    if (!theme) return;
    root.classList.toggle("theme-light", theme.mode === "light");
    const set = (name: string, value: string | undefined) =>
      value
        ? root.style.setProperty(name, value)
        : root.style.removeProperty(name);
    set("--theme-accent-color", theme.accent);
    set("--personal-accent", theme.accent);
    set("--theme-content-color", theme.text);
    set("--team-watch-window-bg", theme.background);
  }, [theme]);
}

/**
 * A team's panel popped out into a window of its own, to move anywhere,
 * even another screen. It owns nothing: it draws what the window that owns
 * the team sends and sends every press back there. ↙ puts it back in that
 * window as the panel; closing it leaves the team there as a pill. If that
 * window closes, this says so and offers only Close.
 */
export function TeamWatchWindow({
  bridge: given,
}: {
  /** The host's side; the native bridge unless a test supplies one. */
  bridge?: Bridge;
}) {
  const bridge = useMemo(() => given ?? teamWatchWindow(), [given]);
  const [state, setState] = useState<TeamWatchWindowState | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false;
    let received = false;
    let stop: (() => void) | undefined;
    const accept = (next: TeamWatchWindowState) => {
      if (disposed) return;
      setState((previous) =>
        previous && next.revision < previous.revision ? previous : next,
      );
    };
    void (async () => {
      const unlisten = await bridge.onState((next) => {
        received = true;
        accept(next);
      });
      if (disposed) {
        unlisten();
        return;
      }
      stop = unlisten;
      const initial = await bridge.state();
      if (!received) accept(initial);
    })().catch(() => {
      if (!disposed) setFailed(true);
    });
    return () => {
      disposed = true;
      stop?.();
      bridge.dispose();
    };
  }, [bridge]);
  useWindowTheme(state?.snapshot.theme);
  // The window appears once it has drawn its first frame.
  const revision = state?.revision;
  useEffect(() => {
    if (revision === undefined) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        void bridge.ready(revision).catch(() => {});
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [bridge, revision]);
  const act = useCallback<TeamWatchAct>(
    (action) => bridge.send(action),
    [bridge],
  );
  const close = useCallback(
    () => void bridge.dismiss().catch(() => {}),
    [bridge],
  );
  const controls = useMemo<TeamPanelControls>(
    () =>
      state?.ownerClosed
        ? { onClose: close, windowDrag: true }
        : {
            onPopIn: () => void bridge.send({ kind: "watch" }),
            onClose: close,
            windowDrag: true,
          },
    [bridge, close, state?.ownerClosed],
  );
  const view = state?.snapshot.view ?? null;
  const ended = failed
    ? "This team's panel couldn't load."
    : state?.ownerClosed
      ? OWNER_CLOSED_TEXT
      : state && !view
        ? "This team is no longer available."
        : null;
  if (!state && !failed) return null;
  return (
    <div
      className="team-watch-window-root"
      data-team-watch-window={state?.team ?? ""}
      data-owner-closed={state?.ownerClosed || undefined}
    >
      {ended || !view ? (
        <>
          <div className="discussion-float-head">
            <TeamPanelBar title="Team" controls={controls} />
          </div>
          <div className="team-watch-closed" role="status">
            <p className="m-0">{ended}</p>
            <button
              type="button"
              className="team-watch-button"
              data-team-watch-close
              onClick={close}
            >
              Close
            </button>
          </div>
        </>
      ) : (
        <TeamWatchPanelView view={view} act={act} controls={controls} />
      )}
    </div>
  );
}

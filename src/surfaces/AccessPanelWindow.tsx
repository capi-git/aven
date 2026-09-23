import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ToolbarPanel, ToolbarPanelHeader } from "../chrome/ToolbarPanel";
import { AccessPanelContent } from "../chrome/AccessPanel";
import { nativeAccessPanel, type AccessPanelState } from "../lib/accessPanel";
import type { RuntimeMode } from "../lib/session";

/** Retained presentation only. The owning workspace remains the state owner. */
export function AccessPanelWindow() {
  const [state, setState] = useState<AccessPanelState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(state);
  current.current = state;
  const act = (action: RuntimeMode | "close") => {
    const openId = current.current?.openId;
    if (!openId) return;
    void nativeAccessPanel.action(action, openId).catch(() => {
      if (current.current?.openId === openId)
        setError("Could not update access. Close and try again.");
    });
  };
  useEffect(() => {
    let disposed = false;
    let received = false;
    let stop: (() => void) | undefined;
    const accept = (next: AccessPanelState) => {
      if (disposed) return;
      setError(null);
      setState((previous) =>
        previous && next.revision < previous.revision ? previous : next,
      );
    };
    void (async () => {
      const unsubscribe = await nativeAccessPanel.listen<AccessPanelState>(
        "access-panel-state",
        (next) => {
          received = true;
          accept(next);
        },
      );
      if (disposed) {
        unsubscribe();
        return;
      }
      stop = unsubscribe;
      const initial = await nativeAccessPanel.getState();
      if (!received) accept(initial);
    })().catch(() => {
      if (!disposed) setError("Could not load access. Close and try again.");
    });
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        act("close");
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      disposed = true;
      stop?.();
      window.removeEventListener("keydown", key);
    };
  }, []);
  const snapshot = state?.snapshot;
  useLayoutEffect(() => {
    if (!snapshot) return;
    document.documentElement.style.setProperty(
      "--access-window-bg",
      snapshot.theme.background ??
        (snapshot.theme.mode === "dark" ? "#101416" : "#edf5f7"),
    );
    document.documentElement.classList.add("access-panel-window");
    document.getElementById("boot-splash")?.remove();
  }, [snapshot?.theme.background, snapshot?.theme.mode]);
  useLayoutEffect(() => {
    if (!state) return;
    // Reopening waits only for this fresh snapshot to commit, never a new
    // renderer. The host ignores stale acknowledgements and live updates
    // cannot focus a panel that was already visible or has been dismissed.
    const { openId, revision } = state;
    void nativeAccessPanel.ready(openId, revision).catch(() => {
      if (current.current?.openId === openId)
        setError("Could not show access panel.");
    });
  }, [state?.openId, state?.revision]);
  if (!state || !snapshot)
    return error ? (
      <ToolbarPanel role="alert" className="access-panel">
        <ToolbarPanelHeader
          title="Access"
          onClose={() => act("close")}
          closeLabel="Close access"
        />
        <p className="access-panel-body">{error}</p>
      </ToolbarPanel>
    ) : null;
  return (
    <AccessPanelContent
      key={state.openId}
      snapshot={snapshot}
      onSelect={act}
      onClose={() => act("close")}
      error={error}
    />
  );
}

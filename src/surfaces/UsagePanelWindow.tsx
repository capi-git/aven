import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ToolbarPanel, ToolbarPanelHeader } from "../chrome/ToolbarPanel";
import { UsagePanelContent } from "../chrome/UsagePanel";
import { nativeUsagePanel, type UsagePanelState } from "../lib/usagePanel";

/** Retained presentation only. The owning workspace remains the state owner. */
export function UsagePanelWindow() {
  const [state, setState] = useState<UsagePanelState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(state);
  current.current = state;
  const act = (action: "refresh" | "close") => {
    const openId = current.current?.openId;
    if (!openId) return;
    void nativeUsagePanel.action(action, openId).catch(() => {
      if (current.current?.openId === openId)
        setError("Could not update usage. Close and try again.");
    });
  };
  useEffect(() => {
    let disposed = false;
    let received = false;
    let stop: (() => void) | undefined;
    const accept = (next: UsagePanelState) => {
      if (disposed) return;
      setError(null);
      setState((previous) =>
        previous && next.revision < previous.revision ? previous : next,
      );
    };
    void (async () => {
      const unsubscribe = await nativeUsagePanel.listen<UsagePanelState>(
        "usage-panel-state",
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
      const initial = await nativeUsagePanel.getState();
      if (!received) accept(initial);
    })().catch(() => {
      if (!disposed) setError("Could not load usage. Close and try again.");
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
      "--usage-window-bg",
      snapshot.theme.background ??
        (snapshot.theme.mode === "dark" ? "#101416" : "#edf5f7"),
    );
    document.documentElement.classList.add("usage-panel-window");
    document.getElementById("boot-splash")?.remove();
  }, [snapshot?.theme.background, snapshot?.theme.mode]);
  useLayoutEffect(() => {
    if (!state) return;
    // Reopening waits only for this fresh snapshot to commit, never a new
    // renderer. The host ignores stale acknowledgements and live updates
    // cannot focus a panel that was already visible or has been dismissed.
    const { openId, revision } = state;
    void nativeUsagePanel.ready(openId, revision).catch(() => {
      if (current.current?.openId === openId)
        setError("Could not show usage panel.");
    });
  }, [state?.openId, state?.revision]);
  if (!state || !snapshot)
    return error ? (
      <ToolbarPanel role="alert" className="usage-panel">
        <ToolbarPanelHeader
          title="Usage"
          onClose={() => act("close")}
          closeLabel="Close usage"
        />
        <p className="usage-panel-body">{error}</p>
      </ToolbarPanel>
    ) : null;
  return (
    <UsagePanelContent
      key={state.openId}
      snapshot={snapshot}
      onRefresh={() => act("refresh")}
      onClose={() => act("close")}
    />
  );
}

import { useEffect, useLayoutEffect, useState } from "react";
import { WorkspaceMenuPanelContent } from "../chrome/WorkspaceMenuPanel";
import { ToolbarPanel, ToolbarPanelHeader } from "../chrome/ToolbarPanel";
import {
  nativeWorkspaceMenuPanel,
  type WorkspaceMenuPanelSnapshot,
} from "../lib/workspaceMenuPanel";

/** Display-only popup. The workspace retains all action callbacks and state. */
export function WorkspaceMenuPanelWindow() {
  const [snapshot, setSnapshot] = useState<WorkspaceMenuPanelSnapshot | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const act = (action: string) => {
    void nativeWorkspaceMenuPanel.action(action).catch(() => {
      setError("Could not complete that action. Close and try again.");
    });
  };
  useEffect(() => {
    let disposed = false;
    let received = false;
    let stop: (() => void) | undefined;
    void (async () => {
      const unsubscribe =
        await nativeWorkspaceMenuPanel.listen<WorkspaceMenuPanelSnapshot>(
          "workspace-menu-panel-state",
          (next) => {
            received = true;
            if (!disposed) setSnapshot(next);
          },
        );
      if (disposed) {
        unsubscribe();
        return;
      }
      stop = unsubscribe;
      const initial = await nativeWorkspaceMenuPanel.getState();
      if (!disposed && !received) setSnapshot(initial);
    })().catch(() => {
      if (!disposed)
        setError("Could not load workspace actions. Close and try again.");
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
  const ready = !!snapshot || !!error;
  useLayoutEffect(() => {
    if (!ready) return;
    document.documentElement.classList.add("workspace-menu-panel-window");
    document.documentElement.style.colorScheme = snapshot?.theme.mode ?? "dark";
    document.getElementById("boot-splash")?.remove();
  }, [ready, snapshot?.theme.mode]);
  useEffect(() => {
    if (ready)
      void nativeWorkspaceMenuPanel
        .ready()
        .catch(() => setError("Could not show workspace actions."));
  }, [ready]);
  if (!snapshot)
    return error ? (
      <ToolbarPanel role="alert" className="workspace-menu-panel">
        <ToolbarPanelHeader
          title="Open"
          onClose={() => act("close")}
          closeLabel="Close open options"
        />
        <p className="workspace-menu-panel-error">{error}</p>
      </ToolbarPanel>
    ) : null;
  return (
    <WorkspaceMenuPanelContent
      snapshot={snapshot}
      onSelect={act}
      onClose={() => act("close")}
      error={error}
    />
  );
}

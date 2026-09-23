import { useEffect, useLayoutEffect, useState } from "react";
import { ToolbarPanel, ToolbarPanelHeader } from "../chrome/ToolbarPanel";
import { AccessPanelContent } from "../chrome/AccessPanel";
import {
  nativeAccessPanel,
  type AccessPanelSnapshot,
} from "../lib/accessPanel";
import type { RuntimeMode } from "../lib/session";

/** Controlled popup only; the parent owns task access and persisted defaults. */
export function AccessPanelWindow() {
  const [snapshot, setSnapshot] = useState<AccessPanelSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = (action: RuntimeMode | "close") => {
    void nativeAccessPanel
      .action(action)
      .catch(() => setError("Could not update access. Close and try again."));
  };
  useEffect(() => {
    let disposed = false;
    let received = false;
    let stop: (() => void) | undefined;
    void (async () => {
      const unsubscribe = await nativeAccessPanel.listen<AccessPanelSnapshot>(
        "access-panel-state",
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
      const initial = await nativeAccessPanel.getState();
      if (!disposed && !received) setSnapshot(initial);
    })().catch(() => {
      if (!disposed)
        setError("Could not load access options. Close and try again.");
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
  useLayoutEffect(() => {
    if (!snapshot && !error) return;
    document.documentElement.style.setProperty(
      "--access-window-bg",
      snapshot?.theme.background ?? "#0b121a",
    );
    document.documentElement.classList.add("access-panel-window");
    document.getElementById("boot-splash")?.remove();
  }, [snapshot?.theme.background, !!error]);
  const ready = !!snapshot || !!error;
  useEffect(() => {
    if (ready)
      void nativeAccessPanel
        .ready()
        .catch(() => setError("Could not show access options."));
  }, [ready]);
  if (!snapshot)
    return error ? (
      <ToolbarPanel role="alert" className="access-panel">
        <ToolbarPanelHeader
          title="Access"
          onClose={() => act("close")}
          closeLabel="Close access options"
        />
        <p className="access-panel-error">{error}</p>
      </ToolbarPanel>
    ) : null;
  return (
    <AccessPanelContent
      snapshot={snapshot}
      onSelect={act}
      onClose={() => act("close")}
      error={error}
    />
  );
}

import { useEffect, useLayoutEffect, useState } from "react";
import { UsagePanelContent } from "../chrome/UsagePanel";
import { nativeUsagePanel, type UsagePanelSnapshot } from "../lib/usagePanel";

/** Presentation only: the owning workspace remains the sole usage fetcher. */
export function UsagePanelWindow() {
  const [snapshot, setSnapshot] = useState<UsagePanelSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    let received = false;
    let unlisten: (() => void) | undefined;
    const fail = () => {
      if (!disposed) setError("Could not load usage. Close and try again.");
    };
    void (async () => {
      const stop = await nativeUsagePanel.listen<UsagePanelSnapshot>(
        "usage-panel-state",
        (next) => {
          received = true;
          if (!disposed) setSnapshot(next);
        },
      );
      if (disposed) {
        stop();
        return;
      }
      unlisten = stop;
      const initial = await nativeUsagePanel.getState();
      if (!disposed && !received) setSnapshot(initial);
    })().catch(fail);
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        void nativeUsagePanel.action("close").catch(fail);
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener("keydown", key);
    };
  }, []);
  const ready = !!snapshot || !!error;
  useLayoutEffect(() => {
    if (!snapshot) return;
    document.documentElement.style.setProperty(
      "--usage-window-bg",
      snapshot.theme.background ??
        (snapshot.theme.mode === "dark" ? "#101416" : "#edf5f7"),
    );
  }, [snapshot?.theme.background, snapshot?.theme.mode]);
  useLayoutEffect(() => {
    if (!ready) return;
    document.getElementById("boot-splash")?.remove();
    document.documentElement.classList.add("usage-panel-window");
    void nativeUsagePanel
      .ready()
      .catch(() => setError("Could not show usage panel."));
  }, [ready]);
  if (!snapshot) return error ? <div role="alert">{error}</div> : null;
  return (
    <UsagePanelContent
      snapshot={snapshot}
      onRefresh={() => {
        void nativeUsagePanel
          .action("refresh")
          .catch(() => setError("Could not refresh usage."));
      }}
      onClose={() => {
        void nativeUsagePanel
          .action("close")
          .catch(() => setError("Could not close usage."));
      }}
    />
  );
}

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { WorkspaceMenuPanelContent } from "../chrome/WorkspaceMenuPanel";
import {
  nativeWorkspaceMenuPanel,
  type WorkspaceMenuPanelState,
} from "../lib/workspaceMenuPanel";

/** Retained display-only popup. The workspace owns action callbacks and state. */
export function WorkspaceMenuPanelWindow() {
  const [state, setState] = useState<WorkspaceMenuPanelState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focusPresentation, setFocusPresentation] = useState<string | null>(
    null,
  );
  const current = useRef(state);
  current.current = state;
  const mounted = useRef(false);
  const act = (action: string) => {
    const presentation = current.current?.presentation;
    if (!presentation) return;
    void nativeWorkspaceMenuPanel.action(presentation, action).catch(() => {
      if (mounted.current && current.current?.presentation === presentation)
        setError("Could not complete that action. Close and try again.");
    });
  };
  const dispatch = useRef(act);
  dispatch.current = act;
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let received = false;
    let stop: (() => void) | undefined;
    const consume = (next: WorkspaceMenuPanelState | null) => {
      if (disposed) return;
      setState(next);
      setError(null);
      if (!next) setFocusPresentation(null);
    };
    void (async () => {
      const unsubscribe =
        await nativeWorkspaceMenuPanel.listen<WorkspaceMenuPanelState | null>(
          "workspace-menu-panel-state",
          (next) => {
            received = true;
            consume(next);
          },
        );
      if (disposed) {
        unsubscribe();
        return;
      }
      stop = unsubscribe;
      const initial = await nativeWorkspaceMenuPanel.getState();
      if (!disposed && !received) consume(initial);
    })().catch(() => {
      if (!disposed && !received)
        setError("Could not load workspace actions. Close and try again.");
    });
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        dispatch.current("close");
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      disposed = true;
      mounted.current = false;
      stop?.();
      window.removeEventListener("keydown", key);
    };
  }, []);
  useLayoutEffect(() => {
    document.documentElement.classList.add("workspace-menu-panel-window");
    document.getElementById("boot-splash")?.remove();
    if (!state) return;
    document.documentElement.style.colorScheme = state.snapshot.theme.mode;
    let disposed = false;
    const presentation = state.presentation;
    // A hidden WKWebView can throttle animation frames and passive effects.
    // Acknowledge directly after DOM/palette commit so warm menus open promptly.
    void nativeWorkspaceMenuPanel
      .ready(presentation)
      .then((shown) => {
        if (disposed || current.current?.presentation !== presentation) return;
        // Updates also get fresh tokens, but must preserve the user's active row.
        // Only a newly shown native window resets content focus for a fresh open.
        if (shown) setFocusPresentation(presentation);
      })
      .catch(() => {
        if (!disposed && current.current?.presentation === presentation)
          setError("Could not show workspace actions.");
      });
    return () => {
      disposed = true;
    };
  }, [state?.presentation, state?.snapshot.theme.mode]);
  // No token means this retained renderer is idle (or failed before loading).
  // Do not show stale choices or issue an unscoped ready/close command.
  if (!state) return null;
  return (
    <WorkspaceMenuPanelContent
      key={focusPresentation ?? state.presentation}
      snapshot={state.snapshot}
      onSelect={act}
      onClose={() => act("close")}
      error={error}
    />
  );
}

import { useEffect, useRef } from "react";
import {
  nativeWorkspaceMenuPanel,
  type WorkspaceMenuPanelAnchor,
  type WorkspaceMenuPanelHandle,
  type WorkspaceMenuPanelSnapshot,
} from "../lib/workspaceMenuPanel";

type PanelEvent = WorkspaceMenuPanelHandle & { action?: string };
type Opening = {
  handle: WorkspaceMenuPanelHandle | null;
  displayed: WorkspaceMenuPanelSnapshot | null;
  busy: boolean;
  cancelled: boolean;
  finished: boolean;
  pending: PanelEvent[];
  receive: (event: PanelEvent) => void;
};

/** Keep the renderer warm while isolating every presentation and its callbacks. */
export function useWorkspaceMenuPanel({
  open,
  anchor,
  snapshot,
  onSelect,
  onClose,
  onError,
}: {
  open: boolean;
  anchor: { current: WorkspaceMenuPanelAnchor | null };
  snapshot: WorkspaceMenuPanelSnapshot;
  onSelect: (id: string) => void;
  onClose: () => void;
  onError: () => void;
}) {
  const targetAnchor = anchor.current;
  const anchorKey =
    targetAnchor instanceof HTMLElement
      ? targetAnchor
      : targetAnchor
        ? `${targetAnchor.x}:${targetAnchor.y}:${targetAnchor.width}:${targetAnchor.height}`
        : null;
  const latest = useRef({ snapshot, onSelect, onClose, onError });
  latest.current = { snapshot, onSelect, onClose, onError };
  const active = useRef<Opening | null>(null);
  const operations = useRef(Promise.resolve());
  useEffect(() => {
    if (!open || !anchor.current) return;
    const target = anchor.current;
    const state: Opening = {
      handle: null,
      displayed: null,
      busy: true,
      cancelled: false,
      finished: false,
      pending: [],
      receive: () => {},
    };
    active.current = state;
    const stops: (() => void)[] = [];
    state.receive = (event) => {
      if (state.cancelled || state.finished) return;
      if (state.busy || !state.handle) {
        state.pending.push(event);
        return;
      }
      if (
        event.label !== state.handle.label ||
        event.presentation !== state.handle.presentation
      )
        return;
      if (event.action !== undefined) {
        const item = state.displayed?.items.find(
          (item) => item.id === event.action,
        );
        if (!item || item.disabled) return;
        // Index-based domain IDs may have been reassigned while an update was
        // in flight. Never route an old visible choice through new callbacks.
        if (
          JSON.stringify(state.displayed?.items) ===
          JSON.stringify(latest.current.snapshot.items)
        ) {
          if (target instanceof HTMLElement && target.isConnected)
            target.focus({ preventScroll: true });
          latest.current.onSelect(item.id);
        }
      }
      state.finished = true;
      latest.current.onClose();
    };
    const subscribe = async (name: string) => {
      const stop = await nativeWorkspaceMenuPanel.listen<PanelEvent>(
        name,
        state.receive,
      );
      if (state.cancelled) stop();
      else stops.push(stop);
    };
    operations.current = operations.current
      .catch(() => {})
      .then(async () => {
        if (state.cancelled) return;
        await Promise.all([
          subscribe("workspace-menu-panel-action"),
          subscribe("workspace-menu-panel-closed"),
        ]);
        if (state.cancelled) return;
        const next = latest.current.snapshot;
        state.handle = await nativeWorkspaceMenuPanel.open(target, next);
        state.displayed = next;
        state.busy = false;
        state.pending.splice(0).forEach(state.receive);
      })
      .catch(() => {
        stops.splice(0).forEach((stop) => stop());
        if (!state.cancelled) latest.current.onError();
      });
    return () => {
      state.cancelled = true;
      stops.splice(0).forEach((stop) => stop());
      operations.current = operations.current
        .catch(() => {})
        .then(async () => {
          if (active.current === state) active.current = null;
          if (state.handle)
            await nativeWorkspaceMenuPanel.close(state.handle.presentation);
        })
        .catch(() => {});
    };
  }, [open, anchor, anchorKey]);
  useEffect(() => {
    const state = active.current;
    if (!open || !state) return;
    operations.current = operations.current
      .catch(() => {})
      .then(async () => {
        if (state.cancelled || state.finished || !state.handle) return;
        const next = latest.current.snapshot;
        if (JSON.stringify(state.displayed) === JSON.stringify(next)) return;
        state.busy = true;
        try {
          const updated = await nativeWorkspaceMenuPanel.update(
            state.handle.presentation,
            next,
          );
          if (updated) {
            state.handle = updated;
            state.displayed = next;
          }
        } finally {
          state.busy = false;
          state.pending.splice(0).forEach(state.receive);
        }
      })
      .catch(() => {
        if (!state.cancelled && !state.finished) latest.current.onError();
      });
  }, [open, snapshot]);
}

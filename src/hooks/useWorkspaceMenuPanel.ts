import { useEffect, useRef } from "react";
import {
  nativeWorkspaceMenuPanel,
  type WorkspaceMenuPanelSnapshot,
} from "../lib/workspaceMenuPanel";

/** Keep the callback and palette current without reopening a native popup. */
export function useWorkspaceMenuPanel({
  open,
  anchor,
  snapshot,
  onSelect,
  onClose,
  onError,
}: {
  open: boolean;
  anchor: { current: HTMLElement | null };
  snapshot: WorkspaceMenuPanelSnapshot;
  onSelect: (id: string) => void;
  onClose: () => void;
  onError: () => void;
}) {
  const latest = useRef({ snapshot, onSelect, onClose, onError });
  latest.current = { snapshot, onSelect, onClose, onError };
  const active = useRef<string | null>(null);
  const operations = useRef(Promise.resolve());
  useEffect(() => {
    if (!open || !anchor.current) return;
    const target = anchor.current;
    let cancelled = false;
    let finished = false;
    let label: string | null = null;
    type Event = { label: string; action?: string };
    const pending: Event[] = [];
    const stops: (() => void)[] = [];
    const receive = (event: Event) => {
      if (cancelled || finished) return;
      if (!label) {
        pending.push(event);
        return;
      }
      if (event.label !== label) return;
      if (event.action !== undefined) {
        const item = latest.current.snapshot.items.find(
          (item) => item.id === event.action,
        );
        if (!item || item.disabled) return;
        target.focus({ preventScroll: true });
        latest.current.onSelect(item.id);
      }
      finished = true;
      active.current = null;
      latest.current.onClose();
    };
    const subscribe = async (name: string) => {
      const stop = await nativeWorkspaceMenuPanel.listen<Event>(name, receive);
      if (cancelled) stop();
      else stops.push(stop);
    };
    operations.current = operations.current
      .catch(() => {})
      .then(async () => {
        if (cancelled) return;
        await subscribe("workspace-menu-panel-action");
        if (cancelled) return;
        await subscribe("workspace-menu-panel-closed");
        if (cancelled) return;
        label = await nativeWorkspaceMenuPanel.open(
          target,
          latest.current.snapshot,
        );
        if (cancelled) return;
        active.current = label;
        pending.splice(0).forEach(receive);
        if (!finished)
          await nativeWorkspaceMenuPanel.update(latest.current.snapshot);
      })
      .catch(() => {
        stops.splice(0).forEach((stop) => stop());
        if (!cancelled) latest.current.onError();
      });
    return () => {
      cancelled = true;
      stops.splice(0).forEach((stop) => stop());
      operations.current = operations.current
        .catch(() => {})
        .then(async () => {
          active.current = null;
          await nativeWorkspaceMenuPanel.close();
        })
        .catch(() => {});
    };
  }, [open, anchor]);
  useEffect(() => {
    if (open && active.current)
      void nativeWorkspaceMenuPanel.update(snapshot).catch(() => {});
  }, [open, snapshot]);
}

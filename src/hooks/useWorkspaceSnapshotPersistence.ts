import { useCallback, useEffect, useRef } from "react";
import {
  workspaceSnapshotKey,
  type WorkspaceSnapshot,
} from "../lib/workspaceSnapshot";

/** One delayed latest snapshot; token-only renders never restart its deadline. */
export function useWorkspaceSnapshotPersistence(
  enabled: boolean,
  save: (snapshot: WorkspaceSnapshot) => Promise<void>,
) {
  const options = useRef({ enabled, save });
  options.current = { enabled, save };
  const mounted = useRef(true);
  const savedKey = useRef<string | null>(null);
  const pending = useRef<{
    key: string;
    snapshot: WorkspaceSnapshot;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ready = useRef(false);
  const writing = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
    ready.current = false;
  }, []);

  const flush = useCallback(function flush() {
    if (!mounted.current || !options.current.enabled || writing.current) return;
    const next = pending.current;
    pending.current = null;
    ready.current = false;
    if (!next || next.key === savedKey.current) return;
    writing.current = true;
    // Serial writes prevent an older slow save from replacing the newest view.
    void Promise.resolve()
      .then(() => options.current.save(next.snapshot))
      .then(
        () => {
          savedKey.current = next.key;
        },
        () => {
          // A later update can retry; a failed write is never considered saved.
        },
      )
      .finally(() => {
        writing.current = false;
        if (ready.current) flush();
      });
  }, []);

  const schedule = useCallback(
    (snapshot: WorkspaceSnapshot, delay = 250) => {
      if (!mounted.current || !options.current.enabled) return;
      const key = workspaceSnapshotKey(snapshot);
      if (pending.current?.key === key) return;
      if (!writing.current && savedKey.current === key) {
        cancel();
        return;
      }
      cancel();
      pending.current = { key, snapshot };
      timer.current = setTimeout(() => {
        timer.current = null;
        ready.current = true;
        flush();
      }, delay);
    },
    [cancel, flush],
  );

  useEffect(() => {
    mounted.current = true;
    if (!enabled) cancel();
    return () => {
      mounted.current = false;
      cancel();
    };
  }, [enabled, cancel]);

  return schedule;
}

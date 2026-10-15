import { useCallback, useEffect, useState } from "react";
import { errorText } from "../lib/errors";
import {
  loadProjectMemory,
  projectMemoryKey,
  subscribeProjectMemory,
  type ProjectMemory,
} from "../lib/projectMemory";

export type ProjectMemoryState = {
  /** Null when the project has none. */
  memory: ProjectMemory | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

/**
 * A project's memory, read when shown and again after a save in this window.
 * No polling: other windows' edits appear the next time it is opened.
 */
export function useProjectMemory(path: string): ProjectMemoryState {
  const [memory, setMemory] = useState<ProjectMemory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    const key = projectMemoryKey(path);
    return subscribeProjectMemory((changed) => {
      if (changed === key) reload();
    });
  }, [path, reload]);

  // Only the first read shows as loading, so a reload never interrupts typing.
  useEffect(() => {
    setLoading(true);
  }, [path]);

  useEffect(() => {
    let cancelled = false;
    void loadProjectMemory(path).then(
      (loaded) => {
        if (cancelled) return;
        setMemory(loaded);
        setError(null);
        setLoading(false);
      },
      (failure: unknown) => {
        if (cancelled) return;
        setError(errorText(failure));
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [path, revision]);

  return { memory, loading, error, reload };
}

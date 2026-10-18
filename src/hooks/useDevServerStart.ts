import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  canStartDevServers,
  DEV_SERVER_START_MS,
  devServerStartFor,
  devServerStartsSnapshot,
  finishDevServerStart,
  isLocalDevAddress,
  loadDevScript,
  startDevServer,
  subscribeDevServerStarts,
  type DevScript,
  type DevServerStart,
} from "../lib/devServerStart";

/**
 * When a started server has not announced itself in its terminal (Aven
 * did not recognise its start line), the tab tries again at these times
 * after the start.
 */
export const DEV_SERVER_RETRY_MS = [8_000, 20_000, 40_000] as const;

export type DevServerOffer = {
  /** A start under way for this tab's server, until it answers. */
  starting?: DevServerStart;
  /** "Start dev server" is offered. */
  canStart: boolean;
  /** What to do instead, in plain words, when it cannot be offered. */
  hint?: string;
  /** Runs the project's dev script in its terminal. */
  start: () => void;
};

/**
 * A preview tab that cannot reach its local server: offers to start the
 * project's dev script, runs it in the project's terminal, and reloads the
 * tab once when the server answers (or, if the server never announces
 * itself, tries again a few times). `url` is the address the tab shows,
 * `error` its load failure, `reload` loads that address again.
 */
export function useDevServerStart({
  project,
  url,
  error,
  loading,
  reload,
}: {
  project?: string;
  url: string;
  error: string | null;
  loading: boolean;
  reload: () => void;
}): DevServerOffer {
  const starts = useSyncExternalStore(
    subscribeDevServerStarts,
    devServerStartsSnapshot,
    devServerStartsSnapshot,
  );
  const start = url ? devServerStartFor(starts, url) : undefined;
  const local = !!url && isLocalDevAddress(url);
  const [script, setScript] = useState<{
    project: string;
    value: DevScript | null;
  }>();
  const [failed, setFailed] = useState<string>();
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const errorRef = useRef(error);
  errorRef.current = error;

  // Read the project's scripts only while the tab shows the failure.
  useEffect(() => {
    if (!error || !local || !project) return;
    let current = true;
    void loadDevScript(project).then((value) => {
      if (current) setScript({ project, value });
    });
    return () => {
      current = false;
    };
  }, [error, local, project]);

  const key = start?.key;
  const since = start?.since;
  const ready = start?.ready;
  // It answered: reload once, and the start is over.
  useEffect(() => {
    if (!key || !ready) return;
    finishDevServerStart(key);
    reloadRef.current();
  }, [key, ready]);
  // Not heard from yet: try again a few times, then give up waiting.
  useEffect(() => {
    if (!key || ready || since === undefined) return;
    const now = Date.now();
    const retries = DEV_SERVER_RETRY_MS.filter((at) => since + at > now).map(
      (at) =>
        window.setTimeout(
          () => {
            if (errorRef.current) reloadRef.current();
          },
          since + at - now,
        ),
    );
    const expire = window.setTimeout(
      () => finishDevServerStart(key),
      Math.max(0, since + DEV_SERVER_START_MS - now),
    );
    return () => {
      for (const timer of retries) window.clearTimeout(timer);
      window.clearTimeout(expire);
    };
  }, [key, ready, since]);
  // One of those tries loaded the page: nothing is left to wait for.
  useEffect(() => {
    if (key && !error && !loading) finishDevServerStart(key);
  }, [error, key, loading]);

  const found = script?.project === project ? script?.value : undefined;
  const starting = start && !start.ready ? start : undefined;
  const canStart =
    local && !!project && !!found && !starting && canStartDevServers();
  const hint = !local
    ? undefined
    : failed
      ? failed
      : found && !canStart && !starting
        ? `Run “${found.run}” in the project's terminal, then press Retry.`
        : found === null || !project
          ? "Start the project's development server in a terminal, then press Retry."
          : undefined;
  return {
    starting,
    canStart,
    hint,
    start: () => {
      if (!project || !found) return;
      setFailed(undefined);
      if (!startDevServer(project, found, url))
        setFailed(
          `Couldn't start it here. Run “${found.run}” in the project's terminal, then press Retry.`,
        );
    },
  };
}

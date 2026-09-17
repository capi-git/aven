import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { leafIds, type LayoutNode } from "./layout";

export type PipGroupTarget = {
  kind: "session" | "browser";
  id: string;
  surfaceId: string;
};

/** All members must be representable: never silently drop a file/terminal pane. */
export function workspacePipGroupTargets(
  members: readonly string[],
  tabs: readonly { id: string; layout: LayoutNode }[],
  sessionIds: ReadonlySet<string>,
  browsers: readonly { surfaceId: string; url: string }[],
): PipGroupTarget[] | null {
  const targets: PipGroupTarget[] = [];
  for (const surfaceId of [...new Set(members)]) {
    const browser = browsers.find((entry) => entry.surfaceId === surfaceId);
    if (browser) {
      if (!browser.url.trim()) return null;
      targets.push({ kind: "browser", id: surfaceId, surfaceId });
      continue;
    }
    const tab = tabs.find((entry) => entry.id === surfaceId);
    if (!tab) return null;
    const ids = leafIds(tab.layout);
    if (!ids.length || ids.some((id) => !sessionIds.has(id))) return null;
    targets.push(
      ...ids.map((id) => ({ kind: "session" as const, id, surfaceId })),
    );
  }
  return targets.length > 1 && targets.length <= 32 ? targets : null;
}

export const groupPictureInPictureWindows = (
  labels: string[],
  selectedLabel: string,
) => invoke<void>("pip_group_windows", { labels, selectedLabel });

/** Native destruction and renderer restoration can arrive in either order. */
export function createWorkspacePipReturns() {
  type Restored = { focus: () => void; hasOwnerActions: boolean };
  const members = new Map<
    string,
    { target: PipGroupTarget; restored?: Restored }
  >();
  const completed = new Map<string, string[]>();
  const finish = () => {
    for (const [selected, labels] of completed) {
      if (labels.some((label) => !members.get(label)?.restored)) continue;
      const returns = labels.map((label) => members.get(label)!.restored!);
      const selectedReturn = members.get(selected)?.restored;
      completed.delete(selected);
      labels.forEach((label) => members.delete(label));
      // Explicit file/diff/terminal actions focus their source before running.
      // A later default focus must not hide the view they just opened.
      const actions = returns.filter((entry) => entry.hasOwnerActions);
      if (actions.length) actions.forEach((entry) => entry.focus());
      else selectedReturn?.focus();
    }
  };
  return {
    register(entries: Array<{ label: string; target: PipGroupTarget }>) {
      for (const { label, target } of entries) members.set(label, { target });
    },
    restored(
      kind: PipGroupTarget["kind"],
      id: string,
      focus: () => void,
      hasOwnerActions = false,
    ): boolean {
      const entry = [...members.values()].find(
        (member) => member.target.kind === kind && member.target.id === id,
      );
      if (!entry) return false;
      entry.restored = { focus, hasOwnerActions };
      finish();
      return true;
    },
    complete(selected: string, labels: string[]) {
      if (!members.has(selected)) return;
      completed.set(
        selected,
        [...new Set(labels)].filter((id) => members.has(id)),
      );
      finish();
    },
    cancel(labels: string[]) {
      const restored: Restored[] = [];
      for (const label of labels) {
        const entry = members.get(label);
        if (entry?.restored) restored.push(entry.restored);
        members.delete(label);
        completed.delete(label);
      }
      restored.forEach((entry) => entry.focus());
    },
  };
}

/** A request exists only during an explicit float action; hidden saved pages stay lazy. */
export function useBrowserPipRequests() {
  const [requests, setRequests] = useState<Record<string, number>>({});
  const sequence = useRef(0);
  const pending = useRef(
    new Map<
      string,
      {
        request: number;
        promise: Promise<string>;
        resolve: (label: string) => void;
        reject: (reason: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >(),
  );
  const request = useCallback((id: string): Promise<string> => {
    const existing = pending.current.get(id);
    if (existing) return existing.promise;
    const token = ++sequence.current;
    let resolve!: (label: string) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<string>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    const timer = setTimeout(() => {
      pending.current.delete(id);
      reject(
        new Error(
          "The browser could not open its floating window. Check the page and try again.",
        ),
      );
    }, 15000);
    pending.current.set(id, {
      request: token,
      promise,
      resolve,
      reject,
      timer,
    });
    setRequests((current) => ({ ...current, [id]: token }));
    return promise;
  }, []);
  const complete = useCallback(
    (id: string, token: number, label: string | null, error?: string) => {
      const entry = pending.current.get(id);
      if (!entry || entry.request !== token) return;
      clearTimeout(entry.timer);
      pending.current.delete(id);
      if (error || !label)
        entry.reject(
          new Error(error || "The floating browser window is unavailable."),
        );
      else entry.resolve(label);
    },
    [],
  );
  useEffect(
    () => () => {
      for (const entry of pending.current.values()) {
        clearTimeout(entry.timer);
        entry.reject(
          new Error("The workspace closed while opening Picture in Picture."),
        );
      }
      pending.current.clear();
    },
    [],
  );
  return { requests, request, complete };
}

import { useMemo, useRef } from "react";

type HeaderEntry = { key: string; members: string[] };
type HeaderState = { sequence: number; entries: HeaderEntry[] };

/** Preserve the strip DOM when its active tab or membership changes. */
export function reconcileWorkspaceHeaders(
  previous: HeaderState,
  groups: Record<string, string[]>,
) {
  const owners = Object.keys(groups);
  const candidates = owners
    .flatMap((owner, nextIndex) =>
      previous.entries.map((entry, oldIndex) => ({
        nextIndex,
        oldIndex,
        ownsActive: entry.members.includes(owner),
        overlap: entry.members.filter((id) => groups[owner].includes(id))
          .length,
      })),
    )
    .filter((candidate) => candidate.overlap > 0)
    .sort(
      (a, b) =>
        Number(b.ownsActive) - Number(a.ownsActive) ||
        b.overlap - a.overlap ||
        a.nextIndex - b.nextIndex,
    );
  const oldUsed = new Set<number>(),
    assigned = new Map<number, string>();
  for (const candidate of candidates) {
    if (assigned.has(candidate.nextIndex) || oldUsed.has(candidate.oldIndex))
      continue;
    assigned.set(candidate.nextIndex, previous.entries[candidate.oldIndex].key);
    oldUsed.add(candidate.oldIndex);
  }
  let sequence = previous.sequence;
  const keys: Record<string, string> = {};
  const entries = owners.map((owner, index) => {
    const key = assigned.get(index) ?? `pane-header-${++sequence}`;
    keys[owner] = key;
    return { key, members: groups[owner] };
  });
  return { state: { sequence, entries }, keys };
}

export function useWorkspaceHeaderKeys(
  workspace: string,
  groups: Record<string, string[]>,
) {
  const previous = useRef({
    workspace,
    state: { sequence: 0, entries: [] } as HeaderState,
  });
  return useMemo(() => {
    const result = reconcileWorkspaceHeaders(
      previous.current.workspace === workspace
        ? previous.current.state
        : { sequence: 0, entries: [] },
      groups,
    );
    previous.current = { workspace, state: result.state };
    return Object.fromEntries(
      Object.entries(result.keys).map(([id, key]) => [
        id,
        `${workspace}:${key}`,
      ]),
    );
  }, [workspace, groups]);
}

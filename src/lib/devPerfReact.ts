/**
 * React render attribution for Aven Dev's speed test. Perf builds
 * (VITE_AVEN_PERF=1) use React's profiling build and put a commit hook in
 * the page before any module loads (scripts/perf-react-hook.js); this reads
 * what it collected. Elsewhere it records nothing.
 */

type Totals = Map<string, { ms: number; renders: number }>;
type HookState = {
  recording: Totals | null;
  commits: number;
  phases: Record<string, number>;
  effects: Totals;
  marks: { at: number; kind: "commit" | "effects" }[];
  overheadMs: number;
};

/** Commit and effect timestamps since `since`, for one interaction. */
export function reactMarksSince(since: number): {
  commits: number;
  /** From the input to the last commit's DOM changes and layout effects. */
  lastCommitMs: number;
  /** From each commit to its passive effects finishing, summed. */
  passiveEffectsMs: number;
} {
  const marks = (hookState()?.marks ?? []).filter((mark) => mark.at >= since);
  let lastCommit = since;
  let passive = 0;
  let commitAt: number | undefined;
  let commits = 0;
  for (const mark of marks) {
    if (mark.kind === "commit") {
      commits += 1;
      commitAt = mark.at;
      lastCommit = mark.at;
    } else if (commitAt !== undefined) {
      passive += mark.at - commitAt;
      commitAt = undefined;
    }
  }
  return {
    commits,
    lastCommitMs: lastCommit - since,
    passiveEffectsMs: passive,
  };
}

function hookState(): HookState | undefined {
  return (window as unknown as { __AVEN_PERF_REACT__?: HookState })
    .__AVEN_PERF_REACT__;
}

export type ReactProfile = {
  commits: number;
  /** Total self render time of named components, ms. */
  renderMs: number;
  /** The components that took the most render time. */
  top: { name: string; ms: number; renders: number }[];
  /** Time in each commit phase (render, commit, layout and passive effects). */
  phases: Record<string, number>;
  /** The components whose effects took the most time. */
  effects: { name: string; ms: number; renders: number }[];
};

export function startReactProfile() {
  const state = hookState();
  if (!state) return;
  state.recording = new Map();
  state.commits = 0;
  state.phases = {};
  state.effects = new Map();
  state.marks = [];
  state.overheadMs = 0;
}

export function stopReactProfile(): ReactProfile | undefined {
  const state = hookState();
  const totals = state?.recording;
  if (!state || !totals) return undefined;
  state.recording = null;
  const entries = [...totals.entries()].map(([name, value]) => ({
    name,
    ms: Math.round(value.ms * 10) / 10,
    renders: value.renders,
  }));
  entries.sort((a, b) => b.ms - a.ms);
  const effects = [...state.effects.entries()].map(([name, value]) => ({
    name,
    ms: Math.round(value.ms * 10) / 10,
    renders: value.renders,
  }));
  effects.sort((a, b) => b.ms - a.ms);
  const phases: Record<string, number> = {};
  for (const [name, ms] of Object.entries(state.phases))
    phases[name] = Math.round(ms * 10) / 10;
  return {
    phases,
    effects: effects.slice(0, 12),
    commits: state.commits,
    renderMs:
      Math.round(entries.reduce((sum, entry) => sum + entry.ms, 0) * 10) / 10,
    top: entries.slice(0, 12),
  };
}

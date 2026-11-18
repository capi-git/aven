import { invoke } from "@tauri-apps/api/core";

/**
 * Whole-machine CPU and memory for the bottom bar's This Mac card, with
 * Aven's share and its scripts' share. Read only while the card is open.
 */

export type GroupStats = {
  /** Share of the whole machine's CPU; null on the first reading. */
  cpuPercent: number | null;
  /** Memory footprint in bytes. */
  memory: number;
};

export type MachineStats = {
  cpuPercent: number | null;
  memoryUsed: number;
  memoryTotal: number;
  aven: GroupStats | null;
  scripts: GroupStats | null;
};

/** How often the open card reads again. */
export const MACHINE_STATS_POLL_MS = 2_000;

export function machineStats(
  scriptPtys: readonly string[],
): Promise<MachineStats | null> {
  return invoke<unknown>("machine_stats", {
    scriptPtys: [...scriptPtys],
  }).then(parseMachineStats);
}

const num = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function parseGroup(value: unknown): GroupStats | null {
  if (!value || typeof value !== "object") return null;
  const { cpuPercent, memory } = value as Record<string, unknown>;
  if (!num(memory)) return null;
  return { cpuPercent: num(cpuPercent) ? cpuPercent : null, memory };
}

/** A reading the card can draw, or null for an odd reply. */
export function parseMachineStats(value: unknown): MachineStats | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!num(v.memoryUsed) || !num(v.memoryTotal)) return null;
  return {
    cpuPercent: num(v.cpuPercent) ? v.cpuPercent : null,
    memoryUsed: v.memoryUsed,
    memoryTotal: v.memoryTotal,
    aven: parseGroup(v.aven),
    scripts: parseGroup(v.scripts),
  };
}

const GB = 1024 ** 3;

/** 11.2, 0.4, 32: one decimal under 100, none for a whole number. */
export function formatGigabytes(bytes: number): string {
  const gb = Math.max(0, bytes) / GB;
  if (gb >= 100 || Number.isInteger(gb)) return String(Math.round(gb));
  return gb.toFixed(1).replace(/\.0$/, "");
}

/** "11.2 of 32 GB". */
export function formatMemoryOf(used: number, total: number): string {
  return `${formatGigabytes(used)} of ${formatGigabytes(total)} GB`;
}

/** "6% · 2.1 GB", or the memory alone before CPU has been measured. */
export function formatGroup(group: GroupStats): string {
  const memory = `${formatGigabytes(group.memory)} GB`;
  return group.cpuPercent == null
    ? memory
    : `${formatPercent(group.cpuPercent)} · ${memory}`;
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0%";
  if (value < 1) return "<1%";
  return `${Math.round(Math.min(100, value))}%`;
}

/** Fill for a bar, 0 to 100. */
export function memoryShare(stats: MachineStats): number {
  return stats.memoryTotal > 0
    ? Math.min(100, (stats.memoryUsed / stats.memoryTotal) * 100)
    : 0;
}

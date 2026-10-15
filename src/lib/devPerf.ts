import { invoke } from "@tauri-apps/api/core";

/**
 * Measuring tools for Aven Dev's speed test (`scripts/dev-aven.py --perf`).
 * Nothing here runs unless that test launched the app.
 */

/** Resolves just after the next frame is produced, as a paint would be. */
export function nextPaint(): Promise<number> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => resolve(performance.now());
      channel.port2.postMessage(0);
    });
  });
}

export type Spread = { n: number; p50: number; p95: number; max: number };

export function spread(values: readonly number[]): Spread {
  if (values.length === 0) return { n: 0, p50: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
  return {
    n: sorted.length,
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    max: round(sorted[sorted.length - 1]),
  };
}

export function round(value: number, places = 1): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

export type FrameStats = Spread & {
  /** Frames that took longer than 1.5 display refreshes. */
  slow: number;
};

/** Frame-to-frame times while recording. Keeps the page drawing every frame. */
export function recordFrames(refreshMs: number) {
  const deltas: number[] = [];
  let last = 0;
  let frame = 0;
  let running = true;
  const tick = (now: number) => {
    if (!running) return;
    if (last) deltas.push(now - last);
    last = now;
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return {
    stop(): FrameStats {
      running = false;
      cancelAnimationFrame(frame);
      return {
        ...spread(deltas),
        slow: deltas.filter((delta) => delta > refreshMs * 1.5).length,
      };
    },
  };
}

export type LongTaskStats = {
  count: number;
  totalMs: number;
  maxMs: number;
} | null;

/** Main-thread tasks over 50 ms while recording; null where unsupported (WebKit). */
export function recordLongTasks() {
  const durations: number[] = [];
  let observer: PerformanceObserver | null = null;
  const supported =
    typeof PerformanceObserver !== "undefined" &&
    PerformanceObserver.supportedEntryTypes?.includes("longtask");
  try {
    if (!supported) throw new Error("unsupported");
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) durations.push(entry.duration);
    });
    observer.observe({ type: "longtask", buffered: false });
  } catch {
    observer = null;
  }
  return {
    stop(): LongTaskStats {
      observer?.disconnect();
      if (!supported) return null;
      return {
        count: durations.length,
        totalMs: round(durations.reduce((sum, value) => sum + value, 0)),
        maxMs: round(Math.max(0, ...durations)),
      };
    },
  };
}

/** The display's frame interval, from frames drawn while nothing changes. */
export async function measureRefresh(): Promise<number> {
  const recorder = recordFrames(1000);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const { p50 } = recorder.stop();
  return p50 > 4 && p50 < 40 ? p50 : 1000 / 60;
}

export type ProcessSample = {
  pid: number;
  ppid: number;
  name: string;
  cpuNs: number;
  idleWakeups: number;
  interruptWakeups: number;
  footprint: number;
};

export type ProcessSnapshot = { at: number; processes: ProcessSample[] };

export async function sampleProcesses(): Promise<ProcessSnapshot> {
  const processes = await invoke<ProcessSample[]>("dev_perf_sample").catch(
    () => [],
  );
  return { at: performance.now(), processes };
}

type Kind =
  | "main"
  | "webkit-content"
  | "webkit-gpu"
  | "webkit-network"
  | "browser-renderer"
  | "browser-helper"
  | "started";

function kindOf(sample: ProcessSample, rootPid: number): Kind {
  if (sample.pid === rootPid) return "main";
  const name = sample.name.toLowerCase();
  // The interface runs in WebKit's processes; Chromium only for browser tabs.
  if (name.startsWith("com.apple.webkit.webcontent")) return "webkit-content";
  if (name.startsWith("com.apple.webkit.gpu")) return "webkit-gpu";
  if (name.startsWith("com.apple.webkit")) return "webkit-network";
  if (!name.includes("helper")) return "started";
  if (name.includes("renderer") || name.includes("(ren"))
    return "browser-renderer";
  return "browser-helper";
}

export type ProcessUse = {
  /** CPU used by Aven itself (app and its Chromium helpers), as % of one core. */
  cpuPct: number;
  idleWakeupsPerSec: number;
  interruptWakeupsPerSec: number;
  /** Memory footprint of Aven itself at the end, MB. */
  footprintMB: number;
  /** Footprint of processes Aven started (agents, shells), MB. */
  startedFootprintMB: number;
  byKind: Record<
    string,
    { count: number; cpuPct: number; footprintMB: number }
  >;
  /** The busiest single process, often the GPU helper. */
  busiest?: { name: string; cpuPct: number; idleWakeupsPerSec: number };
};

/** What Aven's processes used between two snapshots. */
export function processUse(
  before: ProcessSnapshot,
  after: ProcessSnapshot,
): ProcessUse {
  const seconds = Math.max(0.001, (after.at - before.at) / 1000);
  const rootPid = after.processes.find((sample) => sample.ppid === 0)?.pid ?? 0;
  const earlier = new Map(
    before.processes.map((sample) => [sample.pid, sample]),
  );
  const byKind: ProcessUse["byKind"] = {};
  let cpuNs = 0;
  let idle = 0;
  let interrupts = 0;
  let footprint = 0;
  let started = 0;
  let busiest: ProcessUse["busiest"];
  for (const sample of after.processes) {
    const prior = earlier.get(sample.pid);
    const kind = kindOf(sample, rootPid);
    const footprintMB = sample.footprint / 1024 / 1024;
    if (kind === "started") {
      started += footprintMB;
      continue;
    }
    const cpu = Math.max(0, sample.cpuNs - (prior?.cpuNs ?? 0));
    const idleDelta = Math.max(
      0,
      sample.idleWakeups - (prior?.idleWakeups ?? 0),
    );
    cpuNs += cpu;
    idle += idleDelta;
    interrupts += Math.max(
      0,
      sample.interruptWakeups - (prior?.interruptWakeups ?? 0),
    );
    footprint += footprintMB;
    const entry = (byKind[kind] ??= { count: 0, cpuPct: 0, footprintMB: 0 });
    entry.count += 1;
    entry.cpuPct = round(entry.cpuPct + cpu / 1e7 / seconds);
    entry.footprintMB = round(entry.footprintMB + footprintMB, 0);
    const cpuPct = cpu / 1e7 / seconds;
    if (!busiest || cpuPct > busiest.cpuPct)
      busiest = {
        name: sample.name,
        cpuPct: round(cpuPct),
        idleWakeupsPerSec: round(idleDelta / seconds),
      };
  }
  return {
    cpuPct: round(cpuNs / 1e7 / seconds),
    idleWakeupsPerSec: round(idle / seconds),
    interruptWakeupsPerSec: round(interrupts / seconds),
    footprintMB: round(footprint, 0),
    startedFootprintMB: round(started, 0),
    byKind,
    busiest,
  };
}

/** Chromium's JS heap, MB, when the page exposes it. */
export function heapMB(): number | undefined {
  const memory = (
    performance as Performance & { memory?: { usedJSHeapSize: number } }
  ).memory;
  return memory ? round(memory.usedJSHeapSize / 1024 / 1024, 0) : undefined;
}

export function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

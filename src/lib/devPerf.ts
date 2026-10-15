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

export type HotCalls = {
  /** Calls that make WebKit style and lay out the page right away. */
  forcedLayout: { calls: number; ms: number; byCaller: Record<string, number> };
  json: { calls: number; ms: number };
  storage: { calls: number; ms: number };
  /** DOM changes that took noticeable time, by kind. */
  dom: { calls: number; ms: number; byKind: Record<string, number> };
};

/**
 * While recording, time the calls that usually explain slow script: reads
 * that force style and layout, JSON.stringify, and localStorage. Restores
 * every patched function on stop.
 */
export function recordHotCalls() {
  const totals: HotCalls = {
    forcedLayout: { calls: 0, ms: 0, byCaller: {} },
    json: { calls: 0, ms: 0 },
    storage: { calls: 0, ms: 0 },
    dom: { calls: 0, ms: 0, byKind: {} },
  };
  const timeDom = (kind: string) => (ms: number) => {
    totals.dom.calls += 1;
    totals.dom.ms += ms;
    if (ms > 0.3) {
      const where = `${kind} ← ${caller() || "unknown"}`;
      totals.dom.byKind[where] = (totals.dom.byKind[where] ?? 0) + ms;
    }
  };
  const restores: (() => void)[] = [];
  const caller = () => {
    // The first app frame below this file names who forced layout.
    const lines = (new Error().stack ?? "").split("\n").slice(3);
    const line = lines.find((entry) => !entry.includes("devPerf")) ?? "";
    return line
      .replace(/^\s*at\s+/, "")
      .replace(/\(?https?:\/\/[^)]*\/assets\//, "(")
      .slice(0, 80);
  };
  const timeLayout = (ms: number) => {
    totals.forcedLayout.calls += 1;
    totals.forcedLayout.ms += ms;
    if (ms > 0.5) {
      const where = caller() || "unknown";
      totals.forcedLayout.byCaller[where] =
        (totals.forcedLayout.byCaller[where] ?? 0) + ms;
    }
  };
  const wrapMethod = (
    target: object,
    name: string,
    record: (ms: number) => void,
  ) => {
    const original = (target as Record<string, unknown>)[name];
    if (typeof original !== "function") return;
    (target as Record<string, unknown>)[name] = function (
      this: unknown,
      ...args: unknown[]
    ) {
      const begin = performance.now();
      try {
        return (original as (...a: unknown[]) => unknown).apply(this, args);
      } finally {
        record(performance.now() - begin);
      }
    };
    restores.push(() => {
      (target as Record<string, unknown>)[name] = original;
    });
  };
  const wrapGetter = (target: object, name: string) => {
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    if (!descriptor?.get) return;
    const get = descriptor.get;
    const set = descriptor.set;
    Object.defineProperty(target, name, {
      ...descriptor,
      get(this: unknown) {
        const begin = performance.now();
        try {
          return get.call(this);
        } finally {
          timeLayout(performance.now() - begin);
        }
      },
      // Scroll offsets also force style and layout when written.
      ...(set
        ? {
            set(this: unknown, value: unknown) {
              const begin = performance.now();
              try {
                set.call(this, value);
              } finally {
                timeLayout(performance.now() - begin);
              }
            },
          }
        : {}),
    });
    restores.push(() => Object.defineProperty(target, name, descriptor));
  };
  for (const name of [
    "getBoundingClientRect",
    "getClientRects",
    "scrollIntoView",
    "scrollTo",
    "scrollBy",
  ])
    wrapMethod(Element.prototype, name, timeLayout);
  wrapMethod(HTMLElement.prototype, "focus", timeLayout);
  for (const name of ["offsetWidth", "offsetHeight", "offsetTop", "offsetLeft"])
    wrapGetter(HTMLElement.prototype, name);
  for (const name of [
    "clientWidth",
    "clientHeight",
    "scrollWidth",
    "scrollHeight",
    "scrollTop",
    "scrollLeft",
  ])
    wrapGetter(Element.prototype, name);
  for (const name of [
    "appendChild",
    "insertBefore",
    "removeChild",
    "replaceChild",
  ])
    wrapMethod(Node.prototype, name, timeDom(name));
  for (const name of [
    "setAttribute",
    "removeAttribute",
    "toggleAttribute",
    "remove",
    "blur",
  ])
    wrapMethod(Element.prototype, name, timeDom(name));
  for (const name of ["inert", "hidden"]) {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      name,
    );
    if (descriptor?.set) {
      const set = descriptor.set;
      const record = timeDom(name);
      Object.defineProperty(HTMLElement.prototype, name, {
        ...descriptor,
        set(this: HTMLElement, value: unknown) {
          const begin = performance.now();
          try {
            set.call(this, value);
          } finally {
            record(performance.now() - begin);
          }
        },
      });
      restores.push(() =>
        Object.defineProperty(HTMLElement.prototype, name, descriptor),
      );
    }
  }
  // Reading a computed style value makes WebKit resolve styles right away.
  // Wrap getComputedStyle so each value read on its result is timed.
  const originalComputed = window.getComputedStyle;
  window.getComputedStyle = function (
    this: Window,
    element: Element,
    pseudo?: string | null,
  ) {
    const style = originalComputed.call(this, element, pseudo);
    return new Proxy(style, {
      get(target, property) {
        const begin = performance.now();
        const value = Reflect.get(target, property, target);
        const result = typeof value === "function" ? value.bind(target) : value;
        timeLayout(performance.now() - begin);
        return result;
      },
    });
  } as typeof window.getComputedStyle;
  restores.push(() => {
    window.getComputedStyle = originalComputed;
  });
  wrapMethod(JSON, "stringify", (ms) => {
    totals.json.calls += 1;
    totals.json.ms += ms;
  });
  for (const name of ["getItem", "setItem", "removeItem"])
    wrapMethod(Storage.prototype, name, (ms) => {
      totals.storage.calls += 1;
      totals.storage.ms += ms;
    });
  return {
    stop(): HotCalls {
      for (const restore of restores.reverse()) restore();
      totals.forcedLayout.ms = round(totals.forcedLayout.ms);
      totals.json.ms = round(totals.json.ms);
      totals.storage.ms = round(totals.storage.ms);
      totals.dom.ms = round(totals.dom.ms);
      for (const key of Object.keys(totals.dom.byKind))
        totals.dom.byKind[key] = round(totals.dom.byKind[key]);
      for (const key of Object.keys(totals.forcedLayout.byCaller))
        totals.forcedLayout.byCaller[key] = round(
          totals.forcedLayout.byCaller[key],
        );
      return totals;
    },
  };
}

export type RestyleCost = {
  element: string;
  attribute: string;
  /** Style and layout time when this attribute alone changes back and forth. */
  ms: number;
};

function describe(element: Element): string {
  const classes = [...element.classList].slice(0, 3).join(".");
  return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${classes ? `.${classes}` : ""}`;
}

function forceLayout(): number {
  const begin = performance.now();
  void document.body.getBoundingClientRect().height;
  void document.documentElement.offsetHeight;
  return performance.now() - begin;
}

/**
 * Which attribute changes make WebKit restyle and lay out the most. Runs
 * `action`, records every attribute it changed, then replays each change on
 * its own (old value, new value) and times the style and layout it costs.
 */
export async function analyzeRestyle(
  action: () => unknown,
  settle: () => Promise<unknown>,
): Promise<{
  changes: number;
  nodesAdded: number;
  nodesRemoved: number;
  costs: RestyleCost[];
  /** The largest subtrees added or removed, with their element counts. */
  subtrees: { change: string; element: string; elements: number }[];
}> {
  const records: MutationRecord[] = [];
  const observer = new MutationObserver((list) => records.push(...list));
  observer.observe(document.documentElement, {
    attributes: true,
    attributeOldValue: true,
    childList: true,
    subtree: true,
  });
  await action();
  await settle();
  records.push(...observer.takeRecords());
  observer.disconnect();
  let nodesAdded = 0;
  let nodesRemoved = 0;
  const subtrees: { change: string; element: string; elements: number }[] = [];
  const size = (node: Node) =>
    node instanceof Element ? 1 + node.getElementsByTagName("*").length : 0;
  const latest = new Map<
    string,
    { element: Element; name: string; old: string | null }
  >();
  const order: string[] = [];
  const ids = new WeakMap<Element, number>();
  let next = 0;
  for (const record of records) {
    if (record.type === "childList") {
      nodesAdded += record.addedNodes.length;
      nodesRemoved += record.removedNodes.length;
      for (const node of record.addedNodes)
        if (node instanceof Element)
          subtrees.push({
            change: "added",
            element: describe(node),
            elements: size(node),
          });
      for (const node of record.removedNodes)
        if (node instanceof Element)
          subtrees.push({
            change: "removed",
            element: describe(node),
            elements: size(node),
          });
      continue;
    }
    const element = record.target as Element;
    if (!ids.has(element)) ids.set(element, next++);
    const key = `${ids.get(element)}:${record.attributeName}`;
    // Keep the oldest value: the state before the action.
    if (!latest.has(key)) {
      latest.set(key, {
        element,
        name: record.attributeName!,
        old: record.oldValue,
      });
      order.push(key);
    }
  }
  const costs: RestyleCost[] = [];
  forceLayout();
  for (const key of order) {
    const { element, name, old } = latest.get(key)!;
    if (!element.isConnected) continue;
    const now = element.getAttribute(name);
    if (now === old) continue;
    const set = (value: string | null) =>
      value === null
        ? element.removeAttribute(name)
        : element.setAttribute(name, value);
    set(old);
    const back = forceLayout();
    set(now);
    const forth = forceLayout();
    costs.push({
      element: describe(element),
      attribute: name,
      ms: round((back + forth) / 2),
    });
  }
  costs.sort((a, b) => b.ms - a.ms);
  subtrees.sort((a, b) => b.elements - a.elements);
  return {
    changes: order.length,
    nodesAdded,
    nodesRemoved,
    costs: costs.slice(0, 12),
    subtrees: subtrees.slice(0, 6),
  };
}

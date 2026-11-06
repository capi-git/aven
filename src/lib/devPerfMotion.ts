import {
  auditMotion,
  type MotionFinding,
  type MotionFrame,
  type MotionInput,
  type MotionTrace,
} from "./motionAudit";

/** The dragged tab's floating copy: it takes over from the tab and hands back. */
export const TAB_COPY = "tab-copy";

/**
 * The elements the speed test's motion check follows, each by a key that
 * stays the same from frame to frame, and the key of what holds it (for
 * neighbours that jump when something beside them comes or goes).
 */
const KEYED: readonly {
  selector: string;
  key: (element: HTMLElement) => string | null;
  parent: string;
}[] = [
  // A tab's face, which its motion moves; the slot around it (its hit box)
  // stays put and jumps to its new place when the order commits.
  {
    selector: ".aven-tab-strip [data-motion-slot] > [data-sortable-motion]",
    key: (element) =>
      element.parentElement?.dataset.motionSlot
        ? `tab:${element.parentElement.dataset.motionSlot}`
        : null,
    parent: "tabs",
  },
  {
    selector: ".aven-tab-strip [data-motion-slot]",
    key: (element) => `tab:${element.dataset.motionSlot}`,
    parent: "tabs",
  },
  {
    selector: "[data-sortable-copy]",
    key: () => TAB_COPY,
    parent: "window",
  },
  {
    selector: ".personal-navigation [data-motion-key]",
    key: (element) => `row:${element.dataset.motionKey}`,
    parent: "sidebar",
  },
  {
    selector: ".personal-navigation",
    key: () => "sidebar",
    parent: "window",
  },
  {
    selector: "[data-workspace-stage]",
    key: () => "workspace",
    parent: "window",
  },
  {
    selector: "[data-app-settings]",
    key: () => "settings",
    parent: "window",
  },
  {
    selector: "[data-prompt-anchor]",
    key: (element) => `message:${element.dataset.promptAnchor}`,
    parent: "transcript",
  },
];

/** Elements laid out but out of sight (a hidden tab) are left out. */
function shown(element: HTMLElement, box: DOMRect) {
  if (box.width <= 0 || box.height <= 0) return false;
  return getComputedStyle(element).visibility !== "hidden";
}

/** The element's opacity times its ancestors', each read once a frame. */
function opacityOf(element: HTMLElement, seen: Map<Element, number>): number {
  const known = seen.get(element);
  if (known !== undefined) return known;
  const own = Number.parseFloat(getComputedStyle(element).opacity);
  const parent = element.parentElement;
  const value =
    (Number.isFinite(own) ? own : 1) * (parent ? opacityOf(parent, seen) : 1);
  seen.set(element, value);
  return value;
}

/**
 * Records, every frame, where each keyed element is drawn and how opaque it
 * is (transforms included, as `getBoundingClientRect` sees them), with the
 * inputs a move marks. Reading the boxes in an animation frame costs a
 * layout the frame would do anyway; the check runs apart from the timed
 * scenarios, so its own cost is in no figure.
 */
export function recordMotion(name: string) {
  const frames: MotionFrame[] = [];
  const inputs: MotionInput[] = [];
  const parents: Record<string, string> = {};
  const started = performance.now();
  let frame = 0;
  let stopped = false;
  const sample = () => {
    if (stopped) return;
    const els: MotionFrame["els"] = {};
    const opacities = new Map<Element, number>();
    for (const { selector, key, parent } of KEYED) {
      for (const element of document.querySelectorAll<HTMLElement>(selector)) {
        const id = key(element);
        if (!id || id in els) continue;
        const box = element.getBoundingClientRect();
        if (!shown(element, box)) continue;
        els[id] = [
          Math.round(box.left * 10) / 10,
          Math.round(box.top * 10) / 10,
          Math.round(box.width * 10) / 10,
          Math.round(box.height * 10) / 10,
          Math.round(opacityOf(element, opacities) * 1000) / 1000,
        ];
        parents[id] = parent;
      }
    }
    frames.push({ t: Math.round(performance.now() - started), els });
    frame = requestAnimationFrame(sample);
  };
  frame = requestAnimationFrame(sample);
  return {
    /** ms since the recording started, the clock inputs and paths use. */
    now: () => Math.round(performance.now() - started),
    /** Marks an input now, with what it should do. */
    input(input: Omit<MotionInput, "t">) {
      inputs.push({ ...input, t: Math.round(performance.now() - started) });
    },
    stop(): MotionTrace {
      stopped = true;
      cancelAnimationFrame(frame);
      return {
        name,
        width: window.innerWidth,
        height: window.innerHeight,
        frames,
        inputs,
        parents,
        handoffs: [TAB_COPY],
      };
    },
  };
}

export type MotionRecorder = ReturnType<typeof recordMotion>;

export type MotionCheckResult = {
  name: string;
  frames: number;
  findings: MotionFinding[];
  error?: string;
};

export function checkMotion(trace: MotionTrace): MotionCheckResult {
  return {
    name: trace.name,
    frames: trace.frames.length,
    findings: auditMotion(trace),
  };
}

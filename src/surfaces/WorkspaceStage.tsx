import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  layoutLeaves,
  layoutSashes,
  type LayoutNode,
  type LayoutRect,
  type LayoutSash,
  type SplitDir,
} from "../lib/layout";
import {
  clientRectScale,
  effectiveCssZoom,
  suppressTextSelection,
} from "../lib/drag";
import {
  defaultPaneMinimum,
  fitLayout,
  fitShares,
  resizeSash,
  sashOffset,
  stepSash,
  type FitSash,
  type LayoutFit,
  type PaneMinimum,
} from "../lib/paneFit";
import { evenSplit, railedLeafIds, unrailLeaf } from "../lib/paneRails";
import {
  captureScrollOffsets,
  HiddenSurfaceClock,
  restoreScrollOffsets,
  type ScrollOffsets,
} from "../lib/hiddenSurfaces";
import {
  MOTION_ATTRIBUTE,
  motionReduced,
  playBounded,
  playMotion,
  type BoundedMotion,
} from "../lib/motion";
import { subscribeMemoryPressure } from "../lib/memoryPressure";
import {
  browserHandoffPending,
  waitForBrowserHandoff,
} from "../lib/browserHandoff";
import { WORKSPACE_DROP_FEEDBACK } from "../hooks/useBrowserDropIndicator";
import {
  DOCK_EASE,
  DOCK_PREVIEW_INSET,
  DOCK_TWEEN_MS,
  dockClip,
  dockOverlap,
  dockZone,
  dockZoneFraction,
  type DockRect,
} from "../lib/paneDock";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
} from "../chrome/icons";
import { paneMinimizeControls, type PaneMinimize } from "../lib/paneMinimize";
import {
  TAB_PREVIEW_ENTER_SCALE,
  TAB_PX_PRECISION,
  TAB_SPRING,
  TAB_UNIT_PRECISION,
} from "../lib/motionTokens";
import { SpringAnimator } from "../lib/spring";
import { flushSync } from "react-dom";
import "./WorkspaceStage.css";

export type WorkspaceSurfaceDropTarget =
  | { id: string; edge: "left" | "right" | "up" | "down" }
  | {
      id: string;
      edge: "tab";
      /** Visible slot used to place the drop indicator. */
      index?: number;
      /** Full group position when hidden Recent tabs precede the slot. */
      orderIndex?: number;
    };
export type WorkspaceStageProps = {
  layout: LayoutNode | null;
  focusedId: string;
  visible: boolean;
  surfaces: Array<{ id: string; content: ReactNode }>;
  headers?: Array<{ id: string; key?: string; content: ReactNode }>;
  onFocus: (id: string) => void;
  onLayoutChange: (layout: LayoutNode) => void;
  onMinimizeSide?: (
    splitId: string,
    index: number,
    side: "before" | "after",
  ) => void;
  /**
   * Each pane offers Collapse in its own "…" (paneMinimizeControls), so the
   * headers draw no collapse arrows; dragging a divider past a pane's
   * minimum still folds it to a rail.
   */
  hideInMenu?: boolean;
  onRestoreSplit?: () => void;
  restoreEdge?: "left" | "right" | "up" | "down";
  restoreStatus?: "working" | "attention";
  dragTarget: WorkspaceSurfaceDropTarget | null;
  dragging: boolean;
  dragLabel?: string;
  dragKind?: "tab" | "group";
  /**
   * The pane expanded over the others (Cydonia's zoom), if any. It glides
   * from its place to the whole stage while the others fade under it, and
   * back again on Restore. A native page lands at its new bounds instead.
   */
  zoomedId?: string | null;
  /**
   * The strip entry in front (Cydonia's window tab), and which way the
   * strip moved to reach it. A new key switches the whole arrangement: the
   * incoming panes slide in a little and fade up while the outgoing ones
   * fade away. A step of 0 (another project) switches at once.
   */
  arrangement?: { key: string; step: number } | null;
  /**
   * Bumped when an arrangement change should glide (a split, a closed or
   * restored pane, a Move): each pane glides from its old place to its new.
   */
  glide?: number;
  /**
   * The least room the pane whose tab in front is `id` needs (paneFit.ts).
   * Dividers stop there, and a pane dragged well past it collapses to a rail.
   */
  paneMinimum?: PaneMinimum;
  /** What a collapsed pane's rail shows: its tabs, and a name for it. */
  railContent?: (id: string) => { label: string; content: ReactNode } | null;
  /** A rail was clicked: open its pane and focus it. */
  onRestoreRail?: (id: string) => void;
  /**
   * The pane a tab just moved into (by its tab in front): its title row
   * glows once, as its strip entry does. A new `nonce` plays it again.
   */
  landed?: { id: string; nonce: number } | null;
};

/** Map a visible insertion boundary to retained membership without moving hidden pages. */
function retainedDropIndex(
  header: HTMLElement,
  tabs: readonly HTMLElement[],
  index: number,
): number {
  const serialized = header.querySelector<HTMLElement>("[data-surface-order]")
    ?.dataset.surfaceOrder;
  if (!serialized) return index;
  try {
    const order: unknown = JSON.parse(serialized);
    if (
      !Array.isArray(order) ||
      !order.every((id): id is string => typeof id === "string") ||
      new Set(order).size !== order.length ||
      tabs.some((tab) => !order.includes(tab.dataset.surfaceTabId ?? ""))
    )
      return index;
    const next = tabs[index]?.dataset.surfaceTabId;
    if (next) return order.indexOf(next);
    const previous = tabs[index - 1]?.dataset.surfaceTabId;
    return previous ? order.indexOf(previous) + 1 : index;
  } catch {
    return index;
  }
}

/** A header's members in their full order, when its strip publishes them. */
function headerMembers(header: HTMLElement): string[] | null {
  const serialized = header.querySelector<HTMLElement>("[data-surface-order]")
    ?.dataset.surfaceOrder;
  if (!serialized) return null;
  try {
    const order: unknown = JSON.parse(serialized);
    return Array.isArray(order) &&
      order.length > 0 &&
      order.every((id): id is string => typeof id === "string") &&
      new Set(order).size === order.length
      ? order
      : null;
  } catch {
    return null;
  }
}

/**
 * Where a tab dragged to (x, y) docks, in client coordinates so native
 * browser stacking never matters. As in Cydonia: a pane's lone title row,
 * or the middle of its body, stacks the tab in that pane; within a quarter
 * of an edge it splits that side (see paneDock.ts). A header that lays out
 * tabs (a title row with several, a detached window's strip) takes the tab
 * at the slot it is over.
 */
export function workspaceSurfaceDropAt(
  container: HTMLElement,
  x: number,
  y: number,
  draggedId: string,
  previous?: WorkspaceSurfaceDropTarget | null,
  draggedIds: readonly string[] = [draggedId],
): WorkspaceSurfaceDropTarget | null {
  if (container.closest('[hidden], [inert], [aria-hidden="true"]')) return null;
  const headers = new Map(
    [
      ...container.querySelectorAll<HTMLElement>(
        ":scope > [data-workspace-header]",
      ),
    ].map((header) => [header.dataset.workspaceHeader, header]),
  );
  for (const surface of container.querySelectorAll<HTMLElement>(
    "[data-workspace-surface]",
  )) {
    const id = surface.dataset.workspaceSurface;
    if (
      !id ||
      surface.closest("[data-workspace-stage]") !== container ||
      surface.closest('[hidden], [inert], [aria-hidden="true"]')
    )
      continue;
    const header = headers.get(id);
    const tabs = header
      ? [...header.querySelectorAll<HTMLElement>("[data-surface-tab-id]")]
      : [];
    // A title row may show only some of its tabs; its strip lists them all.
    const members =
      (header && headerMembers(header)) ??
      tabs.map((tab) => tab.dataset.surfaceTabId ?? "");
    // A selected tab can split away from its own group only if a sibling
    // remains to occupy the original pane. Its own header still reorders.
    const moving = new Set(draggedIds);
    const sameGroup = members.some((member) => moving.has(member));
    if (
      (id === draggedId && members.length < 2) ||
      (sameGroup && members.every((member) => moving.has(member)))
    )
      continue;
    if (header) {
      const rect = header.getBoundingClientRect();
      if (
        rect.width > 0 &&
        rect.height > 0 &&
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom
      ) {
        if (sameGroup) return null;
        // A lone title row takes the tab into its pane; a row of tabs (a
        // title row with several, or a detached window's strip) takes it at
        // the slot it is over.
        if (
          header.querySelector(
            '[data-variant="title"]:not([data-title-layout="tabs"])',
          )
        )
          return { id, edge: "tab" };
        const measuredTabs = tabs
          .map((tab) => ({ tab, rect: tab.getBoundingClientRect() }))
          .filter(({ rect }) => rect.width > 0 && rect.height > 0);
        const before = measuredTabs.findIndex(
          ({ rect }) => x < rect.left + rect.width / 2,
        );
        const index = before < 0 ? measuredTabs.length : before;
        const orderIndex = retainedDropIndex(
          header,
          measuredTabs.map(({ tab }) => tab),
          index,
        );
        return {
          id,
          edge: "tab",
          index,
          ...(orderIndex !== index ? { orderIndex } : {}),
        };
      }
    }
    const body = surface.querySelector<HTMLElement>(
      ":scope > [data-workspace-body]",
    );
    const rect = (body ?? surface).getBoundingClientRect();
    const held =
      previous?.id === id
        ? previous.edge === "tab"
          ? previous.index === undefined
            ? "join"
            : null
          : previous.edge
        : null;
    const zone = dockZone(rect, x, y, held);
    if (!zone) continue;
    if (zone !== "join") return { id, edge: zone };
    return sameGroup ? null : { id, edge: "tab" };
  }
  return null;
}

/** A share of a pane's body, inset as the docking preview is. */
const previewStyle = (rect: LayoutRect): CSSProperties => ({
  left: `calc(${rect.x * 100}% + ${DOCK_PREVIEW_INSET}px)`,
  top: `calc(${rect.y * 100}% + ${DOCK_PREVIEW_INSET}px)`,
  width: `calc(${rect.w * 100}% - ${2 * DOCK_PREVIEW_INSET}px)`,
  height: `calc(${rect.h * 100}% - ${2 * DOCK_PREVIEW_INSET}px)`,
});

/** A box on screen in the stage's own CSS pixels. */
function stageBox(stage: HTMLElement, rect: DOMRect): DockRect {
  const zoom = effectiveCssZoom(stage) || 1;
  const outer = stage.getBoundingClientRect();
  return {
    left: (rect.left - outer.left) / zoom,
    top: (rect.top - outer.top) / zoom,
    width: rect.width / zoom,
    height: rect.height / zoom,
  };
}

/** A drop is followed by its new layout within this long, or not at all. */
const DROP_REVEAL_WINDOW_MS = 1000;
/** Cydonia's zoom: a pane glides to the whole space in 200ms, eased out. */
export const ZOOM_GLIDE_MS = 200;
/** Switching strip entries crossfades the arrangements in 180ms. */
export const SWITCH_MS = 180;
/** The outgoing arrangement is gone within the switch's first 60%. */
const SWITCH_OUT_MS = Math.round(SWITCH_MS * 0.6);
/** How far the incoming arrangement slides in from the side it comes from. */
const SWITCH_SHIFT_PX = 24;

type PaneBox = { left: number; top: number; width: number; height: number };

/**
 * How a pane glides between two places. Same size: it moves. Growing: it
 * is laid out at once at its new size and its clip opens from where it
 * stood. A page held as a picture scales from where it stood: its picture
 * stretches with it. A page of HTML that shrinks is never scaled (its text
 * would stretch): it takes its new size at once and only moves, if it
 * moves at all.
 */
export function paneGlideKeyframes(
  from: PaneBox,
  to: PaneBox,
  pictured = false,
): Keyframe[] {
  const moved = `translate(${from.left - to.left}px, ${from.top - to.top}px)`;
  const still =
    Math.abs(from.left - to.left) < 1 && Math.abs(from.top - to.top) < 1;
  if (
    Math.abs(from.width - to.width) < 1 &&
    Math.abs(from.height - to.height) < 1
  )
    return [{ transform: moved }, { transform: "translate(0px, 0px)" }];
  if (
    !pictured &&
    (from.width > to.width + 0.5 || from.height > to.height + 0.5)
  )
    return still
      ? []
      : [{ transform: moved }, { transform: "translate(0px, 0px)" }];
  if (
    !pictured &&
    from.width <= to.width + 0.5 &&
    from.height <= to.height + 0.5
  )
    return [
      { clipPath: dockClip(from, to, 0) },
      { clipPath: "inset(0px 0px 0px 0px round 0px)" },
    ];
  return [
    {
      transformOrigin: "0 0",
      transform: `${moved} scale(${from.width / to.width}, ${from.height / to.height})`,
    },
    { transformOrigin: "0 0", transform: "translate(0px, 0px) scale(1, 1)" },
  ];
}

/** A live native page cannot move with its pane; a pictured one can. */
function paneCanGlide(surface: HTMLElement): "html" | "pictured" | null {
  if (!surface.querySelector(".browser-native-host")) return "html";
  return surface.querySelector(".browser-motion-image") ? "pictured" : null;
}

// WK animation frames may be deferred while native Chromium covers its view.
// Bound that wait only during a drag; the first callback cancels the other.
const DRAG_FRAME_DEADLINE_MS = 16;

function applyGeometry(element: HTMLElement, values: CSSProperties) {
  for (const [name, value] of Object.entries(values)) {
    if (value != null && element.style.getPropertyValue(name) !== String(value))
      element.style.setProperty(name, String(value));
  }
}
/** Half of the gap between panes. Panes meet flush, and the hairline that
 * divides them is drawn in this one-pixel gap: native browser children need
 * a real gap, because CSS stacking cannot draw over them. */
export const PANE_GUTTER = 0.5;
const GUTTER = PANE_GUTTER;
/** Space between the panes and the workspace's outer edges: none. The
 * workspace's own regions (sidebar, side panel, toolbar) draw the hairline
 * on that edge. */
export const WORKSPACE_EDGE = 0;
const EDGE = WORKSPACE_EDGE;
function surfaceStyle(rect: LayoutRect, inset = 0): CSSProperties {
  const epsilon = 0.000001;
  const left = (rect.x > epsilon ? GUTTER : EDGE) + inset;
  const top = (rect.y > epsilon ? GUTTER : EDGE) + inset;
  const right = (rect.x + rect.w < 1 - epsilon ? GUTTER : EDGE) + inset;
  const bottom = (rect.y + rect.h < 1 - epsilon ? GUTTER : EDGE) + inset;
  // Percentages to a millionth of a percent: enough for any screen, and no
  // float noise ("2.8000000000000003%") in the style.
  const percent = (fraction: number) => Math.round(fraction * 1e8) / 1e6;
  const position = (fraction: number, inset: number) =>
    inset
      ? `calc(${percent(fraction)}% + ${inset}px)`
      : `${percent(fraction)}%`;
  const size = (fraction: number, inset: number) =>
    inset
      ? `calc(${percent(fraction)}% - ${inset}px)`
      : `${percent(fraction)}%`;
  return {
    left: position(rect.x, left),
    top: position(rect.y, top),
    width: size(rect.w, left + right),
    height: size(rect.h, top + bottom),
  };
}
/** A shared wallpaper canvas, clipped by each pane's existing bounds. */
function surfaceBackgroundStyle(rect: LayoutRect) {
  const left = rect.x > 0.000001 ? GUTTER : EDGE;
  const top = rect.y > 0.000001 ? GUTTER : EDGE;
  return {
    "--workspace-background-left": `calc(${-rect.x * 100}cqw - ${left}px)`,
    "--workspace-background-top": `calc(${-rect.y * 100}cqh - ${top}px - var(--workspace-background-header-offset))`,
  };
}
const headerStyle = (rect: LayoutRect): CSSProperties => ({
  ...surfaceStyle(rect),
  height: "32px",
});
const sashKey = (sash: { splitId: string; index: number }) =>
  `${sash.splitId}:${sash.index}`;
const sashBoundary = (sash: LayoutSash) =>
  sash.sizes.slice(0, sash.index + 1).reduce((sum, size) => sum + size, 0);
/**
 * A divider as the stage draws it: where it stands as shares of the stage,
 * and, when the stage is measured, the split's lengths in pixels.
 */
type StageSash = {
  key: string;
  splitId: string;
  index: number;
  dir: SplitDir;
  /** Its split's box and its place along it, as shares of the stage. */
  group: LayoutRect;
  at: number;
  /** Where it stands within its split, 0–100, for assistive technology. */
  value: number;
  fit?: FitSash;
};
const share = (value: number) => Math.round(value * 1e6) / 1e6;
function stageSashes(
  layout: LayoutNode | null,
  fit: LayoutFit | null,
): StageSash[] {
  if (!layout) return [];
  if (fit?.adjusted)
    return fit.sashes.map((sash) => {
      const offset = sashOffset(sash);
      const row = sash.dir === "right";
      const span = row ? sash.group.w : sash.group.h;
      return {
        key: sashKey(sash),
        splitId: sash.splitId,
        index: sash.index,
        dir: sash.dir,
        group: {
          x: share(sash.group.x / fit.width),
          y: share(sash.group.y / fit.height),
          w: share(sash.group.w / fit.width),
          h: share(sash.group.h / fit.height),
        },
        at: share(
          row
            ? (sash.group.x + offset) / fit.width
            : (sash.group.y + offset) / fit.height,
        ),
        value: Math.round((offset / Math.max(1, span)) * 100),
        fit: sash,
      };
    });
  const fitted = new Map(
    (fit?.sashes ?? []).map((sash) => [sashKey(sash), sash]),
  );
  return layoutSashes(layout).map((sash) => {
    const boundary = sashBoundary(sash);
    const row = sash.dir === "right";
    return {
      key: sashKey(sash),
      splitId: sash.splitId,
      index: sash.index,
      dir: sash.dir,
      group: sash.group,
      at: row
        ? sash.group.x + boundary * sash.group.w
        : sash.group.y + boundary * sash.group.h,
      value: Math.round(boundary * 100),
      fit: fitted.get(sashKey(sash)),
    };
  });
}
function sashStyle(sash: StageSash): CSSProperties {
  return sash.dir === "right"
    ? {
        left: `${sash.at * 100}%`,
        top: `${sash.group.y * 100}%`,
        height: `${sash.group.h * 100}%`,
      }
    : {
        left: `${sash.group.x * 100}%`,
        top: `${sash.at * 100}%`,
        width: `${sash.group.w * 100}%`,
      };
}
/** Panes as shares of the stage: fitted when anything is held to a size. */
function stagePlaces(
  layout: LayoutNode | null,
  fit: LayoutFit | null,
): Map<string, LayoutRect> {
  if (!layout) return new Map();
  if (fit?.adjusted) return fitShares(fit);
  return new Map(layoutLeaves(layout).map((leaf) => [leaf.id, leaf.rect]));
}
/** The axis each collapsed leaf's rail is thin along. */
function railAxes(layout: LayoutNode | null): Map<string, "x" | "y"> {
  const axes = new Map<string, "x" | "y">();
  const walk = (node: LayoutNode, axis?: "x" | "y") => {
    if (node.type === "leaf") {
      if (axis) axes.set(node.id, axis);
      return;
    }
    const own = node.dir === "right" ? "x" : "y";
    for (const child of node.children)
      walk(child, axis ?? (child.rail !== undefined ? own : undefined));
  };
  if (layout) walk(layout);
  return axes;
}
/** The stage's size in its own CSS pixels, on either WebKit. */
function stageSize(stage: HTMLElement): { width: number; height: number } {
  if (stage.clientWidth > 0 && stage.clientHeight > 0)
    return { width: stage.clientWidth, height: stage.clientHeight };
  const bounds = stage.getBoundingClientRect();
  const local = clientRectScale(stage) / (effectiveCssZoom(stage) || 1);
  return { width: bounds.width * local, height: bounds.height * local };
}
const SurfaceContent = memo(function SurfaceContent({
  content,
}: {
  content: ReactNode;
}) {
  return content;
});

/**
 * The panes that fade in: those a new split adds while every pane already
 * on screen stays. A tab switch, the stage coming back from Settings and the
 * first layout bring panes in at once.
 */
export function newSplitPanes(
  before: ReadonlySet<string> | null,
  now: ReadonlySet<string>,
): string[] {
  if (!before?.size || ![...before].every((id) => now.has(id))) return [];
  return [...now].filter((id) => !before.has(id));
}

export function WorkspaceStage({
  layout,
  focusedId,
  visible,
  surfaces,
  headers = [],
  onFocus,
  onLayoutChange,
  onMinimizeSide,
  hideInMenu = false,
  onRestoreSplit,
  restoreEdge = "left",
  restoreStatus,
  dragTarget,
  dragging,
  dragLabel,
  dragKind = "tab",
  zoomedId = null,
  arrangement = null,
  glide = 0,
  paneMinimum = defaultPaneMinimum,
  railContent,
  onRestoreRail,
  landed = null,
}: WorkspaceStageProps) {
  const stage = useRef<HTMLDivElement>(null);
  // The stage's size in CSS pixels, so panes keep their minimums and rails
  // their width as the window changes. Unmeasured (0), panes take their
  // shares as they are. Kept in a ref, read without forcing a layout; the
  // stage draws again on a resize only when a pane is held to a size (a
  // rail, a minimum), since shares alone follow the window by themselves.
  const sizeRef = useRef({ width: 0, height: 0 });
  const [, setSizeDrawn] = useState(sizeRef.current);
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const held = (box: { width: number; height: number }) => {
      const tree = current.current.layout;
      return (
        !!tree &&
        box.width > 0 &&
        box.height > 0 &&
        fitLayout(tree, box.width, box.height, current.current.paneMinimum)
          .adjusted
      );
    };
    const measure = (width: number, height: number) => {
      const previous = sizeRef.current;
      if (
        Math.abs(previous.width - width) < 0.5 &&
        Math.abs(previous.height - height) < 0.5
      )
        return;
      const next = { width, height };
      sizeRef.current = next;
      if (held(previous) || held(next)) setSizeDrawn(next);
    };
    measure(element.clientWidth, element.clientHeight);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.contentRect;
      if (box) measure(box.width, box.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // A divider dragged past a pane's minimum shows it on a rail at once;
  // these are the leaves on rails while the drag lasts.
  const [draftRails, setDraftRails] = useState<ReadonlySet<string> | null>(
    null,
  );
  // Publish only committed destination changes; native pages draw their own
  // pointer-transparent counterpart above Chromium without hiding the page.
  useLayoutEffect(() => {
    stage.current?.dispatchEvent(
      new Event(WORKSPACE_DROP_FEEDBACK, { bubbles: true }),
    );
  }, [
    visible,
    dragging,
    dragTarget?.id,
    dragTarget?.edge,
    dragTarget?.edge === "tab" ? dragTarget.index : undefined,
    dragLabel,
    dragKind,
    layout,
  ]);
  useLayoutEffect(() => {
    const element = stage.current;
    return () => {
      element?.dispatchEvent(
        new CustomEvent(WORKSPACE_DROP_FEEDBACK, {
          bubbles: true,
          detail: { clear: true },
        }),
      );
    };
  }, []);
  const surfaceNodes = useRef(new Map<string, HTMLDivElement>());
  const headerNodes = useRef(new Map<string, HTMLDivElement>());
  const sashNodes = useRef(new Map<string, HTMLDivElement>());
  const railNodes = useRef(new Map<string, HTMLButtonElement>());
  const lastMinimizedSash = useRef<string | null>(null);
  const pendingFocus = useRef<"restore" | "split" | null>(null);
  useLayoutEffect(() => {
    if (
      !dragging ||
      dragTarget?.edge !== "tab" ||
      dragTarget.index === undefined
    )
      return;
    const header = headerNodes.current.get(dragTarget.id);
    const marker = header?.querySelector<HTMLElement>("[data-drop-insertion]");
    if (!header || !marker) return;
    const rect = header.getBoundingClientRect();
    const tabs = [
      ...header.querySelectorAll<HTMLElement>("[data-surface-tab-id]"),
    ];
    const index = Math.min(dragTarget.index, tabs.length);
    const position =
      index < tabs.length
        ? tabs[index].getBoundingClientRect().left
        : (tabs[tabs.length - 1]?.getBoundingClientRect().right ?? rect.left);
    // Rectangles are in viewport pixels; the hosted toolbar can counterzoom
    // its contents, so position the marker and its edge insets in local pixels.
    const zoom = effectiveCssZoom(header);
    const localPosition = (position - rect.left) / zoom;
    marker.style.left = `${Math.max(1, Math.min(rect.width / zoom - 2, localPosition))}px`;
  }, [dragging, dragTarget]);
  const current = useRef({
    layout,
    onFocus,
    onLayoutChange,
    onMinimizeSide,
    paneMinimum,
  });
  current.current = {
    layout,
    onFocus,
    onLayoutChange,
    onMinimizeSide,
    paneMinimum,
  };
  const stopResize = useRef<((commit: boolean) => void) | null>(null);
  const size = sizeRef.current;
  const fit =
    layout && size.width > 0 && size.height > 0
      ? fitLayout(layout, size.width, size.height, paneMinimum)
      : null;
  const places = stagePlaces(layout, fit);
  const committedRails = new Set(railedLeafIds(layout));
  const railed = draftRails ?? committedRails;
  // Open panes only: a collapsed one is drawn as its rail.
  const leaves = (layout ? layoutLeaves(layout) : [])
    .filter((leaf) => !railed.has(leaf.id))
    .map((leaf) => ({ ...leaf, rect: places.get(leaf.id) ?? leaf.rect }));
  const positions = new Map(leaves.map((leaf) => [leaf.id, leaf.rect]));
  // Open as committed: what a drag shows mid-way must not remount headers.
  const committedOpen = (layout ? layoutLeaves(layout) : []).filter(
    (leaf) => !committedRails.has(leaf.id),
  );
  const axes = railAxes(layout);
  const rails = [...places]
    .filter(([id]) => railed.has(id))
    .map(([id, rect]) => ({ id, rect, axis: axes.get(id) ?? "x" }));
  const sashes = stageSashes(layout, fit);
  function minimizePane(sash: LayoutSash, side: "before" | "after") {
    if (!current.current.onMinimizeSide) return;
    lastMinimizedSash.current = sashKey(sash);
    pendingFocus.current = "restore";
    current.current.onMinimizeSide(sash.splitId, sash.index, side);
  }
  // Keep controls inside the header's reserved 32px strip. Chromium draws above
  // the web app, so a floating control over a pane body cannot be relied on.
  // With `hideInMenu` each pane offers them in its own "…" instead.
  const paneMinimizes = paneMinimizeControls(layout);
  const minimizeControls =
    onMinimizeSide && !hideInMenu
      ? paneMinimizes
      : new Map<string, PaneMinimize[]>();
  const restoreHeaderId = onRestoreSplit
    ? [...leaves].sort((a, b) => {
        if (restoreEdge === "right")
          return (
            b.rect.x + b.rect.w - a.rect.x - a.rect.w || a.rect.y - b.rect.y
          );
        if (restoreEdge === "down")
          return (
            b.rect.y + b.rect.h - a.rect.y - a.rect.h || a.rect.x - b.rect.x
          );
        if (restoreEdge === "up")
          return a.rect.y - b.rect.y || a.rect.x - b.rect.x;
        return a.rect.x - b.rect.x || a.rect.y - b.rect.y;
      })[0]?.id
    : undefined;
  // A pane with no header of its own (a tab whose panes name themselves)
  // still gets an empty one where it holds a minimize or restore control.
  const displayHeaders = [...headers];
  if (onMinimizeSide || onRestoreSplit) {
    for (const { id } of committedOpen) {
      if (
        !displayHeaders.some((header) => header.id === id) &&
        (minimizeControls.has(id) || id === restoreHeaderId)
      )
        displayHeaders.push({ id, content: null });
    }
  }
  const headerContents = new Map(
    displayHeaders.map(({ id, content }) => [id, content]),
  );
  useLayoutEffect(() => {
    if (!visible || !pendingFocus.current) return;
    const target =
      pendingFocus.current === "restore"
        ? (stage.current?.querySelector<HTMLElement>(
            ".workspace-pane-restore",
          ) ??
          stage.current?.querySelector<HTMLElement>(".workspace-pane-rail"))
        : ((lastMinimizedSash.current
            ? sashNodes.current.get(lastMinimizedSash.current)
            : null) ??
          headerNodes.current
            .get(focusedId)
            ?.querySelector<HTMLElement>("button, [tabindex='0']"));
    if (target) {
      target.focus({ preventScroll: true });
      pendingFocus.current = null;
    }
  }, [layout, visible, focusedId, restoreHeaderId]);
  // Hidden tabs already keep their React/native owners. Keep the last visited
  // layout too, so returning to a workspace does not rebuild every text/editor
  // measurement from a display:none subtree. Only committed visits are warm;
  // this cache never owns children, callbacks, or closed surfaces.
  const retainedGeometry = useRef(
    new Map<string, { rect: LayoutRect; hasHeader: boolean }>(),
  );
  useLayoutEffect(() => {
    const liveIds = new Set(surfaces.map(({ id }) => id));
    for (const id of retainedGeometry.current.keys()) {
      if (!liveIds.has(id)) retainedGeometry.current.delete(id);
    }
    if (!visible) return;
    for (const [id, rect] of positions) {
      if (liveIds.has(id))
        retainedGeometry.current.set(id, {
          rect,
          hasHeader: headerContents.has(id),
        });
    }
  });
  // Long-hidden surfaces drop their render trees; see hiddenSurfaces.ts.
  const hiddenClock = useRef(new HiddenSurfaceClock());
  const [demoted, setDemoted] = useState<ReadonlySet<string>>(new Set());
  const demotedScroll = useRef(new Map<string, ScrollOffsets>());
  const shownIds = visible ? [...positions.keys()] : [];
  const hiddenKey = surfaces
    .map(({ id }) => id)
    .filter((id) => !shownIds.includes(id))
    .join("\0");
  const demote = useCallback((ids: readonly string[]) => {
    if (!ids.length) return;
    for (const id of ids) {
      const node = surfaceNodes.current.get(id);
      if (node && !demotedScroll.current.has(id))
        demotedScroll.current.set(id, captureScrollOffsets(node));
    }
    setDemoted((previous) => {
      if (ids.every((id) => previous.has(id))) return previous;
      return new Set([...previous, ...ids]);
    });
  }, []);
  useEffect(() => {
    const clock = hiddenClock.current;
    clock.update(hiddenKey ? hiddenKey.split("\0") : [], Date.now());
    if (!clock.size) return;
    // No idle polling: age is checked when the hidden set changes and when
    // the window's focus or visibility changes. Leaving the app or memory
    // pressure releases every hidden surface at once.
    demote(clock.due(Date.now()));
    const sweep = () => demote(clock.due(Date.now()));
    const releaseAll = () => demote(clock.all());
    const visibility = () => {
      if (document.hidden) releaseAll();
    };
    window.addEventListener("focus", sweep);
    window.addEventListener("blur", sweep);
    document.addEventListener("visibilitychange", visibility);
    const unsubscribe = subscribeMemoryPressure(releaseAll);
    return () => {
      window.removeEventListener("focus", sweep);
      window.removeEventListener("blur", sweep);
      document.removeEventListener("visibilitychange", visibility);
      unsubscribe();
    };
  }, [hiddenKey, demote]);
  const promoted = shownIds.filter((id) => demoted.has(id));
  if (promoted.length)
    setDemoted((previous) => {
      const next = new Set(previous);
      for (const id of promoted) next.delete(id);
      return next;
    });
  // A switch into a native browser page: surfaces that just left stay painted
  // underneath until the page is shown, so the window background never
  // flashes between them. See browserHandoff.ts.
  const committedShown = useRef<readonly string[]>([]);
  const [heldOut, setHeldOut] = useState<ReadonlySet<string>>(new Set());
  const held = new Set(
    [
      ...heldOut,
      ...committedShown.current.filter((id) =>
        retainedGeometry.current.has(id),
      ),
    ].filter(
      // A pane folding to its rail is not handed off: its page hides at once.
      (id) => visible && !shownIds.includes(id) && !railed.has(id),
    ),
  );
  const heldKey = [...held].join("\0");
  useLayoutEffect(() => {
    committedShown.current = shownIds;
  });
  // Switching strip entries: the arrangement in front changes whole.
  const arrangementShown = useRef<string | null>(null);
  const switching =
    visible &&
    !!arrangement &&
    arrangement.step !== 0 &&
    arrangementShown.current !== null &&
    arrangementShown.current !== arrangement.key;
  // A newly opened split pane fades in beside the panes already there. A
  // switch (between tabs, or back from Settings) appears at once: fading the
  // incoming pane gave it a layer of its own and measurably slowed switching.
  const motionShown = useRef<ReadonlySet<string> | null>(null);
  const shownKey = shownIds.join("\0");
  useLayoutEffect(() => {
    const before = motionShown.current;
    const now = new Set(shownKey ? shownKey.split("\0") : []);
    motionShown.current = now;
    for (const id of newSplitPanes(before, now))
      playMotion(surfaceNodes.current.get(id), "pane-in");
  }, [shownKey]);
  // Zoom: the pane that was expanded when this stage last drew, and where
  // each pane stood then, as shares of the stage.
  const zoomShown = useRef<string | null>(null);
  const zoomPlaces = useRef(new Map<string, LayoutRect>());
  // Expanding, not a tab switch inside the pane already expanded: the stage
  // last showed several panes.
  const zoomEntering =
    visible &&
    !!zoomedId &&
    zoomShown.current !== zoomedId &&
    zoomPlaces.current.size > 1 &&
    positions.has(zoomedId);
  useLayoutEffect(() => {
    if (!held.size) return;
    // Another strip entry in front: the panes it replaces fade away while
    // its own come in. A page held as a picture fades with its pane.
    if (switching && !motionReduced()) {
      setHeldOut(new Set(held));
      const fades = [...held].flatMap((id) => {
        const node = surfaceNodes.current.get(id);
        return node && typeof node.animate === "function"
          ? [
              // Gone in the first part of the switch, so the two
              // arrangements are not read over each other.
              node.animate([{ opacity: 1 }, { opacity: 0 }], {
                duration: SWITCH_OUT_MS,
                easing: DOCK_EASE,
                fill: "forwards",
              }),
            ]
          : [];
      });
      // As with the zoom below, a timer ends the hold and so the fades.
      const timer = window.setTimeout(() => setHeldOut(new Set()), SWITCH_MS);
      return () => {
        window.clearTimeout(timer);
        for (const fade of fades) fade.cancel();
      };
    }
    // A pane expanding: the panes it covers fade out beneath it.
    if (zoomEntering && !motionReduced()) {
      setHeldOut(new Set(held));
      // The hold ends on a timer, which is what removes these panes; each
      // fade only dims them on the way and is dropped with the hold, so a
      // timeline WebKit holds back cannot leave a pane half faded.
      const fades = [...held].flatMap((id) => {
        const node = surfaceNodes.current.get(id);
        return node && typeof node.animate === "function"
          ? [
              node.animate([{ opacity: 1 }, { opacity: 0 }], {
                duration: ZOOM_GLIDE_MS,
                easing: DOCK_EASE,
                fill: "forwards",
              }),
            ]
          : [];
      });
      const timer = window.setTimeout(
        () => setHeldOut(new Set()),
        ZOOM_GLIDE_MS,
      );
      return () => {
        window.clearTimeout(timer);
        for (const fade of fades) fade.cancel();
      };
    }
    // Children's layout effects have run, so incoming pages have registered.
    // Always set a new object: the surfaces that just left are derived from
    // the previous commit and need this render to drop or keep them.
    if (!browserHandoffPending()) {
      setHeldOut(new Set());
      return;
    }
    setHeldOut(new Set(held));
    let cancelled = false;
    void waitForBrowserHandoff().then(() => {
      if (!cancelled) setHeldOut(new Set());
    });
    return () => {
      cancelled = true;
    };
  }, [heldKey]);
  useLayoutEffect(() => {
    // `display: none` cleared the offsets; the same DOM nodes are back.
    for (const [id, saved] of demotedScroll.current) {
      if (!shownIds.includes(id)) continue;
      restoreScrollOffsets(saved);
      demotedScroll.current.delete(id);
    }
  });
  // From the committed layout: a rail shown mid-drag must not end the drag.
  const headerIds = committedOpen
    .filter(({ id }) => headerContents.has(id))
    .map(({ id }) => id)
    .join("\0");

  function paintSurface(id: string, rect: LayoutRect) {
    const element = surfaceNodes.current.get(id);
    if (!element) return;
    applyGeometry(element, surfaceStyle(rect));
    for (const [name, value] of Object.entries(surfaceBackgroundStyle(rect)))
      if (element.style.getPropertyValue(name) !== value)
        element.style.setProperty(name, value);
  }

  /** Fit `tree` to the stage as measured now (or at a drag's start). */
  function fitNow(
    tree: LayoutNode,
    measured?: { width: number; height: number },
  ): LayoutFit | null {
    // The size last measured; a stage not measured yet is read once.
    const box =
      measured ??
      (sizeRef.current.width > 0
        ? sizeRef.current
        : stage.current
          ? stageSize(stage.current)
          : { width: 0, height: 0 });
    return box.width > 0 && box.height > 0
      ? fitLayout(tree, box.width, box.height, current.current.paneMinimum)
      : null;
  }

  function paint(
    tree: LayoutNode,
    measured?: { width: number; height: number },
  ) {
    const fitted = fitNow(tree, measured);
    const placed = stagePlaces(tree, fitted);
    const onRails = new Set(railedLeafIds(tree));
    for (const [id, rect] of placed) {
      if (onRails.has(id)) {
        const rail = railNodes.current.get(id);
        if (rail) applyGeometry(rail, surfaceStyle(rect));
        continue;
      }
      paintSurface(id, rect);
      const header = headerNodes.current.get(id);
      if (header && header.dataset.workspaceHeaderHosted !== "toolbar")
        applyGeometry(header, headerStyle(rect));
    }
    for (const sash of stageSashes(tree, fitted)) {
      const element = sashNodes.current.get(sash.key);
      if (!element) continue;
      applyGeometry(element, sashStyle(sash));
      const value = String(sash.value);
      if (element.getAttribute("aria-valuenow") !== value)
        element.setAttribute("aria-valuenow", value);
    }
    stage.current?.dispatchEvent(
      new Event("supermono:workspace-layout", { bubbles: true }),
    );
  }

  useLayoutEffect(() => {
    stopResize.current?.(false);
    // A cancelled drag may have painted draft sizes directly on panes that
    // just left the current layout. Restore their committed measurements too.
    for (const [id, { rect }] of retainedGeometry.current) {
      if (!visible || !positions.has(id)) paintSurface(id, rect);
    }
    if (visible && layout) paint(layout);
  }, [layout, visible, headerIds]);
  // Where a moved tab landed: its pane's title row glows once.
  useLayoutEffect(() => {
    if (!landed || !visible) return;
    playMotion(headerNodes.current.get(landed.id), "land");
    // Only a new landing plays it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landed?.nonce]);
  // A rail shown or taken away mid-drag mounts or unmounts nodes: draw them
  // where the drag has them.
  const dragDraft = useRef<{
    tree: LayoutNode;
    size: { width: number; height: number };
  } | null>(null);
  useLayoutEffect(() => {
    const draft = dragDraft.current;
    if (draft && draftRails) paint(draft.tree, draft.size);
  }, [draftRails]);
  useEffect(() => () => stopResize.current?.(false), []);

  const joining = dragTarget?.edge === "tab" && dragTarget.index === undefined;
  const hintZone = joining
    ? "join"
    : dragTarget && dragTarget.edge !== "tab"
      ? dragTarget.edge
      : null;
  const hint = hintZone ? dockZoneFraction(hintZone) : null;

  // Expanding a pane (or putting it back) glides it between its place and
  // the whole stage in 200ms, eased out: growing, it is laid out at once at
  // its new size and its clip opens from where it stood; shrinking, it
  // scales down from the whole stage while the panes it uncovers fade in
  // (newSplitPanes). A native page moves as its picture when one was taken
  // in time (browserMotion.ts); otherwise it lands at its new bounds.
  useLayoutEffect(() => {
    const container = stage.current;
    const previous = zoomShown.current;
    const before = new Map(zoomPlaces.current);
    if (visible) {
      zoomShown.current = zoomedId;
      zoomPlaces.current = new Map(positions);
    }
    if (!container || !visible || motionReduced()) return;
    // Measured only when a pane does glide: reading the stage's size forces
    // a layout, which an ordinary tab switch must not pay.
    const px = (rect: LayoutRect): DockRect => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      return {
        left: rect.x * width,
        top: rect.y * height,
        width: rect.w * width,
        height: rect.h * height,
      };
    };
    const glide = (id: string, from: DockRect, to: DockRect, grow: boolean) => {
      const surface = surfaceNodes.current.get(id);
      const kind = surface ? paneCanGlide(surface) : null;
      if (!surface || !kind || typeof surface.animate !== "function") return;
      if (to.width <= 0 || to.height <= 0) return;
      const timing = { duration: ZOOM_GLIDE_MS, easing: DOCK_EASE };
      // A page held as a picture scales with its pane either way.
      play(
        surface,
        grow && kind === "html"
          ? [
              { clipPath: dockClip(from, to, 0) },
              { clipPath: "inset(0px 0px 0px 0px round 0px)" },
            ]
          : paneGlideKeyframes(from, to, true),
        timing,
      );
      // The title row never scales its text: growing, its clip opens with
      // the pane; shrinking, it moves to its place at its new width.
      const header = headerNodes.current.get(id);
      if (!header || typeof header.animate !== "function") return;
      play(
        header,
        grow
          ? [
              {
                clipPath: dockClip(
                  { ...from, height: 32 },
                  { ...to, height: 32 },
                  0,
                ),
              },
              { clipPath: "inset(0px 0px 0px 0px round 0px)" },
            ]
          : [
              {
                transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)`,
              },
              { transform: "translate(0px, 0px)" },
            ],
        timing,
      );
    };
    if (
      zoomedId &&
      previous !== zoomedId &&
      before.size > 1 &&
      positions.size === 1
    ) {
      const from = before.get(zoomedId);
      const to = positions.get(zoomedId);
      if (from && to) glide(zoomedId, px(from), px(to), true);
    } else if (
      !zoomedId &&
      previous &&
      positions.size > 1 &&
      positions.has(previous)
    ) {
      const from = before.get(previous);
      const to = positions.get(previous);
      if (from && to) glide(previous, px(from), px(to), false);
    }
    // Positions are derived from the layout this effect follows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomedId, layout, visible]);

  // The incoming arrangement of a strip switch slides in from the side the
  // strip moved to, fading up as the outgoing one fades (held, above).
  useLayoutEffect(() => {
    const previous = arrangementShown.current;
    if (visible && arrangement) arrangementShown.current = arrangement.key;
    if (
      !visible ||
      !arrangement ||
      arrangement.step === 0 ||
      previous === null ||
      previous === arrangement.key ||
      motionReduced()
    )
      return;
    const shift = Math.sign(arrangement.step) * SWITCH_SHIFT_PX;
    for (const id of positions.keys())
      for (const node of [
        surfaceNodes.current.get(id),
        headerNodes.current.get(id),
      ]) {
        if (!node || typeof node.animate !== "function") continue;
        play(
          node,
          [
            { opacity: 0, transform: `translateX(${shift}px)` },
            { opacity: 1, transform: "translateX(0px)" },
          ],
          { duration: SWITCH_MS, easing: DOCK_EASE },
        );
      }
    // Positions follow the arrangement this effect follows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrangement?.key, visible]);

  // A split, a closed or restored pane or a Move: each pane that stays
  // glides from its old place to its new one, in the zoom's 200ms.
  const glidePlaces = useRef(new Map<string, LayoutRect>());
  const glideSeen = useRef(glide);
  useLayoutEffect(() => {
    const before = glidePlaces.current;
    if (visible) glidePlaces.current = new Map(positions);
    const asked = glideSeen.current !== glide;
    glideSeen.current = glide;
    const container = stage.current;
    if (!asked || !container || !visible || motionReduced()) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    const px = (rect: LayoutRect): PaneBox => ({
      left: rect.x * width,
      top: rect.y * height,
      width: rect.w * width,
      height: rect.h * height,
    });
    for (const [id, rect] of positions) {
      const was = before.get(id);
      if (
        !was ||
        (was.x === rect.x &&
          was.y === rect.y &&
          was.w === rect.w &&
          was.h === rect.h)
      )
        continue;
      const surface = surfaceNodes.current.get(id);
      const kind = surface ? paneCanGlide(surface) : null;
      if (!surface || !kind || typeof surface.animate !== "function") continue;
      const from = px(was);
      const to = px(rect);
      if (to.width <= 0 || to.height <= 0) continue;
      play(surface, paneGlideKeyframes(from, to, kind === "pictured"), {
        duration: ZOOM_GLIDE_MS,
        easing: DOCK_EASE,
      });
      const header = headerNodes.current.get(id);
      if (header && typeof header.animate === "function")
        play(
          header,
          [
            {
              transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)`,
            },
            { transform: "translate(0px, 0px)" },
          ],
          { duration: ZOOM_GLIDE_MS, easing: DOCK_EASE },
        );
    }
    // Positions are derived from the layout this effect follows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, visible, glide]);

  // The docking preview, drawn once over the whole stage so it can glide
  // between zones and between panes (Cydonia's 150ms tween). The hint in the
  // target pane's body says where it goes; a native page reads that hint for
  // its own indicator, which stands still. When a drop splits a pane, the
  // pane it makes grows from the preview to its place while the preview
  // fades.
  const previewNode = useRef<HTMLDivElement>(null);
  const previewState = useRef<{
    box: DockRect | null;
    /** Its edges, opacity and entering scale, each on a spring. */
    springs: SpringAnimator<"l" | "t" | "w" | "h" | "o" | "s"> | null;
    /** Where it is laid out; its springs are drawn relative to this. */
    laid: DockRect | null;
    /** The side it grows from: the zone's edge, as a share of its box. */
    pivot: { x: number; y: number };
    leaving: boolean;
    split: boolean;
    dragLayout: LayoutNode | null;
  }>({
    box: null,
    springs: null,
    laid: null,
    pivot: { x: 0.5, y: 0.5 },
    leaving: false,
    split: false,
    dragLayout: null,
  });
  const dropReveal = useRef<{
    box: DockRect;
    until: number;
    from: LayoutNode | null;
  } | null>(null);
  // Every animation this stage starts is bounded (see playBounded), so a
  // timeline WebKit holds back under a native page never leaves a preview,
  // a clip or a fading pane on screen. Unmounting stops them all.
  const stageMotions = useRef(new Set<BoundedMotion>());
  const play = (
    element: Element,
    keyframes: Keyframe[],
    options: { duration: number; easing?: string; fill?: FillMode },
    onEnd?: () => void,
  ) => {
    const motions = stageMotions.current;
    const motion: BoundedMotion = playBounded(
      element,
      keyframes,
      options,
      () => {
        motions.delete(motion);
        onEnd?.();
      },
    );
    motions.add(motion);
    return {
      animation: motion.animation,
      stop() {
        motions.delete(motion);
        motion.stop();
      },
    } satisfies BoundedMotion;
  };
  useLayoutEffect(() => {
    const motions = stageMotions.current;
    const preview = previewState.current;
    return () => {
      for (const motion of motions) motion.stop();
      motions.clear();
      preview.springs?.cancel();
      preview.springs = null;
    };
  }, []);
  const revealDrop = (box: DockRect) => {
    const container = stage.current;
    if (!container || motionReduced()) return;
    let best: { id: string; overlap: number } | null = null;
    for (const id of positions.keys()) {
      const node = surfaceNodes.current.get(id);
      if (!node) continue;
      const body =
        node.querySelector<HTMLElement>(":scope > [data-workspace-body]") ??
        node;
      const overlap = dockOverlap(
        stageBox(container, body.getBoundingClientRect()),
        box,
      );
      if (!best || overlap > best.overlap) best = { id, overlap };
    }
    if (!best || best.overlap < 0.5) return;
    for (const node of [
      surfaceNodes.current.get(best.id),
      headerNodes.current.get(best.id),
    ]) {
      if (!node || typeof node.animate !== "function") continue;
      // The reveal replaces the plain fade-in of a new split.
      if (node.getAttribute(MOTION_ATTRIBUTE) === "pane-in")
        node.removeAttribute(MOTION_ATTRIBUTE);
      const to = stageBox(container, node.getBoundingClientRect());
      if (to.width <= 0 || to.height <= 0) continue;
      play(
        node,
        [
          { clipPath: dockClip(box, to) },
          { clipPath: "inset(0px 0px 0px 0px round 0px)" },
        ],
        { duration: DOCK_TWEEN_MS, easing: DOCK_EASE },
      );
    }
  };
  useLayoutEffect(() => {
    const element = previewNode.current;
    const container = stage.current;
    if (!element || !container) return;
    const state = previewState.current;
    const reduced = motionReduced();
    if (dragging) state.dragLayout = layout;
    const hintNode =
      visible && dragging
        ? container.querySelector<HTMLElement>("[data-workspace-drop-hint]")
        : null;
    const target = hintNode
      ? stageBox(container, hintNode.getBoundingClientRect())
      : null;
    // The preview's box is drawn from springs on its edges, relative to
    // where it is laid out: a new target retargets from the box on screen
    // and its speed, so it glides between zones and never jumps.
    const springs = (state.springs ??= new SpringAnimator(
      {
        l: { spring: TAB_SPRING.move, precision: TAB_PX_PRECISION },
        t: { spring: TAB_SPRING.move, precision: TAB_PX_PRECISION },
        w: { spring: TAB_SPRING.move, precision: TAB_PX_PRECISION },
        h: { spring: TAB_SPRING.move, precision: TAB_PX_PRECISION },
        o: { spring: TAB_SPRING.fade, precision: TAB_UNIT_PRECISION },
        s: { spring: TAB_SPRING.lift, precision: TAB_UNIT_PRECISION },
      },
      { l: 0, t: 0, w: 0, h: 0, o: 0, s: 1 },
      ({ l, t, w, h, o, s }) => {
        const laid = state.laid;
        if (!laid || laid.width <= 0 || laid.height <= 0)
          return [[element, { transform: "none", opacity: String(o) }]];
        // Grown about the side it comes from.
        const width = w * s;
        const height = h * s;
        const left = l + (w - width) * state.pivot.x;
        const top = t + (h - height) * state.pivot.y;
        const round = (value: number, places: number) =>
          Math.round(value * 10 ** places) / 10 ** places;
        return [
          [
            element,
            {
              transform: `translate(${round(left - laid.left, 3)}px, ${round(top - laid.top, 3)}px) scale(${round(width / laid.width, 5)}, ${round(height / laid.height, 5)})`,
              opacity: String(round(o, 4)),
            },
          ],
        ];
      },
    ));
    if (!target || target.width <= 0 || target.height <= 0) {
      if (!dragging && state.box && state.split)
        dropReveal.current = {
          box: state.box,
          until: performance.now() + DROP_REVEAL_WINDOW_MS,
          from: state.dragLayout,
        };
      if (state.box && !state.leaving) {
        // Fades where it is; it is gone when its springs end, run or not.
        state.leaving = true;
        springs.to({ o: 0 }, { instant: reduced });
        springs.onSettle(() => {
          if (!state.leaving) return;
          state.leaving = false;
          element.dataset.shown = "false";
        });
      } else if (!state.leaving) element.dataset.shown = "false";
      state.box = null;
      state.split = false;
    } else {
      // Fresh only when nothing of it is showing: coming back while it fades
      // out, it turns round from what is drawn.
      const fresh = springs.state().o.value <= 0.01;
      state.leaving = false;
      state.laid = target;
      element.style.left = `${target.left}px`;
      element.style.top = `${target.top}px`;
      element.style.width = `${target.width}px`;
      element.style.height = `${target.height}px`;
      element.dataset.shown = "true";
      // The side it grows from is set as it appears and kept until it has
      // grown: changing it mid-growth would shift the box.
      if (fresh) {
        const zone = hintZone ?? "join";
        state.pivot = {
          x: zone === "left" ? 0 : zone === "right" ? 1 : 0.5,
          y: zone === "up" ? 0 : zone === "down" ? 1 : 0.5,
        };
      }
      const box = {
        l: target.left,
        t: target.top,
        w: target.width,
        h: target.height,
      };
      if (fresh)
        // In from the side it splits, fading and growing a little.
        springs.to(
          { ...box, o: 1, s: 1 },
          {
            from: { ...box, o: 0, s: TAB_PREVIEW_ENTER_SCALE },
            velocity: { l: 0, t: 0, w: 0, h: 0, o: 0, s: 0 },
            instant: reduced,
          },
        );
      else springs.to({ ...box, o: 1, s: 1 }, { instant: reduced });
      state.box = target;
      state.split = hintZone !== null && hintZone !== "join";
    }
    const pending = dropReveal.current;
    if (pending && !dragging) {
      if (performance.now() > pending.until) dropReveal.current = null;
      else if (layout !== pending.from) {
        dropReveal.current = null;
        revealDrop(pending.box);
      }
    }
    // The hint's zone and pane say all the preview needs; the layout is for
    // the drop's own reveal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, dragging, dragTarget?.id, dragTarget?.edge, hintZone, layout]);

  /** The divider `sash` as fitted to the stage now, in pixels. */
  function measuredSash(
    tree: LayoutNode,
    sash: StageSash,
    measured: { width: number; height: number },
  ): FitSash | undefined {
    return fitNow(tree, measured)?.sashes.find(
      (candidate) =>
        candidate.splitId === sash.splitId && candidate.index === sash.index,
    );
  }

  function startResize(
    event: ReactPointerEvent<HTMLDivElement>,
    sash: StageSash,
  ) {
    const tree = current.current.layout;
    const container = stage.current;
    if (!visible || event.button !== 0 || !tree || !container) return;
    stopResize.current?.(false);
    const measured = stageSize(container);
    const fitted = measuredSash(tree, sash, measured);
    if (!fitted) return;
    const horizontal = sash.dir === "right";
    const startPointer = horizontal ? event.clientX : event.clientY;
    // Pointer travel is in the viewport's pixels; the panes are laid out in
    // the stage's own, which CSS zoom scales.
    const localZoom = effectiveCssZoom(container) || 1;
    const startOffset = sashOffset(fitted);
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    handle.focus({ preventScroll: true });
    handle.setPointerCapture(pointerId);
    const restoreSelection = suppressTextSelection();
    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = horizontal ? "col-resize" : "row-resize";
    container.dataset.resizing = "true";
    let offset = startOffset;
    let drawnRails = railedLeafIds(tree).join("\0");
    let moved = false;
    let frame: number | null = null;
    let fallback: number | null = null;
    const cancelPaint = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      if (fallback !== null) window.clearTimeout(fallback);
      frame = null;
      fallback = null;
    };
    const flush = () => {
      cancelPaint();
      const next = resizeSash(tree, fitted, offset).layout;
      dragDraft.current = { tree: next, size: measured };
      // A pane folding to its rail, or opening from it, shows in this same
      // frame: drawn now, its surface hidden (so its native page hides at
      // once, never a hole) or shown, and painted once by the effect that
      // follows the draw. Each frame paints, and tells native pages, once.
      const rails = railedLeafIds(next);
      if (rails.join("\0") !== drawnRails) {
        drawnRails = rails.join("\0");
        flushSync(() => setDraftRails(new Set(rails)));
        return;
      }
      paint(next, measured);
    };
    const readPointer = (event: PointerEvent) => {
      const travel =
        ((horizontal ? event.clientX : event.clientY) - startPointer) /
        localZoom;
      offset = startOffset + travel;
      moved = moved || Math.abs(travel) > 0.5;
    };
    const move = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      readPointer(event);
      if (frame === null && fallback === null) {
        frame = requestAnimationFrame(flush);
        fallback = window.setTimeout(flush, DRAG_FRAME_DEADLINE_MS);
      }
    };
    const finish = (commit: boolean) => {
      if (stopResize.current !== finish) return;
      stopResize.current = null;
      cancelPaint();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", key);
      handle.removeEventListener("lostpointercapture", lost);
      try {
        handle.releasePointerCapture(pointerId);
      } catch {
        /* Already released. */
      }
      restoreSelection();
      document.body.style.cursor = previousCursor;
      delete container.dataset.resizing;
      dragDraft.current = null;
      setDraftRails(null);
      if (commit && moved) {
        const next = resizeSash(tree, fitted, offset).layout;
        paint(next, measured);
        if (JSON.stringify(next) !== JSON.stringify(tree))
          current.current.onLayoutChange(next);
      } else if (current.current.layout) paint(current.current.layout);
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      readPointer(event);
      finish(true);
    };
    const cancel = (event: PointerEvent) => {
      if (event.pointerId === pointerId) finish(false);
    };
    const blur = () => finish(true);
    const lost = () => finish(true);
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    };
    stopResize.current = finish;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", blur);
    window.addEventListener("keydown", key);
    handle.addEventListener("lostpointercapture", lost);
  }

  /** Arrow keys move a divider; Home and End fold a side; = evens them. */
  function keyResize(
    event: ReactKeyboardEvent<HTMLDivElement>,
    sash: StageSash,
  ) {
    const tree = current.current.layout;
    const container = stage.current;
    if (!tree || !container) return;
    const row = sash.dir === "right";
    const decrease = row ? "ArrowLeft" : "ArrowUp";
    const increase = row ? "ArrowRight" : "ArrowDown";
    if (![decrease, increase, "Home", "End", "="].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "=") {
      onLayoutChange(evenSplit(tree, sash.splitId));
      return;
    }
    const fitted = measuredSash(tree, sash, stageSize(container));
    if (!fitted) return;
    const start = fitted.lengths
      .slice(0, fitted.index)
      .reduce((sum, length) => sum + length, 0);
    const pair =
      fitted.lengths[fitted.index] + fitted.lengths[fitted.index + 1];
    const span = fitted.lengths.reduce((sum, length) => sum + length, 0);
    const step = Math.max(16, span * 0.02) * (event.shiftKey ? 5 : 1);
    const next =
      event.key === "Home"
        ? resizeSash(tree, fitted, start)
        : event.key === "End"
          ? resizeSash(tree, fitted, start + pair)
          : stepSash(tree, fitted, event.key === decrease ? -step : step);
    if (JSON.stringify(next.layout) !== JSON.stringify(tree))
      onLayoutChange(next.layout);
  }

  return (
    <div
      ref={stage}
      className="workspace-stage"
      data-workspace-stage
      data-retained={visible || retainedGeometry.current.size > 0}
      data-handoff={held.size ? "true" : undefined}
      hidden={!visible}
      aria-hidden={!visible || undefined}
      inert={!visible || undefined}
    >
      {surfaces.map(({ id, content }) => {
        const currentRect = positions.get(id);
        const shown = visible && !!currentRect;
        const retained = retainedGeometry.current.get(id);
        const handoff = !shown && held.has(id) && !!retained;
        const rect = shown ? currentRect : (retained?.rect ?? currentRect);
        const hasHeader = shown
          ? headerContents.has(id)
          : (retained?.hasHeader ?? headerContents.has(id));
        return (
          <div
            key={id}
            ref={(element) => {
              if (element) surfaceNodes.current.set(id, element);
              else surfaceNodes.current.delete(id);
            }}
            className="workspace-stage-surface"
            data-workspace-surface={id}
            data-focused={shown && focusedId === id}
            data-retained={shown || !!retained}
            data-demoted={!shown && demoted.has(id) ? "true" : undefined}
            data-has-header={hasHeader}
            data-handoff={handoff ? "out" : undefined}
            hidden={!shown && !handoff}
            aria-hidden={!shown || undefined}
            inert={!shown || undefined}
            style={
              rect
                ? { ...surfaceStyle(rect), ...surfaceBackgroundStyle(rect) }
                : undefined
            }
            onPointerDownCapture={() => {
              if (shown && focusedId !== id) current.current.onFocus(id);
            }}
            onFocusCapture={() => {
              if (shown && focusedId !== id) current.current.onFocus(id);
            }}
          >
            <div
              key="body"
              className="workspace-stage-body"
              data-workspace-body={id}
            >
              <SurfaceContent content={content} />
              {shown && dragging && hint && dragTarget?.id === id ? (
                <div
                  className="workspace-stage-drop-hint"
                  data-workspace-drop-hint
                  data-drop-edge={dragTarget.edge}
                  data-drop-kind={dragKind}
                  data-drop-title={dragLabel ?? ""}
                  style={previewStyle(hint)}
                  aria-hidden="true"
                />
              ) : null}
            </div>
          </div>
        );
      })}
      {displayHeaders.map(({ id, key, content }) => {
        const rect = positions.get(id);
        if (!rect) return null;
        const minimize = minimizeControls.get(id) ?? [];
        // Column controls sit on their own side of the divider. Row controls
        // stay in the header so native browser content cannot cover them.
        const leftControls = minimize.filter(
          ({ sash, side }) => sash.dir === "right" && side === "after",
        );
        const rightControls = minimize.filter(
          ({ sash, side }) => sash.dir !== "right" || side === "before",
        );
        const restore = id === restoreHeaderId;
        const restoreRight = restore && restoreEdge === "right";
        const leftSlots =
          leftControls.length + Number(restore && !restoreRight);
        const rightSlots = rightControls.length + Number(restoreRight);
        const RestoreIcon =
          restoreEdge === "right"
            ? ChevronLeft
            : restoreEdge === "up"
              ? ChevronDown
              : restoreEdge === "down"
                ? ChevronUp
                : ChevronRight;
        const restoreLabel = `Show hidden pane${
          restoreStatus === "working"
            ? " (agent working)"
            : restoreStatus === "attention"
              ? " (needs attention)"
              : ""
        }`;
        return (
          <div
            key={`header:${key ?? id}`}
            ref={(element) => {
              if (element) headerNodes.current.set(id, element);
              else headerNodes.current.delete(id);
            }}
            className="workspace-stage-header"
            data-workspace-header={id}
            data-focused={visible && focusedId === id}
            data-drop-target={
              dragging && dragTarget?.id === id ? "true" : undefined
            }
            style={{
              ...headerStyle(rect),
              paddingLeft: leftSlots ? leftSlots * 26 + 2 : undefined,
              paddingRight: rightSlots ? rightSlots * 26 + 2 : undefined,
            }}
            onPointerDownCapture={(event) => {
              if ((event.target as Element).closest(".workspace-pane-toggle"))
                return;
              if (visible && focusedId !== id) current.current.onFocus(id);
            }}
            onFocusCapture={(event) => {
              if ((event.target as Element).closest(".workspace-pane-toggle"))
                return;
              if (visible && focusedId !== id) current.current.onFocus(id);
            }}
          >
            {content}
            {restore ? (
              <button
                type="button"
                className="workspace-pane-toggle workspace-pane-restore"
                data-edge={restoreEdge}
                data-status={restoreStatus}
                aria-label={restoreLabel}
                title={restoreLabel}
                onPointerDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
                onClick={() => {
                  pendingFocus.current = "split";
                  onRestoreSplit?.();
                }}
              >
                <RestoreIcon size={13} aria-hidden="true" />
                {restoreStatus ? (
                  <span className="workspace-pane-status" aria-hidden="true" />
                ) : null}
              </button>
            ) : null}
            {(
              [
                ["left", leftControls],
                ["right", rightControls],
              ] as const
            ).map(([edge, controls]) =>
              controls.length ? (
                <div
                  key={edge}
                  className="workspace-pane-minimize-controls"
                  style={
                    edge === "left"
                      ? { left: restore && !restoreRight ? 28 : 2 }
                      : { right: restoreRight ? 28 : 2 }
                  }
                >
                  {controls.map(({ sash, side }) => {
                    const before = side === "before";
                    const horizontal = sash.dir === "right";
                    const Icon = horizontal
                      ? before
                        ? ChevronLeft
                        : ChevronRight
                      : before
                        ? ChevronUp
                        : ChevronDown;
                    const direction = horizontal
                      ? before
                        ? "left"
                        : "right"
                      : before
                        ? "upper"
                        : "lower";
                    const label = `Collapse ${direction} pane`;
                    return (
                      <button
                        key={`${sashKey(sash)}:${side}`}
                        type="button"
                        className="workspace-pane-toggle"
                        aria-label={label}
                        title={`${label} (or drag the divider past it)`}
                        onPointerDown={(event) => event.stopPropagation()}
                        onDoubleClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                        onClick={() => minimizePane(sash, side)}
                      >
                        <Icon size={13} aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              ) : null,
            )}
            {dragging &&
            dragTarget?.id === id &&
            dragTarget.edge === "tab" &&
            dragTarget.index !== undefined ? (
              <span
                className="workspace-stage-insertion"
                data-drop-insertion
                aria-hidden="true"
              />
            ) : null}
          </div>
        );
      })}
      {rails.map(({ id, rect, axis }) => {
        const rail = railContent?.(id);
        const label = rail?.label ?? "pane";
        return (
          <button
            key={`rail:${id}`}
            ref={(element) => {
              if (element) railNodes.current.set(id, element);
              else railNodes.current.delete(id);
            }}
            type="button"
            className="workspace-pane-rail"
            data-pane-rail={id}
            data-axis={axis}
            aria-label={`Open ${label}`}
            title={`${label}. Click to open`}
            style={surfaceStyle(rect)}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              if (onRestoreRail) {
                onRestoreRail(id);
                return;
              }
              // Without a handler of its own, the stage opens the pane and
              // focuses it as a rail's click always does.
              if (!layout) return;
              onLayoutChange(unrailLeaf(layout, id));
              onFocus(id);
            }}
          >
            {rail?.content ?? null}
          </button>
        );
      })}
      {sashes.map((sash) => (
        <div
          key={sash.key}
          ref={(element) => {
            if (element) sashNodes.current.set(sash.key, element);
            else sashNodes.current.delete(sash.key);
          }}
          className="workspace-stage-sash"
          data-native-hit-margin=""
          data-direction={sash.dir}
          role="separator"
          tabIndex={0}
          aria-label={
            sash.dir === "right"
              ? "Resize workspace columns"
              : "Resize workspace rows"
          }
          aria-orientation={sash.dir === "right" ? "vertical" : "horizontal"}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={sash.value}
          style={sashStyle(sash)}
          onPointerDown={(event) => startResize(event, sash)}
          onDoubleClick={() => {
            // Even out the panes on both sides, opening any collapsed one.
            if (layout) onLayoutChange(evenSplit(layout, sash.splitId));
          }}
          onKeyDown={(event) => keyResize(event, sash)}
        />
      ))}
      {/* Captured drags use geometric drop targets. Keep native pages live;
          the header indicator stays visible above them without a snapshot. */}
      <div
        ref={previewNode}
        className="workspace-stage-drop-preview"
        data-shown="false"
        aria-hidden="true"
      />
    </div>
  );
}

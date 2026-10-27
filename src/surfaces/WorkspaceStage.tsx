import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  layoutLeaves,
  layoutSashes,
  setSplitRatio,
  type LayoutNode,
  type LayoutRect,
  type LayoutSash,
} from "../lib/layout";
import { effectiveCssZoom, suppressTextSelection } from "../lib/drag";
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
 * browser stacking never matters. As in Cydonia: a pane's title row, or the
 * middle of its body, stacks the tab in that pane; within a quarter of an
 * edge it splits that side (see paneDock.ts). A header that is a strip of
 * tabs (a detached window's) still takes the tab at the slot it is over.
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
    // A title row shows only the tab in front; its strip still lists them all.
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
        // A title row stacks the tab behind the one in front.
        if (header.querySelector('[data-variant="title"]'))
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

const sameBox = (a: DockRect | null, b: DockRect | null) =>
  a === b ||
  (!!a &&
    !!b &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5);

/** A drop is followed by its new layout within this long, or not at all. */
const DROP_REVEAL_WINDOW_MS = 1000;
/** Cydonia's zoom: a pane glides to the whole space in 200ms, eased out. */
export const ZOOM_GLIDE_MS = 200;

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
  const position = (fraction: number, inset: number) =>
    inset ? `calc(${fraction * 100}% + ${inset}px)` : `${fraction * 100}%`;
  const size = (fraction: number, inset: number) =>
    inset ? `calc(${fraction * 100}% - ${inset}px)` : `${fraction * 100}%`;
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
const sashKey = (sash: LayoutSash) => `${sash.splitId}:${sash.index}`;
const sashBoundary = (sash: LayoutSash) =>
  sash.sizes.slice(0, sash.index + 1).reduce((sum, size) => sum + size, 0);
function sashStyle(sash: LayoutSash): CSSProperties {
  const boundary = sashBoundary(sash);
  return sash.dir === "right"
    ? {
        left: `${(sash.group.x + boundary * sash.group.w) * 100}%`,
        top: `${sash.group.y * 100}%`,
        height: `${sash.group.h * 100}%`,
      }
    : {
        left: `${sash.group.x * 100}%`,
        top: `${(sash.group.y + boundary * sash.group.h) * 100}%`,
        width: `${sash.group.w * 100}%`,
      };
}
function balancedBoundary(sash: LayoutSash) {
  return (
    sash.sizes.slice(0, sash.index).reduce((sum, size) => sum + size, 0) +
    (sash.sizes[sash.index] + sash.sizes[sash.index + 1]) / 2
  );
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
  onRestoreSplit,
  restoreEdge = "left",
  restoreStatus,
  dragTarget,
  dragging,
  dragLabel,
  dragKind = "tab",
  zoomedId = null,
}: WorkspaceStageProps) {
  const stage = useRef<HTMLDivElement>(null);
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
  const current = useRef({ layout, onFocus, onLayoutChange, onMinimizeSide });
  current.current = { layout, onFocus, onLayoutChange, onMinimizeSide };
  const stopResize = useRef<((commit: boolean) => void) | null>(null);
  const leaves = layout ? layoutLeaves(layout) : [];
  const positions = new Map(leaves.map((leaf) => [leaf.id, leaf.rect]));
  const sashes = layout ? layoutSashes(layout) : [];
  function minimizePane(sash: LayoutSash, side: "before" | "after") {
    if (!current.current.onMinimizeSide) return;
    lastMinimizedSash.current = sashKey(sash);
    pendingFocus.current = "restore";
    current.current.onMinimizeSide(sash.splitId, sash.index, side);
  }
  // Keep controls inside the header's reserved 32px strip. Chromium draws above
  // the web app, so a floating control over a pane body cannot be relied on.
  function adjacentHeader(sash: LayoutSash, side: "before" | "after") {
    const index = sash.index + (side === "after" ? 1 : 0);
    const start = sash.sizes
      .slice(0, index)
      .reduce((sum, size) => sum + size, 0);
    const end = start + sash.sizes[index];
    const row = sash.dir === "right";
    const child = row
      ? {
          x: sash.group.x + start * sash.group.w,
          y: sash.group.y,
          w: (end - start) * sash.group.w,
          h: sash.group.h,
        }
      : {
          x: sash.group.x,
          y: sash.group.y + start * sash.group.h,
          w: sash.group.w,
          h: (end - start) * sash.group.h,
        };
    return leaves
      .filter(
        ({ rect }) =>
          rect.x >= child.x - 1e-6 &&
          rect.y >= child.y - 1e-6 &&
          rect.x + rect.w <= child.x + child.w + 1e-6 &&
          rect.y + rect.h <= child.y + child.h + 1e-6,
      )
      .sort(
        (a, b) =>
          a.rect.y - b.rect.y ||
          (row && side === "after" ? a.rect.x - b.rect.x : b.rect.x - a.rect.x),
      )[0]?.id;
  }
  const minimizeControls = new Map<
    string,
    Array<{ sash: LayoutSash; side: "before" | "after" }>
  >();
  if (onMinimizeSide) {
    for (const sash of sashes) {
      for (const side of ["before", "after"] as const) {
        const id = adjacentHeader(sash, side);
        if (id)
          minimizeControls.set(id, [
            ...(minimizeControls.get(id) ?? []),
            { sash, side },
          ]);
      }
    }
  }
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
  const displayHeaders = [...headers];
  if (onMinimizeSide || onRestoreSplit) {
    for (const { id } of leaves) {
      if (!displayHeaders.some((header) => header.id === id))
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
        ? stage.current?.querySelector<HTMLElement>(".workspace-pane-restore")
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
    ].filter((id) => visible && !shownIds.includes(id)),
  );
  const heldKey = [...held].join("\0");
  useLayoutEffect(() => {
    committedShown.current = shownIds;
  });
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
  const headerIds = leaves
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

  function paint(tree: LayoutNode) {
    for (const leaf of layoutLeaves(tree)) {
      paintSurface(leaf.id, leaf.rect);
      const header = headerNodes.current.get(leaf.id);
      if (header && header.dataset.workspaceHeaderHosted !== "toolbar")
        applyGeometry(header, headerStyle(leaf.rect));
    }
    for (const sash of layoutSashes(tree)) {
      const element = sashNodes.current.get(sashKey(sash));
      if (!element) continue;
      applyGeometry(element, sashStyle(sash));
      const value = String(Math.round(sashBoundary(sash) * 100));
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
  // (newSplitPanes). Native pages are never moved, so they land.
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
      if (!surface || surface.querySelector(".browser-native-host")) return;
      const header = headerNodes.current.get(id);
      const headerFrom = { ...from, height: 32 };
      const headerTo = { ...to, height: 32 };
      for (const [node, start, end] of [
        [surface, from, to],
        [header, headerFrom, headerTo],
      ] as const) {
        if (!node || typeof node.animate !== "function") continue;
        if (end.width <= 0 || end.height <= 0) continue;
        play(
          node,
          grow
            ? [
                { clipPath: dockClip(start, end, 0) },
                { clipPath: "inset(0px 0px 0px 0px round 0px)" },
              ]
            : [
                {
                  transformOrigin: "0 0",
                  transform: `translate(${start.left - end.left}px, ${start.top - end.top}px) scale(${start.width / end.width}, ${start.height / end.height})`,
                },
                {
                  transformOrigin: "0 0",
                  transform: "translate(0px, 0px) scale(1, 1)",
                },
              ],
          { duration: ZOOM_GLIDE_MS, easing: DOCK_EASE },
        );
      }
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

  // The docking preview, drawn once over the whole stage so it can glide
  // between zones and between panes (Cydonia's 150ms tween). The hint in the
  // target pane's body says where it goes; a native page reads that hint for
  // its own indicator, which stands still. When a drop splits a pane, the
  // pane it makes grows from the preview to its place while the preview
  // fades.
  const previewNode = useRef<HTMLDivElement>(null);
  const previewState = useRef<{
    box: DockRect | null;
    glide: BoundedMotion | null;
    fade: BoundedMotion | null;
    split: boolean;
    dragLayout: LayoutNode | null;
  }>({ box: null, glide: null, fade: null, split: false, dragLayout: null });
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
      preview.glide = null;
      preview.fade = null;
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
    const animate = typeof element.animate === "function" && !reduced;
    if (dragging) state.dragLayout = layout;
    const hintNode =
      visible && dragging
        ? container.querySelector<HTMLElement>("[data-workspace-drop-hint]")
        : null;
    const target = hintNode
      ? stageBox(container, hintNode.getBoundingClientRect())
      : null;
    if (!target || target.width <= 0 || target.height <= 0) {
      if (!dragging && state.box && state.split)
        dropReveal.current = {
          box: state.box,
          until: performance.now() + DROP_REVEAL_WINDOW_MS,
          from: state.dragLayout,
        };
      state.glide?.stop();
      state.glide = null;
      if (state.box && animate && !state.fade) {
        // Fade where it was; it is gone when the fade ends, run or not.
        state.fade = play(
          element,
          [{ opacity: 1 }, { opacity: 0 }],
          { duration: DOCK_TWEEN_MS, easing: DOCK_EASE, fill: "forwards" },
          () => {
            state.fade = null;
            element.dataset.shown = "false";
          },
        );
      } else if (!state.fade) element.dataset.shown = "false";
      state.box = null;
      state.split = false;
    } else {
      // Glide from wherever the preview is drawn, even part way along.
      const drawn =
        state.box && state.glide
          ? stageBox(container, element.getBoundingClientRect())
          : state.box;
      state.glide?.stop();
      state.glide = null;
      state.fade?.stop();
      state.fade = null;
      element.style.left = `${target.left}px`;
      element.style.top = `${target.top}px`;
      element.style.width = `${target.width}px`;
      element.style.height = `${target.height}px`;
      element.dataset.shown = "true";
      if (drawn && animate && !sameBox(drawn, target)) {
        const glide = play(
          element,
          [
            {
              transform: `translate(${drawn.left - target.left}px, ${drawn.top - target.top}px) scale(${drawn.width / target.width}, ${drawn.height / target.height})`,
            },
            { transform: "translate(0px, 0px) scale(1, 1)" },
          ],
          { duration: DOCK_TWEEN_MS, easing: DOCK_EASE },
          () => {
            if (state.glide === glide) state.glide = null;
          },
        );
        state.glide = glide;
      }
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

  function startResize(
    event: ReactPointerEvent<HTMLDivElement>,
    sash: LayoutSash,
  ) {
    const tree = current.current.layout;
    const container = stage.current;
    if (!visible || event.button !== 0 || !tree || !container) return;
    stopResize.current?.(false);
    const bounds = container.getBoundingClientRect();
    const horizontal = sash.dir === "right";
    const startPointer = horizontal ? event.clientX : event.clientY;
    const startBoundary = sashBoundary(sash);
    const localZoom = effectiveCssZoom(container);
    const beforeEdge = sash.sizes
      .slice(0, sash.index)
      .reduce((sum, size) => sum + size, 0);
    const afterEdge =
      beforeEdge + sash.sizes[sash.index] + sash.sizes[sash.index + 1];
    const span = horizontal
      ? sash.group.w * bounds.width
      : sash.group.h * bounds.height;
    if (span <= 0) return;
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
    let boundary = sashBoundary(sash);
    let moved = false;
    let minimizeSide: "before" | "after" | null = null;
    let cue: HTMLElement | null = null;
    let frame: number | null = null;
    let fallback: number | null = null;
    const draft = () => setSplitRatio(tree, sash.splitId, sash.index, boundary);
    const cancelPaint = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      if (fallback !== null) window.clearTimeout(fallback);
      frame = null;
      fallback = null;
    };
    const flush = () => {
      cancelPaint();
      paint(draft());
    };
    const readPointer = (event: PointerEvent) => {
      const travel =
        (horizontal ? event.clientX : event.clientY) - startPointer;
      boundary = startBoundary + travel / span;
      moved = moved || Math.abs(boundary - sashBoundary(sash)) > 0.0001;
      // Layout resizing retains its minimum widths. Only a deliberate release
      // near the raw divider's outside edge requests hiding an adjacent pane.
      const next =
        current.current.onMinimizeSide && Math.abs(travel) >= 12 * localZoom
          ? travel < 0 &&
            (boundary - beforeEdge) * span <= 24 * localZoom + 1e-6
            ? "before"
            : travel > 0 &&
                (afterEdge - boundary) * span <= 24 * localZoom + 1e-6
              ? "after"
              : null
          : null;
      if (next !== minimizeSide) {
        if (cue) cue.hidden = true;
        cue = null;
        minimizeSide = next;
        if (next) {
          // The hidden side can be narrower than the label. Put feedback in
          // the surviving neighbor's header, beside the divider being dragged.
          const id = adjacentHeader(
            sash,
            next === "before" ? "after" : "before",
          );
          cue = id
            ? (headerNodes.current
                .get(id)
                ?.querySelector<HTMLElement>("[data-minimize-cue]") ?? null)
            : null;
          if (cue) {
            cue.textContent = `Release to hide ${horizontal ? (next === "before" ? "left" : "right") : next === "before" ? "upper" : "lower"} pane`;
            cue.dataset.align = next === "before" ? "left" : "right";
            cue.hidden = false;
          }
        }
      }
    };
    const move = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      readPointer(event);
      if (frame === null && fallback === null) {
        frame = requestAnimationFrame(flush);
        fallback = window.setTimeout(flush, DRAG_FRAME_DEADLINE_MS);
      }
    };
    const finish = (commit: boolean, allowMinimize = false) => {
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
      if (cue) cue.hidden = true;
      if (
        commit &&
        allowMinimize &&
        minimizeSide &&
        current.current.onMinimizeSide
      ) {
        // Restore committed geometry before removing a pane so retained drafts
        // and native page owners keep the pre-drag measurements for restoration.
        if (current.current.layout) paint(current.current.layout);
        minimizePane(sash, minimizeSide);
      } else if (commit && moved) {
        const next = draft();
        paint(next);
        current.current.onLayoutChange(next);
      } else if (current.current.layout) paint(current.current.layout);
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      readPointer(event);
      finish(true, true);
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
                    const label = `Hide ${direction} pane`;
                    return (
                      <button
                        key={`${sashKey(sash)}:${side}`}
                        type="button"
                        className="workspace-pane-toggle"
                        aria-label={label}
                        title={`${label} (or drag the divider to the edge)`}
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
            {onMinimizeSide ? (
              <span
                className="workspace-minimize-cue"
                data-minimize-cue
                hidden
                aria-hidden="true"
              />
            ) : null}
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
      {sashes.map((sash) => (
        <div
          key={sashKey(sash)}
          ref={(element) => {
            if (element) sashNodes.current.set(sashKey(sash), element);
            else sashNodes.current.delete(sashKey(sash));
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
          aria-valuenow={Math.round(sashBoundary(sash) * 100)}
          style={sashStyle(sash)}
          onPointerDown={(event) => startResize(event, sash)}
          onDoubleClick={() => {
            if (layout)
              onLayoutChange(
                setSplitRatio(
                  layout,
                  sash.splitId,
                  sash.index,
                  balancedBoundary(sash),
                ),
              );
          }}
          onKeyDown={(event) => {
            const decrease = sash.dir === "right" ? "ArrowLeft" : "ArrowUp";
            const increase = sash.dir === "right" ? "ArrowRight" : "ArrowDown";
            if (
              !layout ||
              ![decrease, increase, "Home", "End"].includes(event.key)
            )
              return;
            event.preventDefault();
            event.stopPropagation();
            const boundary =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? 1
                  : sashBoundary(sash) +
                    (event.key === decrease ? -0.02 : 0.02) *
                      (event.shiftKey ? 5 : 1);
            onLayoutChange(
              setSplitRatio(layout, sash.splitId, sash.index, boundary),
            );
          }}
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

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
import { subscribeMemoryPressure } from "../lib/memoryPressure";
import {
  browserHandoffPending,
  waitForBrowserHandoff,
} from "../lib/browserHandoff";
import { WORKSPACE_DROP_FEEDBACK } from "../hooks/useBrowserDropIndicator";
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
  dragTarget: WorkspaceSurfaceDropTarget | null;
  dragging: boolean;
  dragLabel?: string;
  dragKind?: "tab" | "group";
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

/** Client coordinates keep drop targets independent of native browser stacking. */
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
    // A selected tab can split away from its own group only if a sibling
    // remains to occupy the original pane. Its own header still reorders.
    const moving = new Set(draggedIds);
    const sameGroup = tabs.some((tab) =>
      moving.has(tab.dataset.surfaceTabId ?? ""),
    );
    if (
      (id === draggedId && tabs.length < 2) ||
      (sameGroup &&
        tabs.every((tab) => moving.has(tab.dataset.surfaceTabId ?? "")))
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
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      x < rect.left ||
      x > rect.right ||
      y < rect.top ||
      y > rect.bottom
    )
      continue;
    const horizontal = (x - rect.left) / rect.width;
    const vertical = (y - rect.top) / rect.height;
    const edges: Array<["left" | "right" | "up" | "down", number]> = [
      ["left", horizontal],
      ["right", 1 - horizontal],
      ["up", vertical],
      ["down", 1 - vertical],
    ];
    const nearest = edges.reduce((closest, next) =>
      next[1] < closest[1] ? next : closest,
    );
    const previousEdge =
      previous?.id === id && previous.edge !== "tab"
        ? edges.find(([edge]) => edge === previous.edge)
        : undefined;
    // A broad center joins the tab strip. A small deadband keeps the preview
    // stable near the center/edge boundary and at split corners.
    const edgeLimit =
      previous?.id === id && previous.edge === "tab" ? 0.18 : 0.22;
    if (
      previousEdge &&
      previousEdge[1] <= 0.26 &&
      previousEdge[1] <= nearest[1] + 0.045
    )
      return { id, edge: previousEdge[0] };
    if (nearest[1] <= edgeLimit) return { id, edge: nearest[0] };
    return sameGroup ? null : { id, edge: "tab" };
  }
  return null;
}

const rectStyle = (rect: LayoutRect): CSSProperties => ({
  left: `${rect.x * 100}%`,
  top: `${rect.y * 100}%`,
  width: `${rect.w * 100}%`,
  height: `${rect.h * 100}%`,
});

// WK animation frames may be deferred while native Chromium covers its view.
// Bound that wait only during a drag; the first callback cancels the other.
const DRAG_FRAME_DEADLINE_MS = 16;

function applyGeometry(element: HTMLElement, values: CSSProperties) {
  for (const [name, value] of Object.entries(values)) {
    if (value != null && element.style.getPropertyValue(name) !== String(value))
      element.style.setProperty(name, String(value));
  }
}
/** Native browser children need a real gutter; CSS stacking cannot cover them. */
function surfaceStyle(rect: LayoutRect, inset = 0): CSSProperties {
  const epsilon = 0.000001;
  const left = (rect.x > epsilon ? 4 : 0) + inset;
  const top = (rect.y > epsilon ? 4 : 0) + inset;
  const right = (rect.x + rect.w < 1 - epsilon ? 4 : 0) + inset;
  const bottom = (rect.y + rect.h < 1 - epsilon ? 4 : 0) + inset;
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
  const left = (rect.x > 0.000001 ? 4 : 0) + 1;
  const top = (rect.y > 0.000001 ? 4 : 0) + 1;
  return {
    "--workspace-background-left": `calc(${-rect.x * 100}cqw - ${left}px)`,
    "--workspace-background-top": `calc(${-rect.y * 100}cqh - ${top}px - var(--workspace-background-header-offset))`,
  };
}
const headerStyle = (rect: LayoutRect): CSSProperties => ({
  ...surfaceStyle(rect, 1),
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

export function WorkspaceStage({
  layout,
  focusedId,
  visible,
  surfaces,
  headers = [],
  onFocus,
  onLayoutChange,
  dragTarget,
  dragging,
  dragLabel,
  dragKind = "tab",
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
  const current = useRef({ layout, onFocus, onLayoutChange });
  current.current = { layout, onFocus, onLayoutChange };
  const stopResize = useRef<((commit: boolean) => void) | null>(null);
  const leaves = layout ? layoutLeaves(layout) : [];
  const positions = new Map(leaves.map((leaf) => [leaf.id, leaf.rect]));
  const headerContents = new Map(
    headers.map(({ id, content }) => [id, content]),
  );
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
  useLayoutEffect(() => {
    if (!held.size) return;
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
  const sashes = layout ? layoutSashes(layout) : [];

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
      boundary =
        startBoundary +
        ((horizontal ? event.clientX : event.clientY) - startPointer) / span;
      moved = moved || Math.abs(boundary - sashBoundary(sash)) > 0.0001;
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
      if (commit && moved) {
        const next = draft();
        paint(next);
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

  const joining = dragTarget?.edge === "tab" && dragTarget.index === undefined;
  const hint = joining
    ? { x: 0.08, y: 0.08, w: 0.84, h: 0.84 }
    : dragTarget && dragTarget.edge !== "tab"
      ? { x: 0, y: 0, w: 1, h: 1 }
      : null;
  if (hint && dragTarget && !joining) {
    if (dragTarget.edge === "left" || dragTarget.edge === "right") {
      hint.w /= 2;
      if (dragTarget.edge === "right") hint.x += hint.w;
    } else {
      hint.h /= 2;
      if (dragTarget.edge === "down") hint.y += hint.h;
    }
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
                  style={rectStyle(hint)}
                  aria-hidden="true"
                />
              ) : null}
            </div>
          </div>
        );
      })}
      {headers.map(({ id, key, content }) => {
        const rect = positions.get(id);
        if (!rect) return null;
        return (
          <div
            key={`header:${key ?? id}`}
            ref={(element) => {
              if (element) headerNodes.current.set(id, element);
              else headerNodes.current.delete(id);
            }}
            className="workspace-stage-header"
            data-workspace-header={id}
            data-drop-target={
              dragging && dragTarget?.id === id ? "true" : undefined
            }
            style={headerStyle(rect)}
            onPointerDownCapture={() => {
              if (visible && focusedId !== id) current.current.onFocus(id);
            }}
            onFocusCapture={() => {
              if (visible && focusedId !== id) current.current.onFocus(id);
            }}
          >
            {content}
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
    </div>
  );
}

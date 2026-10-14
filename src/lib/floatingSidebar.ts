import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { paneEdgeFromPoint, type PaneEdge } from "./layout";
import type { UpdaterSnapshot } from "./updater";

/**
 * The hover sidebar as a native layer above live browser pages (macOS with
 * Chromium). The workspace document keeps the sidebar's state and callbacks;
 * a transparent overlay webview renders the same `Sidebar` from a snapshot
 * and calls those callbacks back by name. Native code slides the overlay and
 * cuts the workspace and the pages beneath it in one animation.
 */
export const FLOATING_SIDEBAR_PREFIX = "floating-sidebar-";

/** Workspace → overlay: the latest snapshot. */
export const SNAPSHOT_EVENT = "floating-sidebar-snapshot";
/** Overlay → workspace: ask for a snapshot (after loading or reloading). */
export const REQUEST_EVENT = "floating-sidebar-request";
/** Overlay → workspace: call a callback by name. */
export const CALL_EVENT = "floating-sidebar-call";
/** Workspace → overlay: a call's result. */
export const RESULT_EVENT = "floating-sidebar-result";
/** Overlay → workspace: menus, drags or keyboard focus that keep it out. */
export const ACTIVITY_EVENT = "floating-sidebar-activity";
/** Overlay → workspace: Escape. */
export const DISMISS_EVENT = "floating-sidebar-dismiss";
/** Native → workspace: the pointer over the card/menus and the reveal edge. */
export const POINTER_EVENT = "floating-sidebar-pointer";
/** Native → workspace: a click on the reveal edge. */
export const EDGE_CLICK_EVENT = "floating-sidebar-edge-click";

export function overlayLabel(owner: string) {
  return `${FLOATING_SIDEBAR_PREFIX}${owner}`;
}

export function overlayOwner(label: string): string | null {
  return label.startsWith(FLOATING_SIDEBAR_PREFIX)
    ? label.slice(FLOATING_SIDEBAR_PREFIX.length) || null
    : null;
}

export type FloatingSidebarRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FloatingSidebarViewport = {
  devicePixelRatio: number;
  width: number;
  height: number;
};

export type FloatingSidebarSnapshot = {
  /** Increments when the overlay should remount its sidebar from storage. */
  generation: number;
  /** Serializable `Sidebar` props, encoded with `encodeSidebarValue`. */
  props: Record<string, unknown>;
  /** Callbacks the overlay may call by name. */
  actions: string[];
  /** The workspace root's classes and inline custom properties. */
  appearance: { className: string; style: string; uiScale: number };
  /** `.personal-shell-body` in the workspace viewport. */
  body: FloatingSidebarRect;
  viewportHeight: number;
  /** Workspace panes a dragged session can be placed on. */
  panes: { id: string; rect: FloatingSidebarRect }[];
  /** Encoded orchestration runs and worker selection for lead cards. */
  orchestration: {
    runs: unknown;
    agentsByLead: unknown;
    selectedId: string | null;
    details: boolean;
  };
  /** The workspace's updater; the overlay never checks or installs itself. */
  updater: UpdaterSnapshot;
  /** Live model catalogs, so session rows name models as the workspace does. */
  models: unknown;
};

export type FloatingSidebarCall = { id: number; name: string; args: unknown };
export type FloatingSidebarResult = {
  id: number;
  ok: boolean;
  value?: unknown;
  error?: string;
};
export type FloatingSidebarActivity = { interaction: boolean; focus: boolean };
export type FloatingSidebarPointer = { inside: boolean; edge: boolean };

const SET = "$set";
const MAP = "$map";

/**
 * Values that describe the page rather than data: a browser window, or an
 * event. React's click events are not `Event`s, and each one reaches the
 * whole `window` through `view`, which in turn refers to itself through
 * `self`, `top` and `parent`. Walking one never finished and froze the card.
 */
function isPageObject(value: object): boolean {
  if (typeof Event !== "undefined" && value instanceof Event) return true;
  if (typeof Node !== "undefined" && value instanceof Node) return true;
  // A window, from this or any other frame.
  if ((value as { window?: unknown }).window === value) return true;
  // A React synthetic event wraps a native one.
  const synthetic = value as {
    nativeEvent?: unknown;
    isDefaultPrevented?: unknown;
  };
  return (
    synthetic.nativeEvent !== undefined &&
    typeof synthetic.isDefaultPrevented === "function"
  );
}

/** JSON-safe structured data: Sets and Maps survive; functions, DOM nodes,
 * windows, events and reference cycles do not. */
export function encodeSidebarValue(value: unknown): unknown {
  return encode(value, 0, new Set());
}

function encode(value: unknown, depth: number, path: Set<object>): unknown {
  if (depth > 32) return undefined;
  if (value === null || typeof value !== "object") {
    return typeof value === "function" || typeof value === "symbol"
      ? undefined
      : value;
  }
  // A cycle repeats what is already being encoded; a value shared by two
  // branches is not a cycle and is kept in both.
  if (path.has(value) || isPageObject(value)) return undefined;
  if (value instanceof Date) return value.toISOString();
  path.add(value);
  try {
    if (value instanceof Set)
      return {
        [SET]: [...value].map((item) => encode(item, depth + 1, path)),
      };
    if (value instanceof Map)
      return {
        [MAP]: [...value].map(([key, item]) => [
          encode(key, depth + 1, path),
          encode(item, depth + 1, path),
        ]),
      };
    if (Array.isArray(value))
      return value.map((item) => encode(item, depth + 1, path) ?? null);
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const encoded = encode(item, depth + 1, path);
      if (encoded !== undefined) result[key] = encoded;
    }
    return result;
  } finally {
    path.delete(value);
  }
}

export function decodeSidebarValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(decodeSidebarValue);
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 1 && keys[0] === SET && Array.isArray(record[SET]))
    return new Set((record[SET] as unknown[]).map(decodeSidebarValue));
  if (keys.length === 1 && keys[0] === MAP && Array.isArray(record[MAP]))
    return new Map(
      (record[MAP] as [unknown, unknown][]).map(([key, item]) => [
        decodeSidebarValue(key),
        decodeSidebarValue(item),
      ]),
    );
  const result: Record<string, unknown> = {};
  for (const key of keys) result[key] = decodeSidebarValue(record[key]);
  return result;
}

export function rectOf(rect: DOMRect | DOMRectReadOnly): FloatingSidebarRect {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

/**
 * The innermost workspace pane at a point, as `paneDropFromPoint` finds it in
 * the workspace document. The overlay has the panes' rectangles only.
 */
export function paneDropAt(
  panes: readonly { id: string; rect: FloatingSidebarRect }[],
  x: number,
  y: number,
): { id: string; edge: PaneEdge } | null {
  let best: { id: string; rect: FloatingSidebarRect } | null = null;
  for (const pane of panes) {
    const { rect } = pane;
    if (
      x < rect.x ||
      y < rect.y ||
      x >= rect.x + rect.width ||
      y >= rect.y + rect.height
    )
      continue;
    if (!best || rect.width * rect.height < best.rect.width * best.rect.height)
      best = pane;
  }
  if (!best) return null;
  const { rect } = best;
  return {
    id: best.id,
    edge: paneEdgeFromPoint(x, y, {
      left: rect.x,
      top: rect.y,
      width: rect.width,
      height: rect.height,
    }),
  };
}

export function currentViewport(): FloatingSidebarViewport {
  return {
    devicePixelRatio: window.devicePixelRatio || 1,
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

/**
 * Calls `callback` when the display scale changes, as moving the window to a
 * display with another resolution does. Native code maps CSS pixels with it.
 */
export function watchDevicePixelRatio(callback: () => void) {
  let media: MediaQueryList | null = null;
  const changed = () => {
    listen();
    callback();
  };
  const listen = () => {
    media?.removeEventListener("change", changed);
    media = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    media.addEventListener("change", changed);
  };
  listen();
  return () => media?.removeEventListener("change", changed);
}

/** Native calls; builds without the layer reject `attach` and keep the DOM peek. */
export const nativeFloatingSidebar = {
  attach: () => invoke<string>("floating_sidebar_attach"),
  workspace: (geometry: {
    viewport: FloatingSidebarViewport;
    coverTop: number;
    coverBottom: number;
    edgeTop: number;
    edgeBottom: number;
    enabled: boolean;
  }) => invoke<void>("floating_sidebar_workspace", { geometry }),
  regions: (regions: {
    viewport: FloatingSidebarViewport;
    card: FloatingSidebarRect;
    regions: FloatingSidebarRect[];
  }) => invoke<void>("floating_sidebar_regions", { regions }),
  setOpen: (open: boolean, animated = true) =>
    invoke<void>("floating_sidebar_set_open", { open, animated }),
  focusWorkspace: () => invoke<void>("floating_sidebar_focus_workspace"),
  send: <T>(label: string, event: string, payload: T) =>
    emitTo(label, event, payload),
  listen: <T>(event: string, callback: (payload: T) => void) =>
    getCurrentWebview().listen<T>(event, ({ payload }) => callback(payload)),
};

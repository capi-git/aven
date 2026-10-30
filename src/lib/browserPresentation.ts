import { getCurrentWindow } from "@tauri-apps/api/window";
import { errorText as errorMessage } from "./errors";
import {
  browserBounds,
  nativeBrowser,
  type BrowserBounds,
  type BrowserHole,
} from "./browser";
import {
  BROWSER_OVERLAYS,
  MAX_BROWSER_HOLES,
  browserOverlayState,
  type BrowserOverlayState,
} from "./browserOverlays";
import { endBrowserHandoff, waitForBrowserHandoff } from "./browserHandoff";
import { withBrowserHitMargins } from "./browserHitMargins";

const OVERLAYS = BROWSER_OVERLAYS;
// ResizeObserver also reaches this path during native window resizing. A
// deferred WebKit frame must not leave Chromium at old bounds for 100 ms.
const LAYOUT_FALLBACK_MS = 16;
const OVERLAY_SNAPSHOT_DEADLINE_MS = 80;
const SNAPSHOT_PAINT_DEADLINE_MS = 16;
const ZOOM_SNAPSHOT_DELAY_MS = 60;
/** A moving surface's still image is retried this often, this long apart. */
/**
 * A moving surface's still image is tried again after a failure, at most
 * one at a time, first after this long and twice as long each time, and no
 * new try starts this long after the surface reached the page.
 */
const STILL_RETRY_MS = 120;
const STILL_BUDGET_MS = 4000;
/** A motion hold never waits longer than this on the native page. */
const MOTION_HANDOFF_DEADLINE_MS = 160;

export type BrowserSnapshot = {
  src: string;
  width: number;
  height: number;
  scale: number;
  left: number;
  top: number;
};
type SnapshotRequest = {
  capture: () => Promise<BrowserSnapshot>;
  relevant: () => boolean;
  resolve: (snapshot: BrowserSnapshot | null) => void;
};
const snapshotRequests = new Map<
  string,
  { running: boolean; queued: SnapshotRequest | null }
>();

/** Keep expensive native captures bounded even when a renderer is replaced. */
function requestBrowserSnapshot(
  id: string,
  capture: SnapshotRequest["capture"],
  relevant: SnapshotRequest["relevant"],
): Promise<BrowserSnapshot | null> {
  let slot = snapshotRequests.get(id);
  if (!slot) {
    slot = { running: false, queued: null };
    snapshotRequests.set(id, slot);
  }
  const state = slot;
  return new Promise((resolve) => {
    const request = { capture, relevant, resolve };
    const finish = () => {
      state.running = false;
      const next = state.queued;
      state.queued = null;
      if (next) run(next);
      else if (snapshotRequests.get(id) === state) snapshotRequests.delete(id);
    };
    const run = (next: SnapshotRequest) => {
      state.running = true;
      try {
        if (!next.relevant()) {
          next.resolve(null);
          finish();
          return;
        }
        void next
          .capture()
          .then(next.resolve, () => next.resolve(null))
          .finally(finish);
      } catch {
        next.resolve(null);
        finish();
      }
    };
    if (state.running) {
      state.queued?.resolve(null);
      state.queued = request;
    } else run(request);
  });
}

function snapshotViewport(bounds: BrowserBounds) {
  const left = Math.round(bounds.x * bounds.scale) / bounds.scale;
  const top = Math.round(bounds.y * bounds.scale) / bounds.scale;
  const right =
    Math.round((bounds.x + bounds.width) * bounds.scale) / bounds.scale;
  const bottom =
    Math.round((bounds.y + bounds.height) * bounds.scale) / bounds.scale;
  return {
    width: right - left,
    height: bottom - top,
    scale: bounds.scale,
    left: left - bounds.x,
    top: top - bounds.y,
  };
}

function sameSnapshotViewport(
  a: Omit<BrowserSnapshot, "src">,
  b: Omit<BrowserSnapshot, "src">,
) {
  return (
    a.scale === b.scale &&
    Math.abs(a.width - b.width) < 0.00001 &&
    Math.abs(a.height - b.height) < 0.00001 &&
    Math.abs(a.left - b.left) < 0.00001 &&
    Math.abs(a.top - b.top) < 0.00001
  );
}

function clipHoverSidebars(bounds: BrowserBounds): BrowserBounds {
  let clipLeft = 0;
  let clipRight = 0;
  for (const element of document.querySelectorAll<HTMLElement>(
    '[data-native-browser-occluded="true"][data-native-browser-edge]',
  )) {
    const style = getComputedStyle(element);
    if (
      style.visibility === "hidden" ||
      // A dismissed peek starts closing before React removes its markers.
      element.closest(
        '[hidden], [inert], [aria-hidden="true"], [data-open="false"]',
      )
    )
      continue;
    // The active marker is authoritative even while the panel is still off
    // its edge on the first reveal frame; waiting for the slide would paint
    // Chromium over the panel. Reserve the final edge for the whole reveal
    // animation. The page stays in place instead of reflowing or being
    // captured as a still image.
    const shift =
      style.transform && style.transform !== "none"
        ? new DOMMatrixReadOnly(style.transform).m41
        : 0;
    for (const rect of element.getClientRects()) {
      if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        rect.bottom <= bounds.y ||
        rect.top >= bounds.y + bounds.height
      )
        continue;
      if (element.dataset.nativeBrowserEdge === "left") {
        // A full-width slide starts entirely past the edge; test overlap at
        // the panel's resting place.
        const left = rect.left - Math.min(0, shift);
        const right = rect.right - Math.min(0, shift);
        if (left < bounds.x + bounds.width && right > bounds.x)
          clipLeft = Math.max(clipLeft, right - bounds.x);
      }
      if (element.dataset.nativeBrowserEdge === "right") {
        const left = rect.left - Math.max(0, shift);
        const right = rect.right - Math.max(0, shift);
        if (right > bounds.x && left < bounds.x + bounds.width)
          clipRight = Math.max(clipRight, bounds.x + bounds.width - left);
      }
    }
  }
  clipLeft = Math.min(bounds.width, Math.max(0, clipLeft));
  clipRight = Math.min(bounds.width - clipLeft, Math.max(0, clipRight));
  return clipLeft || clipRight ? { ...bounds, clipLeft, clipRight } : bounds;
}

/** Where a pane's page goes and what is cut out of it. */
type Placement = {
  bounds: BrowserBounds | null;
  /** Hidden behind a still image for a modal or unsupported overlay. */
  capture: boolean;
  /** Moving surfaces over the page (browserOverlays.ts). */
  moving: BrowserHole[];
  /** One of them is mid-animation; read where it is drawn again next frame. */
  movingAnimates: boolean;
  /** Moving surfaces are cut out of the page in these bounds. */
  movingCut: boolean;
};

function viewportKey(viewport: Omit<BrowserSnapshot, "src">): string {
  return JSON.stringify([
    viewport.width,
    viewport.height,
    viewport.left,
    viewport.top,
    viewport.scale,
  ]);
}

/** One painted frame, or a frame's time when WebKit defers frames. */
function paintOnce(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      cancelAnimationFrame(paint);
      window.clearTimeout(deadline);
      resolve();
    };
    const paint = requestAnimationFrame(finish);
    const deadline = window.setTimeout(finish, SNAPSHOT_PAINT_DEADLINE_MS);
  });
}

function hasVisibleBrowserArea(bounds: BrowserBounds): boolean {
  return bounds.width - (bounds.clipLeft ?? 0) - (bounds.clipRight ?? 0) >= 1;
}

/**
 * Overlays a still image must stand in for: modal dialogs, very large panels,
 * or any overlap on an engine that cannot cut menus out of its live page.
 */
function hasOccludingOverlay(
  bounds: BrowserBounds,
  holesSupported: boolean,
): boolean {
  return browserOverlayState(bounds, holesSupported).capture;
}

/** Attach the live page's menu cut-outs, or none when the page is captured. */
function withOverlayHoles(
  bounds: BrowserBounds,
  overlay: BrowserOverlayState,
): BrowserBounds {
  return overlay.holes.length ? { ...bounds, holes: overlay.holes } : bounds;
}

/** What a pane last sent its native page: where it is, what is cut out of it, and whether it shows. */
export type BrowserLayoutRecord = {
  bounds: BrowserBounds;
  visible: boolean;
};
const layoutRecords = new Map<string, BrowserLayoutRecord>();

/**
 * The layout a workspace pane last sent its native page, by surface id, for
 * the real-app check: it can only see the page through what was sent.
 */
export function browserLayoutRecord(
  surfaceId: string,
): BrowserLayoutRecord | undefined {
  return layoutRecords.get(surfaceId);
}

export type BrowserPresentationState = {
  visible: boolean;
  /** A page error may pause presentation independently of tab visibility. */
  paused: boolean;
  nativeId: string | null;
  holesSupported: boolean;
  url: string;
  navigation: number;
  zoom: { factor: number | null; menu: unknown };
};

/** Native placement and capture operations; tests can retain real page state. */
export type BrowserPresentationAdapter = {
  bounds(element: HTMLElement): BrowserBounds | null;
  layout(id: string, bounds: BrowserBounds, visible: boolean): Promise<void>;
  snapshot(id: string): Promise<string>;
  decode(src: string): Promise<void>;
  onFocusChanged(callback: () => void): Promise<() => void>;
};

export const nativeBrowserPresentation: BrowserPresentationAdapter = {
  bounds: browserBounds,
  layout: (id, bounds, visible) => nativeBrowser.layout(id, bounds, visible),
  snapshot: (id) => nativeBrowser.snapshot(id),
  decode: async (src) => {
    const image = new Image();
    image.src = src;
    await image.decode();
  },
  onFocusChanged: (callback) => getCurrentWindow().onFocusChanged(callback),
};

export type BrowserPresentation = {
  /** Republish committed state without waiting for an animation frame. */
  update(): void;
  /** Refresh an occluded backing after native-confirmed zoom or menu changes. */
  updateZoom(): void;
  /**
   * Hold the page behind a still image the caller supplies, such as the
   * lossless picture being marked up. Resolves true once the image is
   * painted and the native page is being hidden; false if the pane changed
   * or `thaw` came first. Overlay captures never replace a frozen image.
   */
  freeze(src: string): Promise<boolean>;
  /** Show the live page again, or abandon a freeze still in progress. */
  thaw(): void;
  /**
   * Hide the live page while a picture of it moves with a layout motion
   * (the pane's own image, which the caller paints first). Resolves once
   * the page is hidden, or at a short deadline.
   */
  holdForMotion(): Promise<void>;
  /**
   * Show the live page again at its final bounds. Resolves once it is shown
   * (or at a short deadline, or at once when the pane is not showing), so
   * the picture can go without a gap.
   */
  releaseFromMotion(): Promise<void>;
  dispose(): void;
};

/** One native page's bounds, overlay backing and sidebar-edge presentation. */
export function createBrowserPresentation({
  surfaceId,
  pageId,
  element,
  readState,
  adapter = nativeBrowserPresentation,
  onSnapshot,
  onNotice,
}: {
  surfaceId: string;
  pageId: string;
  element: HTMLElement;
  readState: () => BrowserPresentationState;
  adapter?: BrowserPresentationAdapter;
  /** Commit decoded pixels synchronously before the paint handoff. */
  onSnapshot: (snapshot: BrowserSnapshot | null) => void;
  onNotice: (notice: string) => void;
}): BrowserPresentation {
  let disposed = false;
  let frame: number | null = null;
  let fallback: number | null = null;
  let paintFrame: number | null = null;
  let paintFallback: number | null = null;
  let finishPaint: (() => void) | null = null;
  let finishCapture: (() => void) | null = null;
  let captureGeneration = 0;
  let zoomRefreshTimer: number | null = null;
  let zoomRefreshActive = false;
  let inFlight = false;
  let pending = false;
  let pendingImmediate = false;
  let placementInvalidated = false;
  let lastLayout = "";
  let lastGeometry = "";
  let lastBounds: BrowserBounds | null = null;
  let lastNativeBounds: BrowserBounds | null = null;
  // "covering": a supplied image is going up; "frozen": it stands in for
  // the hidden page. Either way no overlay capture may replace it.
  let freezeState: "none" | "covering" | "frozen" = "none";
  let freezeGeneration = 0;
  // A layout motion moves a picture of the page; the live page stays hidden
  // until the motion hands it back at its final bounds.
  let motionHeld = false;
  // A still image of the page painted beneath it for surfaces that move with
  // the pointer (browserOverlays.ts): the viewport it shows, once painted.
  // Only then is such a surface cut out of the live page, so a cut-out that
  // trails its surface by a frame shows the page, never the window behind.
  let stillBeneath: string | null = null;
  let stillGeneration = 0;
  let stillCapture: number | null = null;
  let stillRetry: number | null = null;
  // This hover: when the surface reached the page, and how long to wait
  // before trying again. Tries never follow the frames it moves: one at a
  // time, further apart each time, and none after the budget.
  let stillSince: number | null = null;
  let stillTries = 0;
  let stillAskedAt = -Infinity;
  // The moving surfaces' still image is the one mounted beneath the page.
  let stillMounted = false;
  // The layout the native page has now cuts moving surfaces out of it.
  let nativeMovingCut = false;
  /**
   * No moving surface is over the page now (it may be springing across its
   * edge): the next one starts a hover of its own and is not cut over the
   * still painted for this one. A capture in flight may still serve it.
   */
  const leaveStill = () => {
    stillBeneath = null;
    stillSince = null;
    stillTries = 0;
    stillAskedAt = -Infinity;
    if (stillRetry !== null) window.clearTimeout(stillRetry);
    stillRetry = null;
  };
  const setStill = (snapshot: BrowserSnapshot | null) => {
    stillBeneath = null;
    stillMounted = false;
    // A capture still in flight is kept: it is checked against what is over
    // the page when it lands and when it has painted.
    if (!snapshot) leaveStill();
    onSnapshot(snapshot);
  };
  /** Try for a still image now, if this hover may. */
  const tryStill = (bounds: BrowserBounds) => {
    if (stillCapture !== null || stillRetry !== null || disposed) return;
    const now = performance.now();
    stillSince ??= now;
    if (now - stillSince > STILL_BUDGET_MS) return;
    const wait =
      stillAskedAt + STILL_RETRY_MS * 2 ** Math.max(0, stillTries - 1) - now;
    if (wait > 0) {
      stillRetry = window.setTimeout(() => {
        stillRetry = null;
        const latest = currentBounds();
        if (latest && movingWanted()) tryStill(latest);
      }, wait);
      return;
    }
    captureStill(bounds);
  };
  /**
   * Drop the image beneath the page once nothing needs it: never while the
   * native page still has a moving surface cut out of it (as last sent, not
   * as the workspace is now), nor while one is over the page.
   */
  const releaseStill = () => {
    if (freezeState !== "none" || nativeMovingCut || movingWanted()) return;
    setStill(null);
  };
  const motionWaiters = new Set<{
    shown: boolean;
    resolve: () => void;
  }>();
  const settleMotion = () => {
    for (const waiter of [...motionWaiters])
      if ((lastLayout !== "hidden") === waiter.shown || disposed) {
        motionWaiters.delete(waiter);
        waiter.resolve();
      }
  };
  const waitForLayout = (shown: boolean) =>
    new Promise<void>((resolve) => {
      const waiter = {
        shown,
        resolve: () => {
          window.clearTimeout(deadline);
          resolve();
        },
      };
      const deadline = window.setTimeout(() => {
        motionWaiters.delete(waiter);
        resolve();
      }, MOTION_HANDOFF_DEADLINE_MS);
      motionWaiters.add(waiter);
      settleMotion();
    });
  // WK may report itself occluded by the native Chromium child. Presentation
  // belongs to the selected workspace pane; macOS hides minimized windows.
  const isPaused = () => {
    const state = readState();
    return !state.visible || state.paused;
  };
  const cancelQueued = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    if (fallback !== null) window.clearTimeout(fallback);
    frame = null;
    fallback = null;
  };
  const waitForSnapshotPaint = () =>
    new Promise<void>((resolve) => {
      const finish = () => {
        if (paintFrame !== null) cancelAnimationFrame(paintFrame);
        if (paintFallback !== null) window.clearTimeout(paintFallback);
        paintFrame = null;
        paintFallback = null;
        finishPaint = null;
        resolve();
      };
      finishPaint = finish;
      paintFrame = requestAnimationFrame(finish);
      paintFallback = window.setTimeout(finish, SNAPSHOT_PAINT_DEADLINE_MS);
    });
  const cancelOverlayCapture = () => {
    ++captureGeneration;
    if (zoomRefreshTimer !== null) window.clearTimeout(zoomRefreshTimer);
    zoomRefreshTimer = null;
    zoomRefreshActive = false;
    finishCapture?.();
    finishPaint?.();
  };
  const captureForOverlay = (zoomRefresh = false) =>
    new Promise<void>((resolve) => {
      const generation = ++captureGeneration;
      const capturedUrl = readState().url;
      const navigation = readState().navigation;
      const capturedZoom = readState().zoom;
      const stillRelevant = () => {
        if (
          disposed ||
          freezeState !== "none" ||
          generation !== captureGeneration ||
          readState().nativeId !== pageId ||
          readState().url !== capturedUrl ||
          readState().navigation !== navigation ||
          readState().zoom.factor !== capturedZoom.factor ||
          (zoomRefresh && readState().zoom.menu !== capturedZoom.menu)
        )
          return false;
        const bounds = currentBounds();
        return !!bounds && hasVisibleBrowserArea(bounds) && occluded(bounds);
      };
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(deadline);
        finishCapture = null;
        resolve();
      };
      const deadline = window.setTimeout(finish, OVERLAY_SNAPSHOT_DEADLINE_MS);
      finishCapture = finish;
      // A slow capture must not block the menu. It can still fill the backing
      // after the deadline, provided this exact page and overlay remain open.
      void requestBrowserSnapshot(
        pageId,
        () => {
          // The queued request may begin after a resize. Record the latest
          // committed native viewport at the moment capture actually starts.
          const viewport = snapshotViewport(lastNativeBounds ?? lastBounds!);
          return adapter.snapshot(pageId).then((src) => ({ src, ...viewport }));
        },
        stillRelevant,
      )
        .then(async (captured) => {
          if (!captured || !stillRelevant()) return;
          const matchesViewport = () => {
            const bounds = currentBounds();
            return (
              !!bounds &&
              sameSnapshotViewport(captured, snapshotViewport(bounds))
            );
          };
          if (!matchesViewport()) return;
          await adapter.decode(captured.src);
          if (!stillRelevant() || !matchesViewport()) return;
          // Once decoded, allow the short paint handoff to finish instead of
          // letting the capture deadline hide Chromium between these steps.
          if (!settled) window.clearTimeout(deadline);
          // Decode first: committing an <img> and waiting one frame does not
          // guarantee its pixels are ready before Chromium is hidden.
          setStill(captured);
          await waitForSnapshotPaint();
        })
        .catch(() => {
          // Keep the overlay usable even if capture or decoding fails.
        })
        .finally(finish);
    });
  // A pane the stage has hidden keeps its place while it waits to come back
  // (a retained surface stays measurable), so its bounds still read as a
  // page on screen. Its page is not: a pane folding to its rail mid-drag
  // is hidden there before its tab stops being visible.
  const shown = () => !isPaused() && !element.closest("[hidden]");
  const currentBounds = () => {
    const bounds = shown() ? adapter.bounds(element) : null;
    return bounds ? withBrowserHitMargins(clipHoverSidebars(bounds)) : null;
  };
  const occluded = (bounds: BrowserBounds) =>
    freezeState === "frozen" ||
    hasOccludingOverlay(bounds, readState().holesSupported);
  // Menus cut out of the live page change size without a style mutation
  // (late content, filtering). Track exactly the surfaces that own holes.
  let holeElements: HTMLElement[] = [];
  const overlaySizes = new ResizeObserver(() => present());
  const trackHoleElements = (elements: HTMLElement[]) => {
    if (
      elements.length === holeElements.length &&
      elements.every((element, index) => element === holeElements[index])
    )
      return;
    overlaySizes.disconnect();
    holeElements = elements;
    for (const element of elements) overlaySizes.observe(element);
  };
  const placement = (bounds: BrowserBounds | null): Placement => {
    if (!bounds || freezeState === "frozen") {
      trackHoleElements([]);
      return {
        bounds,
        capture: !!bounds,
        moving: [],
        movingAnimates: false,
        movingCut: false,
      };
    }
    const overlay = browserOverlayState(bounds, readState().holesSupported);
    trackHoleElements(overlay.elements);
    return withMoving({
      bounds: withOverlayHoles(bounds, overlay),
      capture: overlay.capture,
      moving: overlay.moving,
      movingAnimates: overlay.movingAnimates,
      movingCut: false,
    });
  };
  /** Whether a moving surface is over the page now. */
  const movingWanted = () => {
    if (disposed || motionHeld || freezeState !== "none") return false;
    const bounds = currentBounds();
    return (
      !!bounds &&
      hasVisibleBrowserArea(bounds) &&
      browserOverlayState(bounds, readState().holesSupported).moving.length > 0
    );
  };
  /**
   * Moving surfaces over the page: until a still image of the page is
   * painted beneath it they stay under the live page, then they are cut out
   * where they are drawn. The page never moves, resizes or hides for them.
   */
  const withMoving = (current: Placement): Placement => {
    if (
      !current.bounds ||
      current.capture ||
      motionHeld ||
      freezeState !== "none" ||
      !hasVisibleBrowserArea(current.bounds)
    )
      return current;
    if (!current.moving.length) {
      if (stillSince !== null || stillBeneath !== null) leaveStill();
      return current;
    }
    const viewport = viewportKey(snapshotViewport(current.bounds));
    if (stillBeneath !== viewport) {
      // A still of another viewport (the pane resized) starts afresh.
      if (stillBeneath !== null) leaveStill();
      tryStill(current.bounds);
      return current;
    }
    const holes = [...(current.bounds.holes ?? []), ...current.moving].slice(
      0,
      MAX_BROWSER_HOLES,
    );
    return {
      ...current,
      bounds: { ...current.bounds, holes },
      movingCut: true,
    };
  };
  const captureStill = (bounds: BrowserBounds) => {
    if (stillCapture !== null || disposed) return;
    const generation = ++stillGeneration;
    stillCapture = generation;
    stillAskedAt = performance.now();
    stillTries += 1;
    const { url, navigation } = readState();
    const zoom = readState().zoom.factor;
    const wanted = () =>
      generation === stillGeneration &&
      readState().nativeId === pageId &&
      readState().url === url &&
      readState().navigation === navigation &&
      readState().zoom.factor === zoom &&
      movingWanted();
    const matches = (captured: BrowserSnapshot) => {
      const latest = currentBounds();
      return (
        !!latest && sameSnapshotViewport(captured, snapshotViewport(latest))
      );
    };
    void requestBrowserSnapshot(
      pageId,
      () => {
        const viewport = snapshotViewport(lastNativeBounds ?? bounds);
        return adapter.snapshot(pageId).then((src) => ({ src, ...viewport }));
      },
      wanted,
    )
      .then(async (captured) => {
        if (!captured || !wanted() || !matches(captured)) return;
        await adapter.decode(captured.src);
        if (!wanted() || !matches(captured)) return;
        // Decoded, committed and painted beneath the page before anything
        // is cut out of it.
        stillBeneath = null;
        onSnapshot(captured);
        stillMounted = true;
        await paintOnce();
        if (generation !== stillGeneration || disposed) return;
        // The drag ended while it painted: nothing was cut for it.
        if (!movingWanted()) {
          releaseStill();
          return;
        }
        stillBeneath = viewportKey(captured);
        present();
      })
      .catch(() => {
        // Without a still image the surface stays under the live page.
      })
      .finally(() => {
        if (stillCapture !== generation) return;
        stillCapture = null;
        // Discarded (the page loaded or the pane moved meanwhile) or
        // failed while the surface is still over the page: try again
        // shortly, a few times, rather than wait for it to move.
        if (stillBeneath !== null) return;
        const latest = currentBounds();
        if (latest && movingWanted()) tryStill(latest);
      });
  };
  const refreshZoomSnapshot = (refresh: boolean) => {
    if (!refresh || freezeState !== "none") {
      if (zoomRefreshActive) cancelOverlayCapture();
      return;
    }
    cancelOverlayCapture();
    zoomRefreshActive = true;
    // Native-confirmed changes only. Briefly coalesce repeated +/- presses;
    // retain the existing decoded backing until the latest zoom is ready.
    zoomRefreshTimer = window.setTimeout(() => {
      zoomRefreshTimer = null;
      const bounds = currentBounds();
      if (
        !disposed &&
        readState().zoom.menu &&
        bounds &&
        hasVisibleBrowserArea(bounds) &&
        occluded(bounds)
      )
        void captureForOverlay(true);
    }, ZOOM_SNAPSHOT_DELAY_MS);
  };
  const update = async () => {
    cancelQueued();
    if (disposed) return;
    if (inFlight) {
      pending = true;
      return;
    }
    if (placementInvalidated) {
      lastLayout = "";
      placementInvalidated = false;
    }
    if (lastLayout === "hidden" && isPaused()) return;
    let current = placement(currentBounds());
    let bounds = current.bounds;
    if (bounds) lastBounds = bounds;
    // Native children are created hidden. A never-shown pane needs no work
    // until it has measurable geometry in the visible workspace.
    if (!lastBounds) {
      lastLayout = "hidden";
      return;
    }
    // Nonmodal menus are cut out of the live page in this same pass, so the
    // page stays visible and sharp around them without a still image.
    let show =
      !!bounds &&
      hasVisibleBrowserArea(bounds) &&
      !current.capture &&
      !motionHeld;
    let nextLayout = show ? JSON.stringify([lastBounds, true]) : "hidden";
    // A moving surface's springs change no attribute: follow it each frame
    // while they run, so its cut-out ends where it is drawn.
    const following = current.movingAnimates && current.moving.length > 0;
    if (
      nextLayout === lastLayout &&
      (!bounds || JSON.stringify(lastBounds) === lastGeometry)
    ) {
      endBrowserHandoff(surfaceId);
      settleMotion();
      if (show && stillMounted) releaseStill();
      if (following) schedule();
      return;
    }
    inFlight = true;
    try {
      if (
        !show &&
        !motionHeld &&
        freezeState === "none" &&
        bounds &&
        hasVisibleBrowserArea(bounds) &&
        lastLayout &&
        lastLayout !== "hidden"
      ) {
        // The native child must move behind HTML overlays. Take one still
        // image for that transition, never during resize or workspace hide.
        try {
          await captureForOverlay();
        } catch {
          // A failed snapshot cannot destroy the valid native page. The
          // obscured fallback keeps the overlay accessible until it closes.
        }
        if (disposed) return;
        // Menus may close or the pane may hide while capture/paint is pending.
        current = placement(currentBounds());
        bounds = current.bounds;
        if (bounds) lastBounds = bounds;
        show =
          !!bounds &&
          hasVisibleBrowserArea(bounds) &&
          !current.capture &&
          !motionHeld;
        nextLayout = show ? JSON.stringify([lastBounds, true]) : "hidden";
        if (
          nextLayout === lastLayout &&
          (!bounds || JSON.stringify(lastBounds) === lastGeometry)
        ) {
          if (show) releaseStill();
          return;
        }
      }
      if (
        !show &&
        !readState().visible &&
        lastLayout &&
        lastLayout !== "hidden"
      ) {
        // Leaving this page for another tab. If that tab is a native page
        // still on its way in, keep this one painted until it arrives so
        // the window background never shows between them.
        await waitForBrowserHandoff();
        if (disposed) return;
        if (!isPaused()) {
          pending = true;
          return;
        }
      }
      const sentBounds = lastBounds;
      const viewportChanged =
        !!lastNativeBounds &&
        !sameSnapshotViewport(
          snapshotViewport(lastNativeBounds),
          snapshotViewport(sentBounds),
        );
      await adapter.layout(pageId, sentBounds, show);
      nativeMovingCut = show && current.movingCut;
      if (!disposed)
        layoutRecords.set(surfaceId, { bounds: sentBounds, visible: show });
      lastNativeBounds = sentBounds;
      lastGeometry = JSON.stringify(sentBounds);
      lastLayout = nextLayout;
      // A freeze may have put its picture beneath the page while this
      // layout was in flight; that picture is not this layout's to release.
      // Nor is the still image a moving surface over the page still needs.
      if (show && !disposed) releaseStill();
      else if (
        !disposed &&
        freezeState === "none" &&
        bounds &&
        viewportChanged &&
        occluded(bounds)
      ) {
        // A retained overlay can outlive a pane resize. Resize the hidden
        // native viewport first, then replace its backing at the new size.
        cancelOverlayCapture();
        void captureForOverlay();
      }
    } catch (reason) {
      if (!disposed)
        onNotice(`Could not update preview placement: ${errorMessage(reason)}`);
    } finally {
      inFlight = false;
      settleMotion();
      if (!show || lastLayout !== "hidden") endBrowserHandoff(surfaceId);
      if (following && !pending && !disposed) schedule();
      if (pending && !disposed) {
        pending = false;
        if (pendingImmediate) {
          pendingImmediate = false;
          present();
        } else schedule();
      }
    }
  };
  const schedule = () => {
    if (disposed || (lastLayout === "hidden" && isPaused())) return;
    if (inFlight) {
      pending = true;
      return;
    }
    if (frame !== null || fallback !== null) return;
    const flush = () => void update();
    frame = requestAnimationFrame(flush);
    // WKWebView may defer animation frames while native children cover it.
    // One bounded fallback restores visibility without an idle polling loop.
    fallback = window.setTimeout(flush, LAYOUT_FALLBACK_MS);
  };
  const present = () => {
    if (disposed) return;
    cancelQueued();
    const bounds = currentBounds();
    if (!bounds || !hasVisibleBrowserArea(bounds) || !occluded(bounds))
      cancelOverlayCapture();
    if (inFlight) {
      pending = true;
      pendingImmediate = true;
      return;
    }
    // Explicit tab/visibility changes must not wait for a host animation
    // frame, which WKWebView can throttle behind native child pages.
    void update();
  };
  const resetPlacement = () => {
    // A native reparent may invalidate a layout the retained renderer already
    // sent while another window owned the page. Republish it even unchanged.
    placementInvalidated = true;
    present();
  };
  const resize = new ResizeObserver(schedule);
  const overlayNode = (node: Node) =>
    node instanceof HTMLElement &&
    (node.matches(OVERLAYS) || node.querySelector(OVERLAYS));
  const overlays = new MutationObserver((records) => {
    if (lastLayout === "hidden" && isPaused()) return;
    // A pane or panel drag writes several style properties on the same
    // elements every frame. Search each changed subtree for overlays once.
    const styled = new Set<Node>();
    if (
      records.some((record) => {
        if (record.type !== "attributes")
          return [...record.addedNodes, ...record.removedNodes].some(
            overlayNode,
          );
        // A retained floating panel may remove its occlusion marker.
        // Its new selector state alone cannot tell us to restore the page.
        if (
          [
            "aria-modal",
            "role",
            "open",
            "hidden",
            "data-native-browser-occluded",
            "data-native-browser-edge",
          ].includes(record.attributeName ?? "")
        )
          return true;
        if (record.attributeName === "data-open")
          return (
            record.target instanceof HTMLElement &&
            !!record.target.querySelector("[data-native-browser-edge]")
          );
        if (styled.has(record.target)) return false;
        styled.add(record.target);
        return overlayNode(record.target);
      })
    )
      present();
  });
  const transitionEnded = (event: Event) => {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.contains(element) || overlayNode(target))
    )
      schedule();
  };
  let stopObserving: (() => void) | undefined;
  const observePresentation = () => {
    if (isPaused()) {
      stopObserving?.();
      stopObserving = undefined;
      trackHoleElements([]);
      return;
    }
    if (stopObserving) return;
    // Retain the native page, its agent binding and navigation state while
    // hidden, without asking WebKit to collect whole-app mutation records
    // for every visited tab. Reconnect before publishing the visible layout.
    resize.observe(element);
    overlays.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "aria-modal",
        "role",
        "open",
        "hidden",
        "class",
        "style",
        "data-native-browser-occluded",
        "data-native-browser-edge",
        "data-open",
      ],
    });
    document.addEventListener("visibilitychange", present);
    document.addEventListener("transitionend", transitionEnded, true);
    document.addEventListener("animationend", transitionEnded, true);
    window.addEventListener("resize", schedule);
    window.addEventListener("supermono:workspace-layout", present);
    window.addEventListener("supermono:browser-layout-reset", resetPlacement);
    const focusListener = adapter.onFocusChanged(schedule);
    stopObserving = () => {
      resize.disconnect();
      overlays.disconnect();
      document.removeEventListener("visibilitychange", present);
      document.removeEventListener("transitionend", transitionEnded, true);
      document.removeEventListener("animationend", transitionEnded, true);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("supermono:workspace-layout", present);
      window.removeEventListener(
        "supermono:browser-layout-reset",
        resetPlacement,
      );
      void focusListener.then((unlisten) => unlisten()).catch(() => {});
    };
  };
  let previousZoom = readState().zoom.factor;
  const updateZoom = () => {
    if (disposed) return;
    const zoom = readState().zoom;
    const changed = previousZoom !== zoom.factor;
    previousZoom = zoom.factor;
    if (!zoom.menu) refreshZoomSnapshot(false);
    else if (changed) refreshZoomSnapshot(true);
  };
  const updatePresentation = () => {
    if (disposed) return;
    observePresentation();
    present();
  };
  const freeze = async (src: string) => {
    const generation = ++freezeGeneration;
    const current = () =>
      !disposed && generation === freezeGeneration && !isPaused();
    const bounds = current() ? currentBounds() : null;
    if (!bounds || !hasVisibleBrowserArea(bounds) || !lastBounds) return false;
    freezeState = "covering";
    cancelOverlayCapture();
    try {
      await adapter.decode(src);
    } catch {
      if (generation === freezeGeneration) freezeState = "none";
      return false;
    }
    if (!current()) return false;
    // The same handoff as an overlay backing: decoded pixels committed and
    // painted beneath the page before Chromium is hidden.
    setStill({ src, ...snapshotViewport(lastNativeBounds ?? lastBounds) });
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        cancelAnimationFrame(paint);
        window.clearTimeout(deadline);
        resolve();
      };
      const paint = requestAnimationFrame(finish);
      const deadline = window.setTimeout(finish, SNAPSHOT_PAINT_DEADLINE_MS);
    });
    if (!current()) return false;
    freezeState = "frozen";
    present();
    return true;
  };
  const thaw = () => {
    ++freezeGeneration;
    const previous = freezeState;
    freezeState = "none";
    if (disposed || previous === "none") return;
    // A freeze abandoned before hiding the page leaves it shown; drop the
    // image it put beneath. Otherwise the next layout shows the page and
    // releases the image itself.
    if (previous === "covering" && lastLayout !== "hidden") setStill(null);
    present();
  };
  const holdForMotion = () => {
    if (disposed) return Promise.resolve();
    motionHeld = true;
    present();
    return waitForLayout(false);
  };
  const releaseFromMotion = () => {
    if (disposed || !motionHeld) return Promise.resolve();
    motionHeld = false;
    present();
    // A pane that is not showing keeps its page hidden; nothing to wait for.
    if (isPaused()) return Promise.resolve();
    return waitForLayout(true);
  };
  updatePresentation();
  return {
    update: updatePresentation,
    updateZoom,
    freeze,
    thaw,
    holdForMotion,
    releaseFromMotion,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (layoutRecords.get(surfaceId)?.bounds === lastNativeBounds)
        layoutRecords.delete(surfaceId);
      settleMotion();
      endBrowserHandoff(surfaceId);
      cancelQueued();
      cancelOverlayCapture();
      if (stillRetry !== null) window.clearTimeout(stillRetry);
      stillRetry = null;
      stopObserving?.();
      overlaySizes.disconnect();
      holeElements = [];
    },
  };
}

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { errorText, logError } from "../lib/errors";
import {
  ACTIVITY_EVENT,
  CALL_EVENT,
  DISMISS_EVENT,
  EDGE_CLICK_EVENT,
  POINTER_EVENT,
  REQUEST_EVENT,
  RESULT_EVENT,
  SNAPSHOT_EVENT,
  currentViewport,
  decodeSidebarValue,
  encodeSidebarValue,
  nativeFloatingSidebar,
  rectOf,
  watchDevicePixelRatio,
  type FloatingSidebarActivity,
  type FloatingSidebarCall,
  type FloatingSidebarPointer,
  type FloatingSidebarRect,
  type FloatingSidebarResult,
  type FloatingSidebarSnapshot,
} from "../lib/floatingSidebar";
import {
  createSidebarPeek,
  type SidebarPeek,
} from "../lib/floatingSidebarPeek";
import { liveHarnessModels, subscribeModels } from "../lib/models";
import { orchestrator } from "../lib/orchestration";
import { loadUiScale } from "../lib/uiScale";
import {
  getUpdaterSnapshot,
  installPendingUpdate,
  runUpdateFlow,
  subscribeUpdater,
} from "../lib/updater";
import { requestDockHandoff } from "./usePanelDockHandoff";

// The same intent delays as the DOM peek: rest on the edge briefly before
// revealing, and a short grace on leave.
const ENTER_DELAY = 150;
const LEAVE_DELAY = 90;
// Pinning from the card: the docked sidebar holds at the card's place while
// native code removes the card above it, then glides into the dock.
const DOCK_HOLD = 90;
const DOCK_SWAP = 50;
/** Native → workspace: a close finished and the card is gone. */
const CLOSED_EVENT = "floating-sidebar-closed";
const MODELS_KEY = "\u0000models";

/** The overlay's updater card acts through this window's updater. */
const OWN_HANDLERS = {
  refreshUpdater: (manual: boolean) => runUpdateFlow(manual),
  installUpdate: () => installPendingUpdate(),
};

/** Callbacks that show something in the workspace hand the keyboard back to it. */
const WORKSPACE_ACTIONS = new Set([
  "onSelectSession",
  "onSelectProjectSession",
  "onSelectAgent",
  "onSelectProject",
  "onNew",
  "onNewStandalone",
  "onNewProjectTask",
  "onNewTerminal",
  "onOpenStandalone",
  "onOpenFile",
  "onOpenTerminal",
  "onOpenDiff",
  "onOpenAllChanges",
  "onOpenCommit",
  "onShowSourceControl",
  "onSearch",
  "onOpenInbox",
  "onOpenAutomations",
  "onOpenNotes",
  "onGoToFile",
  "onOpenSettings",
  "onSelectSettingsSection",
  "onCloseSettings",
  "onOpenWhatsNew",
  "onGoBack",
  "onGoForward",
  "openWorkerDetails",
]);

/**
 * Attaches the macOS sidebar layer to this workspace window. Resolves to the
 * overlay webview's label, or stays null where the layer is unavailable and
 * the workspace keeps its own DOM peek.
 */
export function useFloatingSidebarLayer(enabled: boolean) {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    nativeFloatingSidebar
      .attach()
      .then((attached) => {
        if (!disposed) setLabel(attached);
      })
      .catch(() => {
        // Unavailable on this build: the DOM peek stays in place.
      });
    return () => {
      disposed = true;
    };
  }, [enabled]);
  return label;
}

type Handler = (...args: never[]) => unknown;

type Options = {
  /** The overlay webview from `useFloatingSidebarLayer`. */
  label: string | null;
  /** The `Sidebar` props the overlay renders; callbacks are called by name. */
  props: Record<string, unknown>;
  /** Further callables: add-project choices, orchestration, workers, pane drops. */
  handlers: Record<string, Handler | undefined>;
  /** Data beside the props, read when publishing. */
  extra: () => Pick<FloatingSidebarSnapshot, "orchestration">;
  pinned: boolean;
  windowFocused: boolean;
  onToggleSidebar: () => void;
  /** Remount the workspace's own sidebar so it reloads what the card saved. */
  onRefreshSidebar: () => void;
};

/**
 * Runs the macOS hover sidebar as a native layer above browser pages: it
 * publishes the sidebar's snapshot, runs the overlay's callbacks, and decides
 * when the card opens and closes.
 */
export function useNativeFloatingSidebar({
  label,
  props,
  handlers,
  extra,
  pinned,
  windowFocused,
  onToggleSidebar,
  onRefreshSidebar,
}: Options) {
  const latest = useRef({
    props,
    handlers,
    extra,
    pinned,
    onToggleSidebar,
    onRefreshSidebar,
  });
  latest.current = {
    props,
    handlers,
    extra,
    pinned,
    onToggleSidebar,
    onRefreshSidebar,
  };
  const [revealed, setRevealed] = useState(false);
  // Unpinning may leave the overlay's sidebar behind what the docked one saved.
  const [generation, setGeneration] = useState(0);
  const card = useRef<FloatingSidebarRect | null>(null);
  // The card saved state since the workspace's own sidebar last mounted.
  const stale = useRef(false);
  // A remounted docked sidebar starts closed for a frame, so it fades in.
  const [dockHidden, setDockHidden] = useState(false);

  const peek = useRef<SidebarPeek | null>(null);
  peek.current ??= createSidebarPeek({
    enterDelay: ENTER_DELAY,
    leaveDelay: LEAVE_DELAY,
    onChange: (open, animated) => {
      setRevealed(open);
      void nativeFloatingSidebar
        .setOpen(open, animated)
        .catch((error) => logError("Floating sidebar", error));
    },
  });

  // --- Snapshot ------------------------------------------------------------
  const encoded = useRef(
    new Map<string, { value: unknown; encoded: unknown }>(),
  );
  const sent = useRef("");
  const frame = useRef(0);
  const publish = useRef<(force?: boolean) => void>(() => {});
  publish.current = (force = false) => {
    if (!label) return;
    const data: Record<string, unknown> = {};
    const actions: string[] = [];
    const cache = encoded.current;
    for (const [key, value] of Object.entries(latest.current.props)) {
      if (typeof value === "function") {
        actions.push(key);
        continue;
      }
      let entry = cache.get(key);
      if (!entry || entry.value !== value) {
        entry = { value, encoded: encodeSidebarValue(value) };
        cache.set(key, entry);
      }
      if (entry.encoded !== undefined) data[key] = entry.encoded;
    }
    for (const [key, value] of Object.entries(latest.current.handlers))
      if (typeof value === "function") actions.push(key);
    actions.push(...Object.keys(OWN_HANDLERS));
    const models = liveHarnessModels();
    let modelEntry = cache.get(MODELS_KEY);
    if (!modelEntry || modelEntry.value !== models) {
      modelEntry = { value: models, encoded: encodeSidebarValue(models) };
      cache.set(MODELS_KEY, modelEntry);
    }
    const root = document.documentElement;
    const body = document.querySelector<HTMLElement>(".personal-shell-body");
    const snapshot: FloatingSidebarSnapshot = {
      generation,
      props: data,
      actions: actions.sort(),
      appearance: {
        className: root.className,
        style: root.style.cssText,
        uiScale: loadUiScale(),
      },
      body: body
        ? rectOf(body.getBoundingClientRect())
        : { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
      viewportHeight: window.innerHeight,
      panes: [...document.querySelectorAll<HTMLElement>("[data-pane-id]")]
        .map((pane) => ({
          id: pane.dataset.paneId ?? "",
          rect: rectOf(pane.getBoundingClientRect()),
        }))
        .filter((pane) => pane.id && pane.rect.width > 0),
      updater: getUpdaterSnapshot(),
      models: modelEntry.encoded,
      ...latest.current.extra(),
    };
    const text = JSON.stringify(snapshot);
    if (!force && text === sent.current) return;
    sent.current = text;
    void nativeFloatingSidebar
      .send(label, SNAPSHOT_EVENT, snapshot)
      .catch((error) => logError("Floating sidebar snapshot", error));
  };
  const schedulePublish = useRef(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      publish.current();
    });
  });
  // Every workspace render may change the sidebar's data.
  useEffect(() => {
    schedulePublish.current();
  });
  useEffect(() => {
    if (!label) return;
    const observer = new MutationObserver(() => schedulePublish.current());
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    const stops = [
      orchestrator.subscribe(() => schedulePublish.current()),
      subscribeUpdater(() => schedulePublish.current()),
      subscribeModels(() => schedulePublish.current()),
    ];
    return () => {
      observer.disconnect();
      for (const stop of stops) stop();
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [label]);

  // --- Workspace geometry ----------------------------------------------------
  const geometry = useRef(() => {});
  geometry.current = () => {
    if (!label) return;
    const column = document
      .querySelector<HTMLElement>(".personal-workspace-column")
      ?.getBoundingClientRect();
    const edge = document
      .querySelector<HTMLElement>(".personal-panel-edge-left")
      ?.getBoundingClientRect();
    void nativeFloatingSidebar
      .workspace({
        viewport: currentViewport(),
        coverTop: column?.top ?? 0,
        coverBottom: column?.bottom ?? window.innerHeight,
        edgeTop: edge?.top ?? column?.top ?? 0,
        edgeBottom: edge?.bottom ?? column?.bottom ?? window.innerHeight,
        // A pin keeps the card until the docked sidebar has taken its place.
        enabled: !latest.current.pinned || !!peek.current?.open,
      })
      .catch((error) => logError("Floating sidebar", error));
    schedulePublish.current();
  };
  useLayoutEffect(() => {
    if (!label) return;
    // The observer reports once it starts watching, after this frame's
    // layout. Measuring here instead made WebKit lay out the window
    // mid-commit on every pin and unpin (~30 ms).
    const update = () => geometry.current();
    const observer = new ResizeObserver(update);
    for (const selector of [
      ".personal-shell-body",
      ".personal-workspace-column",
    ]) {
      const element = document.querySelector(selector);
      if (element) observer.observe(element);
    }
    window.addEventListener("resize", update);
    const stopScale = watchDevicePixelRatio(update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      stopScale();
    };
  }, [label, pinned]);

  // --- Native and overlay events --------------------------------------------
  useEffect(() => {
    if (!label) return;
    const controller = peek.current!;
    // A reloaded workspace document starts closed; so does the native layer.
    controller.reset();
    setRevealed(false);
    void nativeFloatingSidebar.setOpen(false, false).catch(() => {});
    const respond = (result: FloatingSidebarResult) =>
      void nativeFloatingSidebar
        .send(label, RESULT_EVENT, result)
        .catch((error) => logError("Floating sidebar", error));
    const stops: Promise<() => void>[] = [
      nativeFloatingSidebar.listen<FloatingSidebarPointer>(
        POINTER_EVENT,
        (pointer) => {
          controller.pointer(pointer);
        },
      ),
      nativeFloatingSidebar.listen<
        FloatingSidebarActivity & { card?: FloatingSidebarRect }
      >(ACTIVITY_EVENT, (activity) => {
        if (activity.card) card.current = activity.card;
        controller.activity(activity);
      }),
      nativeFloatingSidebar.listen(DISMISS_EVENT, () => controller.dismiss()),
      nativeFloatingSidebar.listen(EDGE_CLICK_EVENT, () =>
        latest.current.onToggleSidebar(),
      ),
      nativeFloatingSidebar.listen(REQUEST_EVENT, () => publish.current(true)),
      nativeFloatingSidebar.listen(CLOSED_EVENT, () => {
        stale.current = true;
      }),
      nativeFloatingSidebar.listen<FloatingSidebarCall>(
        CALL_EVENT,
        ({ id, name, args }) => {
          const { props: current, handlers: extraHandlers } = latest.current;
          const callback =
            typeof current[name] === "function"
              ? current[name]
              : (extraHandlers[name] ??
                (Object.hasOwn(OWN_HANDLERS, name)
                  ? OWN_HANDLERS[name as keyof typeof OWN_HANDLERS]
                  : undefined));
          if (typeof callback !== "function") {
            respond({
              id,
              ok: false,
              error: `Unknown sidebar action: ${name}`,
            });
            return;
          }
          const decoded = decodeSidebarValue(args);
          Promise.resolve()
            .then(() =>
              Reflect.apply(
                callback,
                undefined,
                Array.isArray(decoded) ? decoded : [],
              ),
            )
            .then(
              (value) =>
                respond({ id, ok: true, value: encodeSidebarValue(value) }),
              (error) => respond({ id, ok: false, error: errorText(error) }),
            );
          if (WORKSPACE_ACTIONS.has(name))
            void nativeFloatingSidebar.focusWorkspace().catch(() => {});
        },
      ),
    ];
    return () => {
      for (const stop of stops) void stop.then((fn) => fn()).catch(() => {});
      controller.reset();
    };
  }, [label]);

  useEffect(() => {
    if (!windowFocused) peek.current?.dismiss();
  }, [windowFocused]);

  // --- Pinning and unpinning -------------------------------------------------
  const wasPinned = useRef(pinned);
  useEffect(() => {
    const controller = peek.current!;
    controller.setEnabled(!!label && !pinned);
    const unpinned = wasPinned.current && !pinned;
    wasPinned.current = pinned;
    if (!label) return;
    if (unpinned) setGeneration((current) => current + 1);
    if (pinned && !controller.open && stale.current) {
      // Reload what the card saved, then let the docked sidebar fade in.
      stale.current = false;
      setDockHidden(true);
      latest.current.onRefreshSidebar();
      let frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => setDockHidden(false));
      });
      // Geometry follows from the observer above, after this frame's layout.
      return () => {
        cancelAnimationFrame(frame);
        setDockHidden(false);
      };
    }
    // Geometry follows from the observer above, after this frame's layout;
    // measuring here made WebKit lay out the window mid-update (~30 ms).
    if (!pinned || !controller.open) return;
    // Pinning from the card: the docked sidebar mounts fresh at the card's
    // place, holds there while native code removes the card, then docks.
    stale.current = false;
    if (card.current)
      requestDockHandoff(
        { left: card.current.x, top: card.current.y },
        DOCK_HOLD,
      );
    latest.current.onRefreshSidebar();
    const swap = setTimeout(() => {
      controller.dismiss(false);
      geometry.current();
    }, DOCK_SWAP);
    return () => clearTimeout(swap);
  }, [label, pinned]);

  return { revealed, dockHidden };
}

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { AddProjectMenu } from "../chrome/AddProjectMenu";
import { OrchestrationWorkers } from "../chrome/OrchestrationActions";
import { Sidebar, type SidebarProps } from "../chrome/Sidebar";
import {
  devSmokeConfig,
  SMOKE_OVERLAY_EVENT,
  SMOKE_OVERLAY_RESULT_EVENT,
  waitFor,
} from "../lib/devSmoke";
import { errorText, logError } from "../lib/errors";
import {
  ACTIVITY_EVENT,
  CALL_EVENT,
  DISMISS_EVENT,
  REQUEST_EVENT,
  RESULT_EVENT,
  SNAPSHOT_EVENT,
  currentViewport,
  decodeSidebarValue,
  encodeSidebarValue,
  nativeFloatingSidebar,
  overlayOwner,
  paneDropAt,
  rectOf,
  watchDevicePixelRatio,
  type FloatingSidebarRect,
  type FloatingSidebarResult,
  type FloatingSidebarSnapshot,
} from "../lib/floatingSidebar";
import type { HarnessId, SessionAgent } from "../lib/session";
import { setHarnessModels, type AgentModel } from "../lib/models";
import { orchestrator, type OrchestrationRun } from "../lib/orchestration";
import { setPaneDropBridge } from "../lib/paneDrop";
import { applyUiScale } from "../lib/uiScale";
import {
  mirrorUpdater,
  showMirroredUpdater,
  type UpdaterSnapshot,
} from "../lib/updater";
import "./FloatingSidebarWindow.css";

/** Menus, dialogs and popovers keep the card out and take pointer events. */
const INTERACTIONS =
  '[aria-modal="true"], [role="dialog"], [role="menu"], [role="listbox"], [data-popover-side]';

function visible(element: Element) {
  return (
    !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
    element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== "hidden"
  );
}

type Pending = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

/**
 * The hover sidebar's overlay webview. It renders the workspace's own
 * `Sidebar` from snapshots and runs callbacks in the workspace by name; native
 * code owns its motion, and the workspace decides when it opens and closes.
 */
export function FloatingSidebarWindow() {
  const owner = useMemo(
    () => overlayOwner(getCurrentWebview().label) ?? "main",
    [],
  );
  const [snapshot, setSnapshot] = useState<FloatingSidebarSnapshot | null>(
    null,
  );
  const latest = useRef(snapshot);
  latest.current = snapshot;

  // Aven Dev's real-app check: press this page's own Settings and Back
  // buttons. A page that freezes on Back never answers, and the workspace
  // reports that.
  useEffect(() => {
    if (!devSmokeConfig()) return;
    const stop = nativeFloatingSidebar.listen(SMOKE_OVERLAY_EVENT, () => {
      void runOverlaySmoke(owner);
    });
    return () => void stop.then((unlisten) => unlisten()).catch(() => {});
  }, [owner]);

  // --- Calls into the workspace ----------------------------------------------
  const pending = useRef(new Map<number, Pending>());
  const nextCall = useRef(1);
  const call = useCallback(
    (name: string, args: unknown[] = []) =>
      new Promise<unknown>((resolve, reject) => {
        const id = nextCall.current++;
        pending.current.set(id, { resolve, reject });
        nativeFloatingSidebar
          .send(owner, CALL_EVENT, {
            id,
            name,
            args: encodeSidebarValue(args),
          })
          .catch((error) => {
            pending.current.delete(id);
            reject(error instanceof Error ? error : new Error(String(error)));
          });
      }),
    [owner],
  );
  const fire = useCallback(
    (name: string, args: unknown[] = []) =>
      void call(name, args).catch((error) =>
        logError(`Floating sidebar ${name}`, error),
      ),
    [call],
  );

  useEffect(() => {
    document.getElementById("boot-splash")?.remove();
    document.documentElement.classList.add("aven-floating-sidebar-overlay");
    let disposed = false;
    const stops = [
      nativeFloatingSidebar.listen<FloatingSidebarSnapshot>(
        SNAPSHOT_EVENT,
        (next) => {
          if (!disposed) setSnapshot(next);
        },
      ),
      nativeFloatingSidebar.listen<FloatingSidebarResult>(
        RESULT_EVENT,
        (result) => {
          const waiting = pending.current.get(result.id);
          if (!waiting) return;
          pending.current.delete(result.id);
          if (result.ok) waiting.resolve(decodeSidebarValue(result.value));
          else
            waiting.reject(new Error(result.error ?? "Sidebar action failed"));
        },
      ),
    ];
    void Promise.all(stops)
      .then(() =>
        disposed
          ? undefined
          : nativeFloatingSidebar.send(owner, REQUEST_EVENT, {}),
      )
      .catch((error) => logError("Floating sidebar", error));
    return () => {
      disposed = true;
      for (const stop of stops) void stop.then((fn) => fn()).catch(() => {});
    };
  }, [owner]);

  // --- Workspace-owned stores, mirrored ------------------------------------
  useEffect(() => {
    // Both webviews start at the window's top-left with one zoom, so a point
    // means the same place in either document once their heights are aligned.
    setPaneDropBridge({
      resolve: (x, y) => {
        const current = latest.current;
        if (!current) return null;
        return paneDropAt(
          current.panes,
          x,
          y - (window.innerHeight - current.viewportHeight),
        );
      },
      publish: (drop) => fire("showPaneDrop", [drop]),
    });
    mirrorUpdater({
      refresh: (manual) =>
        call("refreshUpdater", [manual]) as Promise<UpdaterSnapshot>,
      install: () => call("installUpdate") as Promise<UpdaterSnapshot>,
      restartNow: () => call("restartUpdateNow") as Promise<UpdaterSnapshot>,
      cancelWait: () => call("cancelUpdateWait") as Promise<UpdaterSnapshot>,
    });
    // Orchestration runs live in the workspace; this copy only displays them.
    orchestrator.cancelTask = (leadId: string, taskId: string) =>
      call("cancelOrchestrationTask", [leadId, taskId]).then(() => undefined);
    orchestrator.start = ((...args: unknown[]) =>
      call("startOrchestration", args)) as typeof orchestrator.start;
    return () => {
      setPaneDropBridge(null);
      mirrorUpdater(null);
    };
  }, [call, fire]);

  const runs = snapshot?.orchestration.runs;
  useEffect(() => {
    if (runs !== undefined)
      orchestrator.mirror(
        (decodeSidebarValue(runs) as OrchestrationRun[] | null) ?? [],
      );
  }, [runs]);
  const updater = snapshot?.updater;
  useEffect(() => {
    if (updater) showMirroredUpdater(updater);
  }, [updater]);
  const models = snapshot?.models;
  useEffect(() => {
    const catalogs = decodeSidebarValue(models) as Partial<
      Record<HarnessId, AgentModel[]>
    > | null;
    for (const [harness, list] of Object.entries(catalogs ?? {}))
      if (list?.length) setHarnessModels(harness as HarnessId, list);
  }, [models]);

  const orchestration = snapshot?.orchestration;
  const workers = useMemo(
    () => ({
      agentsByLead: decodeSidebarValue(orchestration?.agentsByLead) as
        ReadonlyMap<string, readonly SessionAgent[]> | undefined,
      selectedId: orchestration?.selectedId ?? null,
      inspect: (sessionId: string | null) => fire("inspectWorker", [sessionId]),
      openDetails: orchestration?.details
        ? (worker: unknown) => fire("openWorkerDetails", [worker])
        : undefined,
    }),
    [orchestration, fire],
  );

  // --- Appearance ------------------------------------------------------------
  const appearance = snapshot?.appearance;
  const rootClass = appearance?.className;
  const rootStyle = appearance?.style;
  useLayoutEffect(() => {
    if (rootClass === undefined || rootStyle === undefined) return;
    const root = document.documentElement;
    root.className = `${rootClass} aven-floating-sidebar-overlay`;
    root.style.cssText = rootStyle;
  }, [rootClass, rootStyle]);
  const uiScale = appearance?.uiScale;
  useEffect(() => {
    if (uiScale !== undefined) void applyUiScale(uiScale);
  }, [uiScale]);

  // --- Sidebar props ---------------------------------------------------------
  const rawProps = snapshot?.props;
  const props = useMemo(
    () =>
      rawProps
        ? (decodeSidebarValue(rawProps) as Record<string, unknown>)
        : null,
    [rawProps],
  );
  const [addProjectAnchor, setAddProjectAnchor] = useState<HTMLElement | null>(
    null,
  );
  const actionKey = snapshot?.actions.join(",") ?? "";
  const proxies = useMemo(() => {
    const result: Record<string, (...args: unknown[]) => unknown> = {};
    for (const name of actionKey ? actionKey.split(",") : [])
      result[name] = (...args: unknown[]) => call(name, args);
    // The add-project choices open from the card, in this webview.
    result.onAddProject = (anchor?: unknown) => {
      if (anchor instanceof HTMLElement) setAddProjectAnchor(anchor);
      else fire("addExistingProject");
    };
    return result;
  }, [actionKey, call, fire]);
  const chooseProject = (name: string) => {
    setAddProjectAnchor(null);
    fire(name);
  };

  // --- Native hit regions and activity ---------------------------------------
  const sentRegions = useRef("");
  const sentActivity = useRef("");
  const keyboard = useRef(false);
  const dragging = useRef(false);
  const report = useRef(() => {});
  report.current = () => {
    const card = document.querySelector<HTMLElement>(".personal-sidebar");
    const current = latest.current;
    if (!card || !current) return;
    const regions: FloatingSidebarRect[] = [
      rectOf(card.getBoundingClientRect()),
    ];
    let menus = false;
    for (const element of document.querySelectorAll(INTERACTIONS)) {
      if (!visible(element)) continue;
      menus = true;
      regions.push(rectOf(element.getBoundingClientRect()));
    }
    // An open menu takes the whole window, so a click outside it reaches
    // this document and closes the menu, as it would in the workspace.
    if (menus)
      regions.push({
        x: 0,
        y: 0,
        width: window.innerWidth,
        height: window.innerHeight,
      });
    const interaction = menus || dragging.current;
    const geometry = {
      viewport: currentViewport(),
      card: regions[0],
      regions: regions.slice(0, 64),
    };
    const text = JSON.stringify(geometry);
    if (text !== sentRegions.current) {
      sentRegions.current = text;
      void nativeFloatingSidebar
        .regions(geometry)
        .catch((error) => logError("Floating sidebar regions", error));
    }
    const active = document.activeElement;
    const offset = window.innerHeight - current.viewportHeight;
    const activity = {
      interaction,
      focus:
        keyboard.current &&
        !!active &&
        active !== document.body &&
        (card.contains(active) || !!active.closest(INTERACTIONS)),
      // In the workspace's coordinates, for docking from the card's place.
      card: { ...regions[0], y: regions[0].y - offset },
    };
    const activityText = JSON.stringify(activity);
    if (activityText !== sentActivity.current) {
      sentActivity.current = activityText;
      void nativeFloatingSidebar
        .send(owner, ACTIVITY_EVENT, activity)
        .catch((error) => logError("Floating sidebar activity", error));
    }
  };
  useLayoutEffect(() => {
    report.current();
  });
  const ready = !!props;
  useEffect(() => {
    if (!ready) return;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        report.current();
      });
    };
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "hidden",
        "inert",
        "aria-hidden",
        "open",
        "style",
        "class",
      ],
    });
    const sizes = new ResizeObserver(schedule);
    sizes.observe(document.body);
    const card = document.querySelector(".personal-sidebar");
    if (card) sizes.observe(card);
    // A drag that leaves the card (to reorder or place a session) keeps it out.
    const pointerDown = () => {
      keyboard.current = false;
      dragging.current = true;
      schedule();
    };
    const pointerUp = () => {
      dragging.current = false;
      schedule();
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        const open = [...document.querySelectorAll(INTERACTIONS)].some(visible);
        if (!open) {
          event.preventDefault();
          void nativeFloatingSidebar.send(owner, DISMISS_EVENT, {});
          return;
        }
      }
      if (!["Shift", "Control", "Alt", "Meta"].includes(event.key))
        keyboard.current = true;
      schedule();
    };
    document.addEventListener("pointerdown", pointerDown, true);
    window.addEventListener("pointerup", pointerUp, true);
    window.addEventListener("pointercancel", pointerUp, true);
    window.addEventListener("blur", pointerUp);
    document.addEventListener("keydown", keyDown, true);
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    window.addEventListener("resize", schedule);
    const stopScale = watchDevicePixelRatio(schedule);
    return () => {
      stopScale();
      cancelAnimationFrame(frame);
      mutations.disconnect();
      sizes.disconnect();
      document.removeEventListener("pointerdown", pointerDown, true);
      window.removeEventListener("pointerup", pointerUp, true);
      window.removeEventListener("pointercancel", pointerUp, true);
      window.removeEventListener("blur", pointerUp);
      document.removeEventListener("keydown", keyDown, true);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [owner, ready]);

  if (!snapshot || !props) return null;
  // Both viewports end at the window's bottom edge; align their tops.
  const offset = window.innerHeight - snapshot.viewportHeight;
  return (
    <OrchestrationWorkers.Provider value={workers}>
      <div
        className="personal-shell flex h-full text-content"
        data-sidebar-pinned="false"
        data-unified-toolbar
      >
        <div
          className="personal-shell-body"
          style={{
            position: "absolute",
            left: snapshot.body.x,
            top: snapshot.body.y + offset,
            width: snapshot.body.width,
            height: snapshot.body.height,
          }}
        >
          <Sidebar
            key={snapshot.generation}
            {...(props as unknown as SidebarProps)}
            {...proxies}
            open
            floating
          />
        </div>
        {addProjectAnchor ? (
          <AddProjectMenu
            anchor={addProjectAnchor}
            onDismiss={() => setAddProjectAnchor(null)}
            onAddExisting={() => chooseProject("addExistingProject")}
            onClone={() => chooseProject("cloneProject")}
            onCreate={() => chooseProject("createProject")}
          />
        ) : null}
      </div>
    </OrchestrationWorkers.Provider>
  );
}

async function runOverlaySmoke(owner: string) {
  const answer = (result: { ok: boolean; error?: string; note?: string }) =>
    void nativeFloatingSidebar
      .send(owner, SMOKE_OVERLAY_RESULT_EVENT, result)
      .catch(() => {});
  try {
    const settings = await waitFor(
      () =>
        document.querySelector<HTMLButtonElement>(
          '.personal-workspace-switcher button[aria-label^="Settings"]',
        ),
      10_000,
      "the Settings button",
    );
    const findBack = () =>
      [
        ...document.querySelectorAll<HTMLButtonElement>(".settings-nav button"),
      ].find((button) => button.textContent?.trim() === "Back");
    settings.click();
    let back = await waitFor(
      findBack,
      10_000,
      "Settings in the floating sidebar",
    ).catch(() => null);
    // A freshly built app's first launch once dropped this first click. Try
    // once more and say so, so a real problem still shows in the report.
    const retried = !back;
    if (!back) {
      settings.click();
      back = await waitFor(
        findBack,
        10_000,
        "Settings in the floating sidebar after a second click",
      );
    }
    // React hands this click event to the relayed callback; 0.1.137 froze
    // here, so Back gets no second try.
    back.click();
    await waitFor(
      () => !document.querySelector(".settings-nav"),
      10_000,
      "Back to close Settings",
    );
    answer({
      ok: true,
      ...(retried ? { note: "Settings opened on the second click" } : {}),
    });
  } catch (error) {
    answer({ ok: false, error: errorText(error) });
  }
}

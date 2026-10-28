import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  MoreHorizontal,
  Play,
  Smartphone,
  Stop,
} from "../chrome/icons";
import { ExplorerMenu, type ExplorerMenuItem } from "../chrome/ExplorerMenu";
import { refreshAgentBrowserScopes } from "../lib/agentBrowser";
import {
  createBrowserPresentation,
  type BrowserPresentation,
} from "../lib/browserPresentation";
import { errorText, logError } from "../lib/errors";
import { basename } from "../lib/fs";
import {
  IDLE_STATUS,
  appendLogs,
  basicPoint,
  deviceMenuGroups,
  iosSim,
  iosSimPlatform,
  iosSimPresentationAdapter,
  isDeviceStarting,
  isRunActive,
  listenIosSimLogs,
  listenIosSimStatus,
  listenIosSimView,
  loadIosSimChoice,
  loadIosSimSupport,
  pickDevice,
  pickScheme,
  saveIosSimChoice,
  statusTone,
  type IosSimDevice,
  type IosSimProject,
  type IosSimStatus,
  type IosSimSupport,
} from "../lib/iosSimulator";
import { projectKey } from "../lib/paths";
import {
  usePaneHeaderMenuHosted,
  useProvidePaneHeaderMenu,
} from "../hooks/usePaneHeader";
import "./IosSimulatorPane.css";

/**
 * Where the pickers and Run sit, so its pane has one header row. `slot`: a
 * workspace pane's title row lends them its row. `tools`: the iPhone is
 * its pane's only tab, so this toolbar is the pane's header row and ends
 * with the pane's own tools (`onDragStart` moves the pane by its empty
 * space). `menuId`: the workspace pane whose "…" lists Home, Lock, Rotate
 * and the screenshot while its title row hosts them; otherwise the toolbar
 * has its own "…".
 */
export type IosSimHeader = {
  slot?: HTMLElement | null;
  tools?: ReactNode;
  onDragStart?: (event: ReactPointerEvent<HTMLElement>) => void;
  menuId?: string;
};

type Props = {
  project: string;
  /** The tab is the one shown in its pane and the pane is on screen. */
  visible: boolean;
  onOpenFile: (path: string) => void;
  header?: IosSimHeader;
};

type Menu = "device" | "scheme" | "actions" | null;

/** A basic-mode frame: polled screenshot, in pixels. */
type Frame = { src: string; width: number; height: number };

const BASIC_FRAME_MS = 350;

/** "Could not rotate: The simulator is not running" */
function failed(label: string, error: unknown): string {
  const detail = errorText(error).trim();
  return detail ? `${label}: ${detail}` : label;
}

/**
 * The iPhone pane: a project's simulator beside its chat. Pick a device and
 * press Run to build, install and open the app; click, scroll and type on
 * the live screen. Agents in this chat use the same simulator.
 */
export function IosSimulatorPane({
  project,
  visible,
  onOpenFile,
  header,
}: Props) {
  const [support, setSupport] = useState<IosSimSupport | null>(null);
  const [devices, setDevices] = useState<IosSimDevice[]>([]);
  const [info, setInfo] = useState<IosSimProject | null>(null);
  const [udid, setUdid] = useState<string | null>(null);
  const [scheme, setScheme] = useState<string | null>(null);
  const [status, setStatus] = useState<IosSimStatus>(IDLE_STATUS);
  const [logs, setLogs] = useState<string[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [menu, setMenu] = useState<Menu>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Why the live view shows no screen yet (the device is still starting). */
  const [screenError, setScreenError] = useState<string | null>(null);
  const [keyboard, setKeyboard] = useState(false);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [backing, setBacking] = useState<string | null>(null);
  const [deviceReady, setDeviceReady] = useState(false);
  /** The person chose the shown device in the menu (not remembered or suggested). */
  const pickedRef = useRef(false);
  /** Reading the project takes long the first time packages resolve. */
  const [slowProject, setSlowProject] = useState(false);
  const [pickCount, setPickCount] = useState(0);
  const viewId = useMemo(
    () => `iphone-${crypto.randomUUID().replaceAll("-", "")}`,
    [],
  );
  const key = projectKey(project);
  const stage = useRef<HTMLDivElement | null>(null);
  const deviceButton = useRef<HTMLButtonElement | null>(null);
  const schemeButton = useRef<HTMLButtonElement | null>(null);
  const actionsButton = useRef<HTMLButtonElement | null>(null);
  const logList = useRef<HTMLPreElement | null>(null);
  const udidRef = useRef<string | null>(null);
  udidRef.current = udid;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const presentation = useRef<BrowserPresentation | null>(null);
  const platform = iosSimPlatform();
  const live = !!support?.live;
  const device = devices.find((d) => d.udid === udid) ?? null;
  const container = info?.container ?? null;

  const flash = useCallback((text: string) => {
    setNotice(text);
    window.setTimeout(
      () => setNotice((current) => (current === text ? null : current)),
      2500,
    );
  }, []);

  // Support, devices, the project's schemes and the current run.
  useEffect(() => {
    if (!platform) return;
    let cancelled = false;
    const choice = loadIosSimChoice(project);
    const slow = window.setTimeout(() => setSlowProject(true), 5000);
    void loadIosSimSupport()
      .then(async (found) => {
        if (cancelled) return;
        setSupport(found);
        if (!found.xcode) return;
        // The device starts and its screen goes live while Xcode reads the
        // project's schemes, which can take a while with Swift packages.
        const reading = iosSim.project(project, choice.container);
        reading.catch(() => {});
        const [list, current] = await Promise.all([
          iosSim.devices(),
          iosSim.state(project),
        ]);
        if (cancelled) return;
        setDevices(list.devices);
        setStatus(current.status);
        setLogs(current.logs);
        const picked = pickDevice(list.devices, choice.udid, list.suggested);
        setUdid(picked?.udid ?? null);
        const projectInfo = await reading;
        if (cancelled) return;
        window.clearTimeout(slow);
        setSlowProject(false);
        setInfo(projectInfo);
        setScheme(pickScheme(projectInfo.schemes, choice.scheme));
      })
      .catch((error) => {
        if (!cancelled) setNotice(failed("Could not reach Xcode", error));
      })
      .finally(() => window.clearTimeout(slow));
    return () => {
      cancelled = true;
      window.clearTimeout(slow);
    };
  }, [platform, project]);

  useEffect(() => {
    if (!platform) return;
    const subscriptions = [
      listenIosSimStatus((owner, next) => {
        if (projectKey(owner) !== key) return;
        setStatus(next);
        if (next.phase === "building") setLogs([]);
      }),
      listenIosSimLogs((owner, lines) => {
        if (projectKey(owner) === key)
          setLogs((previous) => appendLogs(previous, lines));
      }),
      listenIosSimView((event) => {
        if (event.view !== viewId) return;
        if (event.type === "focus") setKeyboard(!!event.focused);
        if (event.type === "screen")
          setScreenError(event.ok ? null : (event.error ?? "No screen yet"));
      }),
    ];
    return () => {
      for (const subscription of subscriptions)
        void subscription.then((stop) => stop()).catch(() => {});
    };
  }, [platform, key, viewId]);

  // Remember the choice; tell Aven (agents launch with it) and boot the
  // device, fixing its input once after a boot.
  useEffect(() => {
    if (!support?.xcode || !udid) return;
    saveIosSimChoice(project, {
      udid,
      ...(scheme ? { scheme } : {}),
      ...(container ? { container: container.path } : {}),
    });
    void iosSim
      .choose(project, {
        udid,
        scheme: scheme ?? undefined,
        container: container?.path,
      })
      .then(() => refreshAgentBrowserScopes())
      .catch((error) => logError("iPhone pane choice", error));
  }, [support, project, udid, scheme, container]);

  useEffect(() => {
    if (!support?.xcode || !udid) return;
    let cancelled = false;
    setDeviceReady(false);
    setScreenError(null);
    setFrame(null);
    const picked = pickedRef.current;
    pickedRef.current = false;
    void iosSim
      .useDevice(project, udid, picked)
      .then(async () => {
        if (cancelled) return;
        setDeviceReady(true);
        const list = await iosSim.devices();
        if (!cancelled) setDevices(list.devices);
      })
      .catch((error) => {
        if (!cancelled) setNotice(failed("Could not start the iPhone", error));
      });
    return () => {
      cancelled = true;
    };
  }, [support, project, udid, pickCount]);

  // Agents see this pane's simulator while it is open.
  useEffect(() => {
    void refreshAgentBrowserScopes();
    return () => void refreshAgentBrowserScopes();
  }, []);

  // The live view: a native layer over the stage, following it like a
  // browser page (menu cut-outs, hover sidebar, a still under dialogs).
  useEffect(() => {
    if (!live || !udid || !stage.current) return;
    const controller = createBrowserPresentation({
      surfaceId: viewId,
      pageId: viewId,
      element: stage.current,
      adapter: iosSimPresentationAdapter(() => udidRef.current),
      readState: () => ({
        visible: visibleRef.current,
        paused: false,
        nativeId: viewId,
        holesSupported: true,
        url: udidRef.current ?? "",
        navigation: 0,
        zoom: { factor: null, menu: null },
      }),
      onSnapshot: (captured) => setBacking(captured?.src ?? null),
      onNotice: (text) => logError("iPhone pane placement", text),
    });
    presentation.current = controller;
    controller.update();
    return () => {
      controller.dispose();
      presentation.current = null;
    };
  }, [live, udid, viewId]);

  useLayoutEffect(() => {
    if (!visible) setBacking(null);
    presentation.current?.update();
  }, [visible, logsOpen]);

  useEffect(
    () => () => {
      if (platform)
        void iosSim
          .close(viewId)
          .catch((error) => logError("Close iPhone pane", error));
    },
    [platform, viewId],
  );

  // Basic mode: screenshots polled while the pane is on screen.
  useEffect(() => {
    if (!support?.xcode || live || !udid || !deviceReady || !visible) return;
    let cancelled = false;
    const poll = async () => {
      while (!cancelled) {
        try {
          const next = await iosSim.basicFrame(udid);
          if (cancelled) return;
          setFrame({
            src: `data:image/png;base64,${next.png}`,
            width: next.width,
            height: next.height,
          });
        } catch {
          // The device may be restarting; try again.
        }
        await new Promise((resolve) => setTimeout(resolve, BASIC_FRAME_MS));
      }
    };
    void poll();
    return () => {
      cancelled = true;
    };
  }, [support, live, udid, deviceReady, visible]);

  useEffect(() => {
    if (logsOpen && logList.current)
      logList.current.scrollTop = logList.current.scrollHeight;
  }, [logs, logsOpen]);

  const active = isRunActive(status.phase);
  const starting = isDeviceStarting(status.phase);
  // Run may start while the device is still starting: it builds meanwhile.
  const canRun = !!udid && !!container && !!scheme;

  const run = () => {
    if (active) {
      void iosSim
        .stop(project)
        .catch((error) => flash(failed("Could not stop", error)));
      return;
    }
    if (!udid || !container || !scheme) return;
    void iosSim
      .run({ project, udid, container: container.path, scheme })
      .catch((error) => flash(failed("Could not run", error)));
  };

  const act = (label: string, action: () => Promise<void>) => {
    void action().catch((error) => flash(failed(label, error)));
  };

  const deviceItems = useMemo<ExplorerMenuItem[]>(() => {
    const items: ExplorerMenuItem[] = [];
    for (const group of deviceMenuGroups(devices)) {
      if (items.length) items.push({ kind: "sep" });
      for (const entry of group.devices)
        items.push({
          kind: "item",
          id: entry.udid,
          label: entry.name,
          description: entry.booted
            ? `${group.runtime} · Running`
            : group.runtime,
          checked: entry.udid === udid,
        });
    }
    return items;
  }, [devices, udid]);

  const schemeItems = useMemo<ExplorerMenuItem[]>(() => {
    const items: ExplorerMenuItem[] = (info?.schemes ?? []).map((name) => ({
      kind: "item",
      id: `scheme:${name}`,
      label: name,
      checked: name === scheme,
    }));
    if ((info?.containers.length ?? 0) > 1) {
      items.push({ kind: "sep" });
      for (const entry of info?.containers ?? [])
        items.push({
          kind: "item",
          id: `container:${entry.path}`,
          label: basename(entry.path),
          description: entry.kind === "workspace" ? "Workspace" : "Project",
          checked: entry.path === container?.path,
        });
    }
    return items;
  }, [info, scheme, container]);

  // Home, Lock, Rotate and the screenshot: in the pane's "…" (its title
  // row's, or the toolbar's own), so the pickers and Run stand alone.
  const deviceActions: ExplorerMenuItem[] = [
    {
      kind: "item",
      id: "home",
      label: "Home",
      disabled: !udid || !deviceReady,
    },
    ...(live
      ? [
          {
            kind: "item" as const,
            id: "lock",
            label: "Lock",
            disabled: !udid || !deviceReady,
          },
        ]
      : []),
    {
      kind: "item",
      id: "rotate",
      label: "Rotate",
      disabled: !udid || !deviceReady,
    },
    {
      kind: "item",
      id: "screenshot",
      label: "Copy a screenshot",
      disabled: !udid || !deviceReady,
    },
  ];
  const pickAction = (id: string) => {
    if (!udid || !deviceReady) return;
    if (id === "home")
      act("Could not press Home", () => iosSim.button(udid, "home"));
    else if (id === "lock")
      act("Could not press Lock", () => iosSim.button(udid, "lock"));
    else if (id === "rotate")
      act("Could not rotate", () => iosSim.rotate(udid));
    else if (id === "screenshot")
      act("Could not take a screenshot", async () => {
        await iosSim.screenshot(udid);
        flash("Screenshot copied");
      });
  };
  const menuId = visible ? header?.menuId : undefined;
  const actionsHosted = usePaneHeaderMenuHosted(menuId);
  useProvidePaneHeaderMenu(menuId, () => deviceActions, pickAction);

  const pickMenu = (id: string) => {
    setMenu(null);
    if (menu === "actions") {
      pickAction(id);
      return;
    }
    if (menu === "device") {
      pickedRef.current = true;
      // Picking the shown device again re-checks it (and can fix its input).
      if (id === udid) setPickCount((count) => count + 1);
      setUdid(id);
      return;
    }
    if (id.startsWith("scheme:")) setScheme(id.slice("scheme:".length));
    else if (id.startsWith("container:")) {
      const path = id.slice("container:".length);
      void iosSim
        .project(project, path)
        .then((next) => {
          setInfo(next);
          setScheme(pickScheme(next.schemes, scheme ?? undefined));
        })
        .catch((error) => flash(failed("Could not read schemes", error)));
    }
  };

  // Basic mode input: click to tap, drag to swipe, keys typed as text.
  const press = useRef<{ fx: number; fy: number } | null>(null);
  const basicPointAt = (event: ReactPointerEvent<HTMLElement>) => {
    if (!frame) return null;
    const box = event.currentTarget.getBoundingClientRect();
    return basicPoint(
      box,
      frame,
      event.clientX - box.left,
      event.clientY - box.top,
    );
  };
  const typed = useRef("");
  const typeTimer = useRef<number | null>(null);
  const onBasicKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (live || !udid || event.metaKey || event.ctrlKey) return;
    const text =
      event.key === "Enter"
        ? "\n"
        : event.key === "Tab"
          ? "\t"
          : event.key.length === 1
            ? event.key
            : "";
    if (!text) return;
    event.preventDefault();
    typed.current += text;
    if (typeTimer.current !== null) window.clearTimeout(typeTimer.current);
    typeTimer.current = window.setTimeout(() => {
      const value = typed.current;
      typed.current = "";
      typeTimer.current = null;
      act("Could not type", () =>
        iosSim.basicInput(project, udid, { kind: "type", text: value }),
      );
    }, 200);
  };

  if (!platform)
    return (
      <div className="ios-sim-pane ios-sim-empty">
        iPhone apps run on a Mac with Xcode.
      </div>
    );
  if (support && !support.xcode)
    return (
      <div className="ios-sim-pane ios-sim-empty">
        {support.reason ?? "Install Xcode to run iPhone apps"}
      </div>
    );

  const tone = statusTone(status.phase);
  const message =
    status.message ||
    (!info && slowProject
      ? "Resolving packages…"
      : udid && !deviceReady
        ? "Starting…"
        : udid
          ? "Ready"
          : "Pick a device");
  const showBasicFrame = !live && frame;

  const toolbar = (
    <div
      className="ios-sim-toolbar"
      data-in-slot={header?.slot ? true : undefined}
    >
      <button
        ref={deviceButton}
        type="button"
        className="ios-sim-chip"
        aria-haspopup="menu"
        aria-expanded={menu === "device"}
        disabled={!devices.length}
        onClick={() => setMenu(menu === "device" ? null : "device")}
      >
        <Smartphone className="size-3.5 shrink-0" />
        <span className="truncate">{device?.name ?? "No simulators"}</span>
        <ChevronDown className="size-3 shrink-0 opacity-60" />
      </button>
      {(info?.schemes.length ?? 0) > 1 || (info?.containers.length ?? 0) > 1 ? (
        <button
          ref={schemeButton}
          type="button"
          className="ios-sim-chip"
          aria-haspopup="menu"
          aria-expanded={menu === "scheme"}
          onClick={() => setMenu(menu === "scheme" ? null : "scheme")}
        >
          <span className="truncate">{scheme ?? "Scheme"}</span>
          <ChevronDown className="size-3 shrink-0 opacity-60" />
        </button>
      ) : null}
      <span
        className="flex-1 self-stretch"
        data-pane-drag={header?.onDragStart ? true : undefined}
        onPointerDown={(event) => {
          if (event.button !== 0 || !header?.onDragStart) return;
          event.preventDefault();
          header.onDragStart(event);
        }}
      />
      <button
        type="button"
        className="ios-sim-run"
        data-active={active || undefined}
        disabled={!active && !canRun}
        title={
          active
            ? "Stop"
            : info?.error && !container
              ? info.error
              : "Build and run on the simulator"
        }
        onClick={run}
      >
        {active ? <Stop className="size-3" /> : <Play className="size-3" />}
        {active ? "Stop" : "Run"}
      </button>
      {actionsHosted ? null : (
        <button
          ref={actionsButton}
          type="button"
          className="ios-sim-icon"
          title="iPhone actions"
          aria-label="iPhone actions"
          aria-haspopup="menu"
          aria-expanded={menu === "actions"}
          onClick={() => setMenu(menu === "actions" ? null : "actions")}
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      )}
      {header?.tools}
    </div>
  );
  return (
    <section className="ios-sim-pane" data-ios-sim={viewId}>
      {header?.slot ? createPortal(toolbar, header.slot) : toolbar}

      <div
        ref={stage}
        className="ios-sim-stage"
        data-keyboard={keyboard || undefined}
        tabIndex={live ? undefined : 0}
        onKeyDown={onBasicKey}
        onPointerDown={(event) => {
          if (live) return;
          press.current = basicPointAt(event);
        }}
        onPointerUp={(event) => {
          const from = press.current;
          press.current = null;
          const to = basicPointAt(event);
          if (live || !from || !to || !udid) return;
          // A press that moved more than 2% of the screen is a swipe.
          const moved = Math.hypot(to.fx - from.fx, to.fy - from.fy) > 0.02;
          act("Could not reach the simulator", () =>
            iosSim.basicInput(
              project,
              udid,
              moved
                ? {
                    kind: "swipe",
                    fx1: from.fx,
                    fy1: from.fy,
                    fx2: to.fx,
                    fy2: to.fy,
                  }
                : { kind: "tap", fx: to.fx, fy: to.fy },
            ),
          );
        }}
      >
        {showBasicFrame ? (
          <img
            className="ios-sim-frame"
            src={frame.src}
            alt={device ? `${device.name} screen` : "Simulator screen"}
            draggable={false}
          />
        ) : backing ? (
          <img className="ios-sim-frame" src={backing} alt="" />
        ) : null}
        {!udid ? (
          <p className="ios-sim-placeholder">
            {devices.length
              ? "Pick a device to start it"
              : "No iPhone or iPad simulators. Add one in Xcode."}
          </p>
        ) : !deviceReady || starting || (!live && !frame) ? (
          <p className="ios-sim-placeholder">{status.message || "Starting…"}</p>
        ) : live && screenError ? (
          <p className="ios-sim-placeholder">{screenError}</p>
        ) : null}
      </div>

      <div className="ios-sim-strip" data-tone={tone}>
        <span className="ios-sim-dot" aria-hidden />
        <span className="min-w-0 truncate" role="status">
          {notice ?? message}
        </span>
        {status.phase === "failed" && status.logPath ? (
          <button
            type="button"
            className="ios-sim-link"
            onClick={() => status.logPath && onOpenFile(status.logPath)}
          >
            Show errors
          </button>
        ) : null}
        {!live && support ? (
          <span className="ios-sim-basic" title={support.reason ?? undefined}>
            Basic mode
          </span>
        ) : null}
        <span className="flex-1" />
        <button
          type="button"
          className="ios-sim-link"
          aria-expanded={logsOpen}
          onClick={() => setLogsOpen((open) => !open)}
        >
          Logs
          <ChevronDown
            className="size-3"
            style={logsOpen ? { transform: "rotate(180deg)" } : undefined}
          />
        </button>
      </div>
      {logsOpen ? (
        <pre ref={logList} className="ios-sim-logs" aria-label="App console">
          {logs.length
            ? logs.join("\n")
            : status.bundleId
              ? "No output yet."
              : "Press Run to see the app's console here."}
        </pre>
      ) : null}

      {menu ? (
        <ExplorerMenu
          // The pickers' lists are native panels; the actions menu is a page
          // menu like its pane's "…" (the screen holds still behind it), so
          // checks can press its items.
          native={menu !== "actions"}
          x={0}
          y={0}
          anchor={
            menu === "device"
              ? deviceButton
              : menu === "actions"
                ? actionsButton
                : schemeButton
          }
          align={menu === "actions" ? "end" : "start"}
          gap={4}
          width={menu === "device" ? 280 : menu === "actions" ? 200 : 240}
          ariaLabel={
            menu === "device"
              ? "Simulators"
              : menu === "actions"
                ? "iPhone actions"
                : "Schemes"
          }
          items={
            menu === "device"
              ? deviceItems
              : menu === "actions"
                ? deviceActions
                : schemeItems
          }
          onPick={pickMenu}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </section>
  );
}

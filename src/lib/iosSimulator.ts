import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { browserBounds, type BrowserBounds } from "./browser";
import type { BrowserPresentationAdapter } from "./browserPresentation";
import { projectKey } from "./paths";
import { IS_MAC } from "./platform";

/** Whether Xcode is installed and the native live view works. */
export type IosSimSupport = {
  xcode: boolean;
  /** False: basic mode (polled screenshots, XCUITest input). */
  live: boolean;
  developerDir: string | null;
  reason: string | null;
};

export type IosSimDevice = {
  udid: string;
  name: string;
  family: "iphone" | "ipad";
  runtime: string;
  booted: boolean;
  state: string;
};

export type IosSimContainer = { kind: "workspace" | "project"; path: string };

export type IosSimProject = {
  containers: IosSimContainer[];
  container: IosSimContainer | null;
  schemes: string[];
  error: string | null;
};

export type IosSimPhase =
  | "idle"
  | "booting"
  | "preparing"
  | "building"
  | "installing"
  | "launching"
  | "running"
  | "failed"
  | "stopped";

export type IosSimBuildIssue = {
  file: string | null;
  line: number | null;
  column: number | null;
  message: string;
  logLine: number;
};

export type IosSimStatus = {
  phase: IosSimPhase;
  message: string;
  udid: string | null;
  bundleId: string | null;
  builtMs: number | null;
  errors: IosSimBuildIssue[];
  logPath: string | null;
};

export const IDLE_STATUS: IosSimStatus = {
  phase: "idle",
  message: "",
  udid: null,
  bundleId: null,
  builtMs: null,
  errors: [],
  logPath: null,
};

/** A phase that Run's button turns into Stop for. */
export function isRunActive(phase: IosSimPhase): boolean {
  return (
    phase === "building" ||
    phase === "installing" ||
    phase === "launching" ||
    phase === "running"
  );
}

/** Getting a device ready, before any build. */
export function isDeviceStarting(phase: IosSimPhase): boolean {
  return phase === "booting" || phase === "preparing";
}

/** The strip's dot: green running, amber working, red failed. */
export function statusTone(
  phase: IosSimPhase,
): "running" | "busy" | "failed" | "idle" {
  if (phase === "running") return "running";
  if (phase === "failed") return "failed";
  if (phase === "idle" || phase === "stopped") return "idle";
  return "busy";
}

/** The iPhone pane exists only in the macOS app. */
export function iosSimPlatform(): boolean {
  return IS_MAC && isTauri();
}

let supportRequest: Promise<IosSimSupport> | null = null;
let supportAt = 0;
/** Asked again after this, so a newly installed or selected Xcode shows. */
const SUPPORT_REFRESH_MS = 30_000;

/** Xcode and live-view support. */
export function loadIosSimSupport(): Promise<IosSimSupport> {
  if (!iosSimPlatform())
    return Promise.resolve({
      xcode: false,
      live: false,
      developerDir: null,
      reason: null,
    });
  if (!supportRequest || Date.now() - supportAt > SUPPORT_REFRESH_MS) {
    supportAt = Date.now();
    supportRequest = invoke<IosSimSupport>("ios_sim_support").then(
      (support) => {
        // Xcode may be installed later; ask again next time.
        if (!support.xcode) supportRequest = null;
        return support;
      },
      (error) => {
        supportRequest = null;
        throw error;
      },
    );
  }
  return supportRequest;
}

const projectChecks = new Map<string, Promise<boolean>>();

/** Whether a project folder holds an Xcode project (cached per launch). */
export function hasXcodeProject(project: string): Promise<boolean> {
  if (!iosSimPlatform() || !project) return Promise.resolve(false);
  const key = projectKey(project);
  let check = projectChecks.get(key);
  if (!check) {
    check = invoke<boolean>("ios_sim_has_project", { project }).catch(
      () => false,
    );
    projectChecks.set(key, check);
  }
  return check;
}

export function forgetXcodeProjectCheck(project: string) {
  projectChecks.delete(projectKey(project));
}

// ---------------------------------------------------------------------------
// What each project's pane chose: device, container and scheme.

const CHOICES_KEY = "aven.iosSimulator.v1";

export type IosSimChoice = {
  udid?: string;
  container?: string;
  scheme?: string;
};

function readChoices(): Record<string, IosSimChoice> {
  try {
    const raw = localStorage.getItem(CHOICES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, IosSimChoice>)
      : {};
  } catch {
    return {};
  }
}

function writeChoices(choices: Record<string, IosSimChoice>) {
  try {
    localStorage.setItem(CHOICES_KEY, JSON.stringify(choices));
  } catch {
    // private mode / quota
  }
}

function cleanChoice(value: unknown): IosSimChoice {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const text = (key: string) =>
    typeof record[key] === "string" && (record[key] as string).length <= 4096
      ? (record[key] as string)
      : undefined;
  return {
    ...(text("udid") ? { udid: text("udid") } : {}),
    ...(text("container") ? { container: text("container") } : {}),
    ...(text("scheme") ? { scheme: text("scheme") } : {}),
  };
}

export function loadIosSimChoice(project: string): IosSimChoice {
  return cleanChoice(readChoices()[projectKey(project)]);
}

export function saveIosSimChoice(project: string, patch: IosSimChoice) {
  const choices = readChoices();
  const key = projectKey(project);
  choices[key] = { ...cleanChoice(choices[key]), ...patch };
  writeChoices(choices);
}

/** Forgets a removed project's choices and build files. */
export async function clearIosSimProject(project: string): Promise<void> {
  const choices = readChoices();
  delete choices[projectKey(project)];
  writeChoices(choices);
  forgetXcodeProjectCheck(project);
  if (iosSimPlatform()) await invoke("ios_sim_forget_project", { project });
}

/**
 * The device the pane opens on: the project's remembered one if it still
 * exists, else Aven's suggestion (a running simulator before starting
 * another one), else none and the person picks.
 */
export function pickDevice(
  devices: readonly IosSimDevice[],
  remembered: string | undefined,
  suggested: string | null,
): IosSimDevice | null {
  const match = (udid: string | null | undefined) =>
    udid
      ? devices.find((d) => d.udid.toLowerCase() === udid.toLowerCase())
      : undefined;
  return match(remembered) ?? match(suggested) ?? null;
}

/** The scheme to build: the remembered one if the project still has it. */
export function pickScheme(
  schemes: readonly string[],
  remembered: string | undefined,
): string | null {
  return remembered && schemes.includes(remembered)
    ? remembered
    : (schemes[0] ?? null);
}

/** Devices grouped under their runtime for the picker. */
export function deviceMenuGroups(
  devices: readonly IosSimDevice[],
): { runtime: string; devices: IosSimDevice[] }[] {
  const groups: { runtime: string; devices: IosSimDevice[] }[] = [];
  for (const device of devices) {
    const group = groups.find((g) => g.runtime === device.runtime);
    if (group) group.devices.push(device);
    else groups.push({ runtime: device.runtime, devices: [device] });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Commands

export const iosSim = {
  devices: () =>
    invoke<{ devices: IosSimDevice[]; suggested: string | null }>(
      "ios_sim_devices",
    ),
  project: (project: string, container?: string) =>
    invoke<IosSimProject>("ios_sim_project", {
      project,
      container: container ?? null,
    }),
  /** `picked`: the person chose it in the menu just now. */
  useDevice: (project: string, udid: string, picked: boolean) =>
    invoke<void>("ios_sim_use_device", { project, udid, picked }),
  choose: (project: string, choice: IosSimChoice) =>
    invoke<void>("ios_sim_pane_choice", {
      project,
      choice: {
        udid: choice.udid ?? null,
        container: choice.container ?? null,
        scheme: choice.scheme ?? null,
      },
    }),
  run: (request: {
    project: string;
    udid: string;
    container: string;
    scheme: string;
  }) => invoke<void>("ios_sim_run", { request }),
  stop: (project: string) => invoke<void>("ios_sim_stop", { project }),
  state: (project: string) =>
    invoke<{ status: IosSimStatus; logs: string[] }>("ios_sim_state", {
      project,
    }),
  button: (udid: string, button: "home" | "lock") =>
    invoke<void>("ios_sim_button", { udid, button }),
  rotate: (udid: string) => invoke<void>("ios_sim_rotate", { udid }),
  screenshot: (udid: string) => invoke<void>("ios_sim_screenshot", { udid }),
  basicFrame: (udid: string) =>
    invoke<{ png: string; width: number; height: number }>(
      "ios_sim_basic_frame",
      { udid },
    ),
  /** Basic-mode input in fractions (0 to 1) of the upright screenshot. */
  basicInput: (
    project: string,
    udid: string,
    input:
      | { kind: "tap"; fx: number; fy: number }
      | { kind: "swipe"; fx1: number; fy1: number; fx2: number; fy2: number }
      | { kind: "type"; text: string },
  ) => invoke<void>("ios_sim_basic_input", { project, udid, input }),
  focus: (id: string) => invoke<boolean>("ios_sim_view_focus", { id }),
  close: (id: string) => invoke<void>("ios_sim_view_close", { id }),
};

export function listenIosSimStatus(
  callback: (project: string, status: IosSimStatus) => void,
): Promise<() => void> {
  return listen<{ project: string; status: IosSimStatus }>(
    "ios-sim-status",
    (event) => callback(event.payload.project, event.payload.status),
  );
}

export function listenIosSimLogs(
  callback: (project: string, lines: string[]) => void,
): Promise<() => void> {
  return listen<{ project: string; lines: string[] }>("ios-sim-log", (event) =>
    callback(event.payload.project, event.payload.lines),
  );
}

/** Native view events: keyboard focus, screen and orientation changes. */
export type IosSimViewEvent = {
  type: "focus" | "screen" | "orientation";
  view: string;
  focused?: boolean;
  ok?: boolean;
  error?: string;
  orientation?: number;
};

export function listenIosSimView(
  callback: (event: IosSimViewEvent) => void,
): Promise<() => void> {
  return listen<IosSimViewEvent>("ios-sim-view", (event) =>
    callback(event.payload),
  );
}

/** Console lines kept in the pane. */
export const PANE_LOG_LINES = 1000;

export function appendLogs(
  previous: readonly string[],
  lines: readonly string[],
): string[] {
  const next = [...previous, ...lines];
  return next.length > PANE_LOG_LINES
    ? next.slice(next.length - PANE_LOG_LINES)
    : next;
}

/**
 * Placement for the shared native-view presentation (`browserPresentation`):
 * the live view follows the pane's stage with menu cut-outs and the hover
 * sidebar's edge, and a still frame stands in under modal dialogs.
 */
export function iosSimPresentationAdapter(
  device: () => string | null,
): BrowserPresentationAdapter {
  return {
    bounds: browserBounds,
    layout: (id: string, bounds: BrowserBounds, visible: boolean) =>
      invoke<void>("ios_sim_view_layout", {
        id,
        udid: device(),
        bounds,
        visible,
      }),
    snapshot: async () => {
      const udid = device();
      if (!udid) throw new Error("No simulator");
      const frame = await iosSim.basicFrame(udid);
      return `data:image/png;base64,${frame.png}`;
    },
    decode: async (src) => {
      const image = new Image();
      image.src = src;
      await image.decode();
    },
    onFocusChanged: (callback) => getCurrentWindow().onFocusChanged(callback),
  };
}

/**
 * A click on a basic-mode screenshot as fractions (0 to 1) of the upright
 * screen: the picture is drawn aspect-fit (`object-fit: contain`) in `box`.
 * Aven turns them into points with the screen size its agent reports, so no
 * screen scale is assumed here.
 */
export function basicPoint(
  box: { width: number; height: number },
  image: { width: number; height: number },
  clientX: number,
  clientY: number,
): { fx: number; fy: number } | null {
  if (
    box.width <= 0 ||
    box.height <= 0 ||
    image.width <= 0 ||
    image.height <= 0
  )
    return null;
  const fit = Math.min(box.width / image.width, box.height / image.height);
  const width = image.width * fit;
  const height = image.height * fit;
  const left = (box.width - width) / 2;
  const top = (box.height - height) / 2;
  const fx = (clientX - left) / width;
  const fy = (clientY - top) / height;
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
  return { fx, fy };
}

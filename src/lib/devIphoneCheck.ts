import { invoke } from "@tauri-apps/api/core";
import {
  finishDevSmoke,
  waitFor,
  type DevSmokeConfig,
  type SmokeStep,
} from "./devSmoke";
import { errorText } from "./errors";
import { resolveClaudeBinary } from "./harness/child";
import { loadIosSimSupport, saveIosSimChoice } from "./iosSimulator";
import { sameProjectPath } from "./recents";
import type { Session } from "./session";

/**
 * Aven Dev's iPhone check (`scripts/dev-aven.py --iphone`): drives the real
 * iPhone pane on a throwaway simulator in a throwaway profile. Clicks and
 * keys reach the pane's native view through debug-only hooks (its own hit
 * test and handlers, never system input); results are read back through
 * Aven's XCUITest agent. Last, the stand-in agent in the chat uses the
 * simulator through `--aven-simulator`.
 */
export type IphoneCheckOptions = {
  sessions: Session[];
  newProjectTask: (path: string) => void;
  submit: (sessionId: string, text: string) => void;
};

/** In the message: the stand-in uses the simulator and reports. */
const IPHONE_WORD = "AVEN_SMOKE_IPHONE";
const IPHONE_REPLY = "AVEN_IPHONE_OK";
const IPHONE_FAILED = "AVEN_IPHONE_FAILED";
/** NSEvent's Option modifier. */
const OPTION = 1 << 19;

type SnapshotNode = {
  type: string;
  id?: string;
  label?: string;
  value?: string;
  frame: [number, number, number, number];
};

async function poll<T>(
  read: () => Promise<T | null | undefined | false>,
  timeoutMs: number,
  what: string,
): Promise<T> {
  const started = Date.now();
  let last: unknown = null;
  for (;;) {
    try {
      const value = await read();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    if (Date.now() - started > timeoutMs)
      throw new Error(
        `Timed out waiting for ${what}${last ? `: ${errorText(last)}` : ""}`,
      );
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

const strip = () =>
  document.querySelector<HTMLElement>(".ios-sim-strip [role=status]")
    ?.textContent ?? "";

function button(selector: string): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(selector);
  if (!found) throw new Error(`No ${selector}`);
  if (found.disabled) throw new Error(`${selector} is disabled`);
  return found;
}

/**
 * Presses one of the iPhone's actions (Home, Lock, Rotate, Copy a
 * screenshot). They sit in a "…": the iPhone toolbar's own, or its
 * workspace pane's when the pane's title row lists them.
 */
async function iphoneAction(label: string): Promise<void> {
  const toolbar = document.querySelector<HTMLElement>(".ios-sim-toolbar");
  const own = document.querySelector<HTMLButtonElement>(
    'button[aria-label="iPhone actions"]',
  );
  const surface = document
    .querySelector<HTMLElement>("[data-ios-sim]")
    ?.closest<HTMLElement>("[data-workspace-surface]")
    ?.dataset.workspaceSurface;
  const titleRow =
    toolbar?.closest<HTMLElement>(".personal-titlebar") ??
    (surface
      ? document.querySelector<HTMLElement>(
          `[data-workspace-header="${surface}"]`,
        )
      : null);
  const opener =
    own ??
    titleRow?.querySelector<HTMLButtonElement>(
      '.aven-pane-tool[aria-label="More actions"]',
    );
  if (!opener) throw new Error("No menu with the iPhone's actions");
  opener.click();
  const item = await waitFor(
    () =>
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (entry) => entry.textContent?.trim() === label,
      ),
    5_000,
    `${label} in the iPhone's actions`,
  );
  item.click();
}

export async function runDevIphoneCheck(
  config: DevSmokeConfig,
  get: () => IphoneCheckOptions,
): Promise<void> {
  const steps: SmokeStep[] = [];
  const step = async (
    name: string,
    body: () => Promise<string | void>,
  ): Promise<boolean> => {
    try {
      const detail = await body();
      steps.push({ name, passed: true, ...(detail ? { detail } : {}) });
      return true;
    } catch (error) {
      steps.push({ name, passed: false, detail: errorText(error) });
      return false;
    }
  };
  const udid = config.iphone?.udid ?? "";
  const project = config.projectPath;
  let bundle: string | null = null;
  let viewId = "";
  const snapshot = async (app: string | null = bundle) =>
    (
      await invoke<{ nodes: SnapshotNode[] }>("ios_sim_dev_snapshot", {
        udid,
        bundleId: app,
      })
    ).nodes;
  const node = (nodes: SnapshotNode[], id: string) =>
    nodes.find((entry) => entry.id === id);
  const label = async (id: string) => node(await snapshot(), id)?.label ?? "";
  const centre = (found: SnapshotNode | undefined) => {
    if (!found) throw new Error("The element is not on screen");
    const [x, y, w, h] = found.frame;
    return { x: x + w / 2, y: y + h / 2 };
  };
  const click = async (point: { x: number; y: number }) =>
    invoke("ios_sim_dev_click", { id: viewId, ...point });
  const shot = (name: string) =>
    invoke<string>("ios_sim_dev_shot", { udid, name }).catch(() => "");
  const finish = () =>
    finishDevSmoke(steps, { iphone: { udid, viewId, bundle } });

  const safe = await step(
    "stand-in provider is the one Aven found",
    async () => {
      const { path } = await resolveClaudeBinary();
      if (!path.startsWith(`${config.binDir}/`))
        throw new Error(`Claude resolved to ${path}, not the stand-in`);
      return path;
    },
  );
  const ready = await step(
    "Xcode is installed and the live view loads",
    async () => {
      if (!udid) throw new Error("The runner named no simulator");
      const support = await loadIosSimSupport();
      if (!support.xcode) throw new Error(support.reason ?? "No Xcode");
      if (!support.live) throw new Error(`Basic mode: ${support.reason}`);
      return support.developerDir ?? "";
    },
  );
  if (!safe || !ready) return finish();

  // The pane opens on the throwaway device, never one of the person's.
  saveIosSimChoice(project, { udid });
  let sessionId = "";
  await step("a chat in the Xcode project", async () => {
    get().newProjectTask(project);
    const task = await waitFor(
      () =>
        get().sessions.find(
          (session) =>
            session.harness === "claude" &&
            sameProjectPath(session.cwd, project),
        ),
      10_000,
      "a Claude chat in the sample project",
    );
    sessionId = task.id;
  });
  const opened = await step(
    "the iPhone button opens the pane beside the chat",
    async () => {
      const open = await waitFor(
        () =>
          document.querySelector<HTMLButtonElement>(
            'button[aria-label="iPhone"]',
          ),
        30_000,
        "the iPhone button",
      );
      open.click();
      const pane = await waitFor(
        () => document.querySelector<HTMLElement>("[data-ios-sim]"),
        10_000,
        "the iPhone pane",
      );
      viewId = pane.dataset.iosSim ?? "";
      return viewId;
    },
  );
  if (!opened) return finish();

  await step(
    "the throwaway iPhone starts, its input is fixed and its screen goes live",
    async () => {
      const started = Date.now();
      await waitFor(
        () => strip() === "Ready",
        300_000,
        'the strip to read "Ready"',
      );
      await waitFor(
        () => !document.querySelector(".ios-sim-placeholder"),
        30_000,
        "the live screen",
      );
      await shot("1-ready");
      return `${Math.round((Date.now() - started) / 1000)} s`;
    },
  );

  const ran = await step("Run builds, installs and opens the app", async () => {
    const started = Date.now();
    button(".ios-sim-run").click();
    await waitFor(() => strip().startsWith("Building"), 10_000, "Building…");
    await waitFor(
      () => strip().startsWith("Running") || strip().startsWith("Build failed"),
      600_000,
      "the run",
    );
    if (!strip().startsWith("Running")) throw new Error(strip());
    if (button(".ios-sim-run").textContent?.trim() !== "Stop")
      throw new Error("Run did not become Stop");
    bundle = "com.capi.aven.simspike";
    return `${strip()} (${Math.round((Date.now() - started) / 1000)} s)`;
  });
  if (!ran) return finish();

  await step("the app's console shows under Logs", async () => {
    button(".ios-sim-strip button[aria-expanded]").click();
    await waitFor(
      () =>
        document
          .querySelector(".ios-sim-logs")
          ?.textContent?.includes("SPIKE launched"),
      30_000,
      "the app's first line",
    );
  });

  await step("a click on the live screen taps the app's button", async () => {
    const nodes = await poll(
      async () => {
        const found = await snapshot();
        return node(found, "tapButton") ? found : null;
      },
      120_000,
      "the app's accessibility tree",
    );
    await click(centre(node(nodes, "tapButton")));
    await poll(
      async () => (await label("tapCount")) === "Taps: 1",
      10_000,
      '"Taps: 1"',
    );
    await shot("2-tapped");
  });

  await step(
    "keys typed in the live screen reach the focused field",
    async () => {
      await click(centre(node(await snapshot(), "textField")));
      await new Promise((resolve) => setTimeout(resolve, 800));
      // h, i, then Option-E and E: iOS composes the accent itself.
      await invoke("ios_sim_dev_keys", {
        id: viewId,
        keys: [
          { code: 4, text: "h" },
          { code: 34, text: "i" },
          { code: 14, text: "", modifiers: OPTION },
          { code: 14, text: "é" },
        ],
      });
      const echo = await poll(
        async () => {
          const text = await label("echo");
          return /^Echo: hié$/i.test(text) ? text : null;
        },
        10_000,
        '"Echo: hié"',
      );
      await shot("3-typed");
      return echo;
    },
  );

  await step(
    "the live view keeps up with an animation in the app",
    async () => {
      const frames = () =>
        invoke<{ drawn: number; shown: number; visible: boolean }>(
          "ios_sim_dev_frames",
          { id: viewId },
        );
      // The sample app's toggle starts and stops a spinning square.
      const toggle = node(await snapshot(), "animate");
      if (!toggle) throw new Error("The app has no animation toggle");
      const [x, y, w, h] = toggle.frame;
      const knob = { x: x + w - 30, y: y + h / 2 };
      await click(knob);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const first = await frames();
      const started = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const last = await frames();
      const seconds = (Date.now() - started) / 1000;
      await click(knob);
      const drawn = (last.drawn - first.drawn) / seconds;
      const shown = (last.shown - first.shown) / seconds;
      const rates = `${shown.toFixed(1)} frames/s shown of ${drawn.toFixed(1)} drawn`;
      // A covered window shows no frames by design.
      if (!first.visible || !last.visible) return `window covered; ${rates}`;
      if (drawn < 10) throw new Error(`The animation did not run: ${rates}`);
      if (shown < drawn * 0.5) throw new Error(`Frames were dropped: ${rates}`);
      return rates;
    },
  );

  await step("Rotate turns the screen and taps follow it", async () => {
    await iphoneAction("Rotate");
    await poll(
      async () => {
        const screen = await invoke<{ width: number; height: number }>(
          "ios_sim_dev_screen",
          { udid },
        );
        return screen.width > screen.height;
      },
      15_000,
      "landscape",
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const before = await label("tapCount");
    await click(centre(node(await snapshot(), "tapButton")));
    await poll(
      async () => (await label("tapCount")) === "Taps: 2",
      10_000,
      `"Taps: 2" (was "${before}")`,
    );
    await shot("4-landscape");
    await iphoneAction("Rotate");
    await poll(
      async () => {
        const screen = await invoke<{ width: number; height: number }>(
          "ios_sim_dev_screen",
          { udid },
        );
        return screen.width < screen.height;
      },
      15_000,
      "portrait again",
    );
  });

  await step("Home leaves the app for the home screen", async () => {
    await iphoneAction("Home");
    await poll(
      async () =>
        (await snapshot(null)).some((entry) => entry.label === "SpikeApp"),
      10_000,
      "the home screen's SpikeApp icon",
    );
    await shot("5-home");
  });

  await step(
    "an agent in the chat uses the simulator through --aven-simulator",
    async () => {
      get().submit(sessionId, `Check the app on the iPhone. ${IPHONE_WORD}`);
      const reply = await waitFor(
        () => {
          const current = get().sessions.find((s) => s.id === sessionId);
          const text = current?.blocks
            .filter((block) => block.role === "assistant")
            .map((block) => block.text)
            .find(
              (text) =>
                text.includes(IPHONE_REPLY) || text.includes(IPHONE_FAILED),
            );
          return current && !current.busy && text;
        },
        600_000,
        "the stand-in's report",
      );
      if (!reply.includes(IPHONE_REPLY)) throw new Error(reply);
      const report = JSON.parse(
        reply.slice(reply.indexOf(IPHONE_REPLY) + IPHONE_REPLY.length),
      ) as {
        guidance: boolean;
        devices: number;
        launch: string;
        tapsBefore: number;
        tapsAfter: number;
        screenshot: string;
        strangerRefused: boolean;
      };
      const problems = [
        !report.guidance && "no <aven-iphone> guidance in the turn",
        report.devices !== 1 && `${report.devices} devices in scope`,
        report.launch !== "running" && `launch: ${report.launch}`,
        report.tapsAfter !== report.tapsBefore + 1 &&
          `taps ${report.tapsBefore} → ${report.tapsAfter}`,
        !report.screenshot?.endsWith(".jpg") &&
          `screenshot: ${report.screenshot}`,
        !report.strangerRefused && "another simulator was not refused",
      ].filter(Boolean);
      if (problems.length) throw new Error(problems.join("; "));
      await shot("6-agent");
      return JSON.stringify(report);
    },
  );

  await step("Stop ends the app", async () => {
    button(".ios-sim-run").click();
    await waitFor(() => strip() === "Stopped", 20_000, '"Stopped"');
  });

  return finish();
}

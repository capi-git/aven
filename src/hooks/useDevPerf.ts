import { invoke } from "@tauri-apps/api/core";
import {
  finishDevSmoke,
  SMOKE_REPLY,
  waitFor,
  type DevSmokeConfig,
  type SmokeStep,
} from "../lib/devSmoke";
import {
  analyzeRestyle,
  heapMB,
  measureRefresh,
  nextPaint,
  pause,
  processUse,
  recordFrames,
  recordHotCalls,
  recordLongTasks,
  round,
  sampleProcesses,
  spread,
  type FrameStats,
  type HotCalls,
  type LongTaskStats,
  type ProcessUse,
  type Spread,
} from "../lib/devPerf";
import {
  reactMarksSince,
  startReactProfile,
  stopReactProfile,
  type ReactProfile,
} from "../lib/devPerfReact";
import { readLaunchReveal } from "../lib/devSmokeReveal";
import { errorText } from "../lib/errors";
import { resolveClaudeBinary } from "../lib/harness/child";
import { IS_MAC } from "../lib/platform";
import { sameProjectPath } from "../lib/recents";
import type { Session } from "../lib/session";

/** What the speed test needs from the workspace; see `useDevSmoke`. */
export type DevPerfOptions = {
  sessions: Session[];
  newProjectTask: (path: string) => void;
  submit: (sessionId: string, text: string) => void;
  /** The focused surface (chat, browser or file tab). */
  focusedSurfaceId?: string;
  sidebarOpen?: boolean;
  openWebLink?: (url: string) => void | Promise<void>;
};

type PerfSettings = {
  /** A local page for the browser scenarios. */
  pageUrl?: string;
  /** Chunks in a long streamed reply (about 12 ms each). */
  streamChunks?: number;
  /** Seconds of idle to measure. */
  idleSeconds?: number;
  /** Run only scenarios whose names contain one of these (setup always runs). */
  only?: string[];
  /** Profile the interface process during the scenario whose name contains this. */
  sample?: string;
};

export type ScenarioResult = {
  name: string;
  wallMs: number;
  /** Input to the next painted frame, ms. */
  interactions?: Spread;
  /**
   * Where that time went, for changes that land in the input's own task:
   * script (React render, commit and effects), style and layout, and the
   * rest of the frame (paint, compositing, waiting for the display).
   */
  breakdown?: {
    script: Spread;
    styleLayout: Spread;
    frame: Spread;
    /** Input to the last React commit (render, DOM changes, layout effects). */
    toLastCommit: Spread;
    /** React passive effects (useEffect) run before paint for this input. */
    passiveEffects: Spread;
  };
  /** React render time by component (profiling build). */
  react?: ReactProfile;
  /** Forced layout, JSON and storage time during the scenario. */
  hotCalls?: HotCalls;
  frames?: FrameStats;
  longTasks: LongTaskStats;
  processes: ProcessUse;
  heapMB?: number;
  visible: boolean;
  focused: boolean;
  /** Time the page was hidden during the scenario; timings are unreliable then. */
  hiddenMs: number;
  error?: string;
};

type Measure = {
  /** Time `action` until `until` holds and the next frame is drawn. */
  time: (
    action: () => unknown,
    until?: () => unknown,
    timeoutMs?: number,
  ) => Promise<number>;
};

function pressShortcut(key: string, shift = false) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      metaKey: IS_MAC,
      ctrlKey: !IS_MAC,
      shiftKey: shift,
      bubbles: true,
      cancelable: true,
    }),
  );
}

/** Wait, a frame at a time, until `condition` holds. */
async function untilPainted(condition: () => unknown, timeoutMs: number) {
  const started = performance.now();
  while (!condition()) {
    if (performance.now() - started > timeoutMs)
      throw new Error("Timed out waiting for the change to show");
    await nextPaint();
  }
}

/** Hidden tabs keep their layout, so a size alone does not mean on screen. */
export function visibleComposer(): HTMLTextAreaElement | null {
  return (
    [
      ...document.querySelectorAll<HTMLTextAreaElement>(
        "[data-composer] textarea",
      ),
    ].find(
      (element) =>
        element.getClientRects().length > 0 &&
        getComputedStyle(element).visibility === "visible",
    ) ?? null
  );
}

function typeCharacter(target: HTMLTextAreaElement, character: string) {
  const before = target.value;
  if (document.activeElement !== target) target.focus();
  document.execCommand("insertText", false, character);
  if (target.value !== before) return;
  // Fall back to what a paste-like input would do.
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(target, before + character);
  target.dispatchEvent(
    new InputEvent("input", { bubbles: true, data: character }),
  );
}

function clearComposer(target: HTMLTextAreaElement) {
  target.focus();
  target.select();
  document.execCommand("delete");
  if (target.value) {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set?.call(target, "");
    target.dispatchEvent(new InputEvent("input", { bubbles: true }));
  }
}

/**
 * Aven Dev's speed test. Drives the real workspace through what people do
 * all day — chats streaming, typing, switching tabs, the sidebar, Settings,
 * the browser, sitting idle — and records time to the next frame, frame
 * pacing, long main-thread tasks, CPU, wakeups and memory for each.
 */
export async function runDevPerf(
  config: DevSmokeConfig,
  get: () => DevPerfOptions,
): Promise<void> {
  const settings = (config.perf ?? {}) as PerfSettings;
  const streamChunks = settings.streamChunks ?? 500;
  const steps: SmokeStep[] = [];
  const scenarios: ScenarioResult[] = [];
  const restyle: ({ name: string } & Awaited<
    ReturnType<typeof analyzeRestyle>
  >)[] = [];
  const readyAt = Date.now();
  const navigation = performance.getEntriesByType("navigation")[0] as
    PerformanceNavigationTiming | undefined;
  const startup = {
    readyAtEpochMs: readyAt,
    pageReadyMs: round(performance.now()),
    domInteractiveMs: navigation ? round(navigation.domInteractive) : undefined,
    domContentLoadedMs: navigation
      ? round(navigation.domContentLoadedEventEnd)
      : undefined,
    /** When the window became visible, with its workspace drawn. */
    visibleAtEpochMs: undefined as number | undefined,
  };
  let refreshMs = 1000 / 60;

  const scenario = async (
    name: string,
    body: (measure: Measure) => Promise<void>,
    options: { frames?: boolean; setup?: boolean } = {},
  ) => {
    if (
      settings.only?.length &&
      !options.setup &&
      !settings.only.some((part) => name.includes(part))
    )
      return;
    await invoke("dev_perf_mark", { label: `start:${name}` }).catch(() => {});
    // Let a profiler the runner starts on this mark attach first.
    if (settings.sample && name.includes(settings.sample)) await pause(1_500);
    const before = await sampleProcesses();
    const frames = options.frames === false ? null : recordFrames(refreshMs);
    const longTasks = recordLongTasks();
    const latencies: number[] = [];
    const phases = {
      script: [] as number[],
      styleLayout: [] as number[],
      frame: [] as number[],
      toLastCommit: [] as number[],
      passiveEffects: [] as number[],
    };
    startReactProfile();
    const hot = options.frames === false ? null : recordHotCalls();
    const started = performance.now();
    let hiddenMs = 0;
    let hiddenSince = document.hidden ? started : 0;
    const onVisibility = () => {
      const now = performance.now();
      if (document.hidden) hiddenSince = now;
      else if (hiddenSince) {
        hiddenMs += now - hiddenSince;
        hiddenSince = 0;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    let error: string | undefined;
    try {
      await body({
        time: async (action, until, timeoutMs = 5_000) => {
          const begin = performance.now();
          await action();
          // React renders discrete input in a microtask; let it finish.
          await Promise.resolve();
          await Promise.resolve();
          const scripted = performance.now();
          const immediate = !until || until();
          let laidOut = scripted;
          if (immediate) {
            // Pay style and layout now, so they can be told apart from paint.
            void document.body.getBoundingClientRect().height;
            laidOut = performance.now();
          } else {
            await untilPainted(until!, timeoutMs);
          }
          const painted = await nextPaint();
          const elapsed = painted - begin;
          latencies.push(elapsed);
          if (immediate) {
            phases.script.push(scripted - begin);
            phases.styleLayout.push(laidOut - scripted);
            phases.frame.push(painted - laidOut);
            const react = reactMarksSince(begin);
            phases.toLastCommit.push(react.lastCommitMs);
            phases.passiveEffects.push(react.passiveEffectsMs);
          }
          return elapsed;
        },
      });
    } catch (caught) {
      error = errorText(caught);
    }
    document.removeEventListener("visibilitychange", onVisibility);
    if (hiddenSince) hiddenMs += performance.now() - hiddenSince;
    const wallMs = round(performance.now() - started);
    const react = stopReactProfile();
    const hotCalls = hot?.stop();
    const frameStats = frames?.stop();
    const longTaskStats = longTasks.stop();
    const after = await sampleProcesses();
    await invoke("dev_perf_mark", { label: `end:${name}` }).catch(() => {});
    scenarios.push({
      name,
      wallMs,
      ...(latencies.length ? { interactions: spread(latencies) } : {}),
      ...(phases.script.length
        ? {
            breakdown: {
              script: spread(phases.script),
              styleLayout: spread(phases.styleLayout),
              frame: spread(phases.frame),
              toLastCommit: spread(phases.toLastCommit),
              passiveEffects: spread(phases.passiveEffects),
            },
          }
        : {}),
      ...(frameStats ? { frames: frameStats } : {}),
      ...(react ? { react } : {}),
      ...(hotCalls ? { hotCalls } : {}),
      longTasks: longTaskStats,
      processes: processUse(before, after),
      heapMB: heapMB(),
      visible: document.visibilityState === "visible",
      focused: document.hasFocus(),
      hiddenMs: round(hiddenMs, 0),
      ...(error ? { error } : {}),
    });
    steps.push({ name, passed: !error, ...(error ? { detail: error } : {}) });
  };

  const sessionIn = (id: string) => get().sessions.find((s) => s.id === id);
  const replied = (id: string, count: number) => {
    const session = sessionIn(id);
    return (
      !!session &&
      !session.busy &&
      session.blocks.filter(
        (block) =>
          block.role === "assistant" && block.text.includes(SMOKE_REPLY),
      ).length >= count
    );
  };
  const chatIds: string[] = [];
  const openChat = async (measure?: Measure) => {
    const known = new Set(get().sessions.map((session) => session.id));
    const open = () => get().newProjectTask(config.projectPath);
    const created = () =>
      get().sessions.find(
        (session) =>
          !known.has(session.id) &&
          session.harness === "claude" &&
          sameProjectPath(session.cwd, config.projectPath),
      );
    if (measure) await measure.time(open, created);
    else open();
    const session = await waitFor(created, 10_000, "a new chat");
    chatIds.push(session.id);
    return session.id;
  };
  const turn = async (id: string, text: string, count: number) => {
    get().submit(id, text);
    await waitFor(() => replied(id, count), 120_000, "the stand-in's reply");
  };

  try {
    // The launch time people see ends when the window appears.
    const reveal = await readLaunchReveal().catch(() => null);
    startup.visibleAtEpochMs = reveal?.native?.revealedAtMs ?? undefined;
    // macOS stops drawing covered windows, which would stall every timing.
    await invoke("dev_perf_keep_visible").catch(() => undefined);
    await pause(500);
    const { path } = await resolveClaudeBinary();
    if (!path.startsWith(`${config.binDir}/`))
      throw new Error(`Claude resolved to ${path}, not the stand-in`);
    refreshMs = await measureRefresh();

    // Several chats with real transcripts, so switching and memory reflect use.
    await scenario(
      "open six chats with replies",
      async (measure) => {
        for (let index = 0; index < 6; index += 1) {
          const id = await openChat(measure);
          await turn(id, `Explain the change. AVEN_PERF_STREAM 120`, 1);
        }
      },
      { setup: true },
    );

    const streaming = chatIds[chatIds.length - 1];
    await scenario("agent streaming a long reply", async () => {
      await turn(streaming, `Go on. AVEN_PERF_STREAM ${streamChunks}`, 2);
    });

    const typeInto = async (measure: Measure, characters: number) => {
      const composer = await waitFor(visibleComposer, 5_000, "the composer");
      const text = "Refactor the sidebar so it stays smooth while streaming ";
      for (let index = 0; index < characters; index += 1) {
        await measure.time(() =>
          typeCharacter(composer, text[index % text.length]),
        );
        await pause(30);
      }
      clearComposer(composer);
    };

    await scenario("typing in the composer", (measure) =>
      typeInto(measure, 80),
    );

    await scenario("typing while an agent streams", async (measure) => {
      get().submit(streaming, `More. AVEN_PERF_STREAM ${streamChunks}`);
      await waitFor(
        () => sessionIn(streaming)?.busy,
        5_000,
        "the stream to start",
      );
      await typeInto(measure, 80);
      await waitFor(
        () => replied(streaming, 3),
        120_000,
        "the stream to finish",
      );
    });

    // People keep working while an agent writes in another tab.
    await scenario("agent streaming in a background tab", async () => {
      const background = chatIds[0];
      get().submit(background, `Keep going. AVEN_PERF_STREAM ${streamChunks}`);
      await waitFor(
        () => sessionIn(background)?.busy,
        5_000,
        "the stream to start",
      );
      pressShortcut("2");
      await waitFor(
        () => replied(background, 2),
        120_000,
        "the background stream to finish",
      );
    });

    await scenario("switching chat tabs", async (measure) => {
      for (let round_ = 0; round_ < 4; round_ += 1) {
        for (let slot = 1; slot <= 6; slot += 1) {
          const before = get().focusedSurfaceId;
          await measure.time(
            () => pressShortcut(String(slot)),
            () => get().focusedSurfaceId !== before,
          );
          await pause(60);
        }
      }
    });

    await scenario("sidebar show and hide", async (measure) => {
      for (let index = 0; index < 16; index += 1) {
        const before = get().sidebarOpen;
        await measure.time(
          () => pressShortcut("b"),
          () => get().sidebarOpen !== before,
        );
        await pause(120);
      }
    });

    await scenario("Settings open and close", async (measure) => {
      const settingsShown = () => document.querySelector("[data-app-settings]");
      for (let index = 0; index < 8; index += 1) {
        await measure.time(() => pressShortcut(","), settingsShown);
        await pause(100);
        await measure.time(
          () => pressShortcut("w"),
          () => !settingsShown(),
        );
        await pause(100);
      }
    });

    // Diagnosis only (`--perf-only restyle`): which attribute changes in an
    // interaction make WebKit restyle the most.
    if (settings.only?.some((part) => part.includes("restyle"))) {
      const settle = async () => {
        await nextPaint();
        await nextPaint();
      };
      const report = async (name: string, action: () => unknown) => {
        const result = await analyzeRestyle(action, settle);
        restyle.push({ name, ...result });
        await pause(200);
      };
      const settingsShown = () => document.querySelector("[data-app-settings]");
      await report("open Settings", () => pressShortcut(","));
      await waitFor(settingsShown, 5_000, "Settings");
      await report("close Settings", () => pressShortcut("w"));
      await report("hide sidebar", () => pressShortcut("b"));
      await report("show sidebar", () => pressShortcut("b"));
      await report("switch chat tab", () => pressShortcut("2"));
      await report("switch chat tab back", () => pressShortcut("1"));
    }

    const { openWebLink } = get();
    if (settings.pageUrl && openWebLink) {
      await scenario("opening a web page", async (measure) => {
        const before = get().focusedSurfaceId;
        await measure.time(
          () => openWebLink(settings.pageUrl!),
          () =>
            get().focusedSurfaceId !== before &&
            document.querySelector("[data-browser-pane]"),
          15_000,
        );
        await pause(1_500);
      });
      await scenario(
        "switching between a chat and the browser",
        async (measure) => {
          for (let index = 0; index < 10; index += 1) {
            for (const key of ["1", "9"]) {
              const before = get().focusedSurfaceId;
              await measure.time(
                () => pressShortcut(key),
                () => get().focusedSurfaceId !== before,
              );
              await pause(150);
            }
          }
        },
      );
      // Leave a chat in front for the idle measurement.
      pressShortcut("1");
      await pause(300);
    }

    await scenario(
      "idle with the workspace on screen",
      () => pause((settings.idleSeconds ?? 10) * 1000),
      { frames: false },
    );
  } catch (error) {
    steps.push({
      name: "speed test setup",
      passed: false,
      detail: errorText(error),
    });
  }

  await finishDevSmoke(steps, {
    perf: { refreshMs: round(refreshMs, 2), startup, scenarios, restyle },
  });
}

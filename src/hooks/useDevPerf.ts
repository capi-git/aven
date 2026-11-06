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
import { pressPoint, smokeMouse } from "../lib/devSmokeLoneTab";
import { smokeSwipe } from "../lib/devSmokeSwipe";
import {
  checkMotion,
  recordMotion,
  TAB_COPY,
  type MotionCheckResult,
  type MotionRecorder,
} from "../lib/devPerfMotion";
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
  /** The hover sidebar's layer, once attached, and whether its card is out. */
  floatingSidebarLabel?: string | null;
  hoverSidebarRevealed?: boolean;
  /** The workspace in front (Personal, Work…). */
  activeProfileId?: string;
  /** Move a project into a workspace, as the project row's menu does. */
  assignProject?: (path: string, profileId: string) => void;
  /** Bring a workspace to the front, as its menu's row does. */
  selectProfile?: (id: string) => void;
};

type PerfSettings = {
  /** A local page for the browser scenarios. */
  pageUrl?: string;
  /** Chunks in a long streamed reply (about 12 ms each). */
  streamChunks?: number;
  /** Lines in a streamed code block (two chunks each). */
  codeLines?: number;
  /** Seconds of idle to measure. */
  idleSeconds?: number;
  /** Run only scenarios whose names contain one of these (setup always runs). */
  only?: string[];
  /** Profile the interface process during the scenario whose name contains this. */
  sample?: string;
  /** Record the window from outside during the scenario whose name contains this. */
  record?: string;
  /** A second project, put in the Work workspace for the swipe scenario. */
  workProjectPath?: string;
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
  /** The part of the scenario that starts now, for long frames to be told apart. */
  mark: (label: string, at?: number) => void;
  /** Time `action` until `until` holds and the next frame is drawn. */
  time: (
    action: () => unknown,
    until?: () => unknown,
    timeoutMs?: number,
  ) => Promise<number>;
};

/** How long a motion check keeps recording after its last move (ms). */
const MOTION_SETTLE_MS = 1_200;

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
  const motion: MotionCheckResult[] = [];
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

  const wanted = (name: string) =>
    !settings.only?.length || settings.only.some((part) => name.includes(part));
  const scenario = async (
    name: string,
    body: (measure: Measure) => Promise<void>,
    options: { frames?: boolean; setup?: boolean } = {},
  ) => {
    if (!options.setup && !wanted(name)) return;
    await invoke("dev_perf_mark", { label: `start:${name}` }).catch(() => {});
    // Let a profiler the runner starts on this mark attach first.
    if (
      (settings.sample && name.includes(settings.sample)) ||
      (settings.record && name.includes(settings.record))
    )
      await pause(1_500);
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
        mark: (label, at) => frames?.mark(label, at),
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
  const replies = (id: string) =>
    sessionIn(id)?.blocks.filter(
      (block) => block.role === "assistant" && block.text.includes(SMOKE_REPLY),
    ).length ?? 0;
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

    // A hand drags at the display's rate; each event is a real mouse event in
    // the web view, so this pays what a tab drag really pays.
    const dragTab = async (
      measure: Measure,
      slot: HTMLElement,
      to: (share: number) => { x: number; y: number },
      steps: number,
    ) => {
      const from = pressPoint(slot);
      measure.mark("lift");
      await smokeMouse("down", from, { settle: false });
      await smokeMouse(
        "drag",
        { x: from.x + 8, y: from.y + 2 },
        { settle: false },
      );
      await nextPaint();
      measure.mark("motion");
      for (let step = 1; step <= steps; step += 1) {
        await smokeMouse("drag", to(step / steps), { settle: false });
        await pause(refreshMs);
      }
    };
    const stripSlots = () =>
      [
        ...document.querySelectorAll<HTMLElement>(
          ".aven-tab-strip [data-motion-slot]",
        ),
      ].filter((slot) => slot.getBoundingClientRect().width > 0);

    await scenario("dragging a tab along the strip", async (measure) => {
      for (let round_ = 0; round_ < 4; round_ += 1) {
        const slots = stripSlots();
        const first = slots[0];
        const last = slots[slots.length - 1];
        if (!first || !last) throw new Error("No tabs to drag");
        const start = pressPoint(first);
        const end = pressPoint(last);
        await dragTab(
          measure,
          first,
          (share) => ({
            x: start.x + (end.x - start.x) * share,
            y: start.y,
          }),
          90,
        );
        // Letting go: the strip takes its new order and settles.
        measure.mark("drop");
        await measure.time(() => smokeMouse("up", end, { settle: false }));
        await pause(400);
      }
    });

    await scenario("dragging a tab over the panes", async (measure) => {
      const stage = document.querySelector<HTMLElement>(
        "[data-workspace-stage]",
      );
      if (!stage) throw new Error("No workspace stage");
      for (let round_ = 0; round_ < 3; round_ += 1) {
        const slots = stripSlots();
        const slot = slots[slots.length - 1];
        if (!slot) throw new Error("No tabs to drag");
        const box = stage.getBoundingClientRect();
        const start = pressPoint(slot);
        // Through the middle and each edge of the stage, so the drop preview
        // changes as it does by hand; back to the strip, so nothing splits.
        const stops = [
          start,
          { x: box.left + box.width * 0.5, y: box.top + box.height * 0.5 },
          { x: box.left + 24, y: box.top + box.height * 0.5 },
          { x: box.left + box.width * 0.5, y: box.bottom - 24 },
          { x: box.right - 24, y: box.top + box.height * 0.5 },
          { x: box.left + box.width * 0.5, y: box.top + 24 },
          start,
        ];
        await dragTab(
          measure,
          slot,
          (share) => {
            const along = share * (stops.length - 1);
            const leg = Math.min(Math.floor(along), stops.length - 2);
            const part = along - leg;
            return {
              x: stops[leg].x + (stops[leg + 1].x - stops[leg].x) * part,
              y: stops[leg].y + (stops[leg + 1].y - stops[leg].y) * part,
            };
          },
          150,
        );
        measure.mark("drop");
        await measure.time(() => smokeMouse("up", start, { settle: false }));
        await pause(400);
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

    // The hover sidebar as a person opens it: the pointer rests on the
    // window's edge, the card slides out, the pointer leaves, it slides back.
    const hoverSidebarSlides = async (measure: Measure, rounds = 10) => {
      const unpinned = get().sidebarOpen;
      if (unpinned) {
        pressShortcut("b");
        await waitFor(
          () => get().sidebarOpen === false,
          5_000,
          "the sidebar to unpin",
        );
      }
      await waitFor(
        () => get().floatingSidebarLabel,
        20_000,
        "the hover sidebar's layer",
      );
      await pause(800);
      const edge = () => ({ x: 1, y: window.innerHeight / 2 });
      const away = () => ({
        x: window.innerWidth * 0.6,
        y: window.innerHeight / 2,
      });
      for (let round_ = 0; round_ < rounds; round_ += 1) {
        measure.mark("slide in");
        await measure.time(
          () => smokeMouse("move", edge(), { settle: false }),
          () => get().hoverSidebarRevealed,
        );
        await pause(520);
        measure.mark("slide out");
        await measure.time(
          () => smokeMouse("move", away(), { settle: false }),
          () => !get().hoverSidebarRevealed,
        );
        await pause(400);
      }
      if (unpinned) {
        pressShortcut("b");
        await pause(300);
      }
    };

    await scenario("hover sidebar over a chat", (measure) =>
      hoverSidebarSlides(measure),
    );

    // Dragging the pinned sidebar's edge wider and narrower, a frame at a time
    // as a hand does: the whole workspace follows it.
    const dragSidebarEdge = async (measure: Measure, rounds = 3) => {
      if (!get().sidebarOpen) {
        pressShortcut("b");
        await waitFor(() => get().sidebarOpen, 5_000, "the sidebar to pin");
        await pause(300);
      }
      const edge = document.querySelector<HTMLElement>(
        '[role="separator"][aria-label="Resize sidebar"]',
      );
      if (!edge) throw new Error("No sidebar edge");
      for (let round_ = 0; round_ < rounds; round_ += 1) {
        const box = edge.getBoundingClientRect();
        const from = { x: box.left + box.width / 2, y: box.top + 200 };
        measure.mark("lift");
        await smokeMouse("down", from, { settle: false });
        await nextPaint();
        measure.mark("motion");
        const steps = 90;
        for (let step = 1; step <= steps; step += 1) {
          // Out by 90 px and back again.
          const share = 1 - Math.abs((step / steps) * 2 - 1);
          await smokeMouse(
            "drag",
            { x: from.x + share * 90, y: from.y },
            { settle: false },
          );
          await pause(refreshMs);
        }
        measure.mark("drop");
        await measure.time(() => smokeMouse("up", from, { settle: false }));
        await pause(300);
      }
    };

    await scenario("dragging the sidebar edge over a chat", (measure) =>
      dragSidebarEdge(measure),
    );

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
      const slots = stripSlots();
      if (slots.length > 1) {
        const from = pressPoint(slots[0]);
        const to = pressPoint(slots[slots.length - 1]);
        await dragTab(
          { mark: () => undefined, time: async () => 0 },
          slots[0],
          (share) => ({ x: from.x + (to.x - from.x) * share, y: from.y }),
          40,
        );
        await report("drop a tab", () =>
          smokeMouse("up", to, { settle: false }),
        );
      }
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
      await scenario("hover sidebar over a web page", async (measure) => {
        pressShortcut("9");
        await pause(1_000);
        if (!document.querySelector("[data-browser-pane]"))
          throw new Error("No web page in front");
        await hoverSidebarSlides(measure);
      });
      await scenario(
        "dragging the sidebar edge over a web page",
        async (measure) => {
          pressShortcut("9");
          await pause(1_000);
          if (!document.querySelector("[data-browser-pane]"))
            throw new Error("No web page in front");
          await dragSidebarEdge(measure);
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

    // Last, so the scenarios above run as they always have. Agents often
    // write whole files, and each update colors the open code block again.
    await scenario("agent streaming a long code block", async () => {
      const id = chatIds[chatIds.length - 1];
      pressShortcut(String(chatIds.length));
      await pause(300);
      await turn(
        id,
        `Write it out. AVEN_PERF_CODE ${settings.codeLines ?? 240}`,
        replies(id) + 1,
      );
    });

    // After everything else, because they change the layout for good.
    const stageBox = () =>
      document
        .querySelector<HTMLElement>("[data-workspace-stage]")
        ?.getBoundingClientRect();
    const dropOnRightEdge = async (measure: Measure, slot: HTMLElement) => {
      const box = stageBox();
      if (!box) throw new Error("No workspace stage");
      const start = pressPoint(slot);
      const end = {
        x: box.right - 24,
        y: box.top + box.height * 0.5,
      };
      await dragTab(
        measure,
        slot,
        (share) => ({
          x: start.x + (end.x - start.x) * share,
          y: start.y + (end.y - start.y) * share,
        }),
        60,
      );
      measure.mark("drop");
      await measure.time(() => smokeMouse("up", end, { settle: false }));
      await pause(600);
    };
    await scenario("dropping a tab to make a split", async (measure) => {
      for (let round_ = 0; round_ < 2; round_ += 1) {
        pressShortcut(String(round_ + 1));
        await pause(300);
        const slots = stripSlots();
        const slot = slots[slots.length - 1];
        if (!slot) throw new Error("No tabs to drag");
        await dropOnRightEdge(measure, slot);
      }
    });
    if (settings.pageUrl && openWebLink) {
      await scenario("dropping a tab beside a web page", async (measure) => {
        pressShortcut("9");
        await pause(1_000);
        if (!document.querySelector("[data-browser-pane]"))
          throw new Error("No web page in front");
        const slots = stripSlots();
        const slot = slots[0];
        if (!slot) throw new Error("No tabs to drag");
        await dropOnRightEdge(measure, slot);
        await pause(1_000);
      });
    }
    // Two workspaces, each with a project and chats: a two-finger swipe on
    // the pinned sidebar's workspace pages moves to the other, as people do
    // all day. Last of the timed scenarios, so the ones above run as they
    // always have; it ends on the workspace it started in.
    const swipeName = "switching workspaces by swiping";
    const viewport = () =>
      document.querySelector<HTMLElement>(".personal-profile-viewport");
    const workspaces = () =>
      [...document.querySelectorAll(".personal-profile-page")].length;
    /** One swipe to the other workspace; resolves once it is in front and the pages rest. */
    const swipeWorkspace = async (measure?: Measure, label = "") => {
      const pages = viewport();
      if (!pages || workspaces() < 2) throw new Error("No workspace pages");
      const from = get().activeProfileId;
      const toPersonal = from !== "personal";
      const target = toPersonal ? 0 : 1;
      // Pages can be a fraction of a pixel wide; the last rests at the end.
      const rest = () =>
        Math.min(
          target * pages.clientWidth,
          pages.scrollWidth - pages.clientWidth,
        );
      const settled = () =>
        get().activeProfileId !== from &&
        Math.abs(pages.scrollLeft - rest()) < 1.5;
      // The fingers travel 45% of a page; momentum and the snap carry it on.
      const distance = (toPersonal ? -1 : 1) * pages.clientWidth * 0.45;
      let gesture: Promise<void> = Promise.resolve();
      let failed: unknown;
      // Counts scrolls for a failure's report. (No wheel listener: adding
      // one on the window makes WebKit restyle the whole page.)
      let scrolls = 0;
      const onScroll = () => (scrolls += 1);
      pages.addEventListener("scroll", onScroll, { passive: true });
      const play = () => {
        gesture = smokeSwipe(pages, distance, refreshMs).catch((error) => {
          failed = error;
        });
      };
      const until = () => {
        if (failed) throw failed;
        return settled();
      };
      // Which part of the swipe a long frame falls in: the glide, or after
      // the pages came to rest.
      let resting = false;
      const watch = (frame: number) => {
        if (!measure || resting) return;
        if (Math.abs(pages.scrollLeft - rest()) < 1.5) {
          resting = true;
          // At the frame's own time: a long frame that starts in it is the
          // switch after the pages arrived, not the glide.
          measure.mark(`${label}, at rest`, frame);
          return;
        }
        requestAnimationFrame(watch);
      };
      try {
        measure?.mark(`${label}, gliding`);
        requestAnimationFrame(watch);
        if (measure) await measure.time(play, until, 5_000);
        else {
          play();
          await waitFor(until, 5_000, "the other workspace");
        }
      } catch (error) {
        await gesture;
        throw new Error(
          `${errorText(failed ?? error)} (pages at ${Math.round(pages.scrollLeft)} of ${pages.scrollWidth} px, ${pages.clientWidth} px each, carousel ${pages.dataset.carouselEnabled}, ${get().activeProfileId} in front, ${scrolls} scroll events)`,
        );
      } finally {
        pages.removeEventListener("scroll", onScroll);
      }
      await gesture;
    };
    if (
      settings.workProjectPath &&
      get().assignProject &&
      get().selectProfile &&
      (wanted(swipeName) || settings.only?.some((part) => part === "motion"))
    ) {
      try {
        if (!get().sidebarOpen) {
          pressShortcut("b");
          await waitFor(() => get().sidebarOpen, 5_000, "the sidebar to pin");
        }
        get().assignProject?.(settings.workProjectPath, "work");
        for (let index = 0; index < 2; index += 1) {
          const known = new Set(get().sessions.map((session) => session.id));
          get().newProjectTask(settings.workProjectPath);
          const session = await waitFor(
            () =>
              get().sessions.find(
                (candidate) =>
                  !known.has(candidate.id) &&
                  sameProjectPath(candidate.cwd, settings.workProjectPath!),
              ),
            10_000,
            "a chat in the Work workspace",
          );
          await turn(session.id, "Explain the change. AVEN_PERF_STREAM 120", 1);
        }
        if (get().activeProfileId !== "work") get().selectProfile?.("work");
        await waitFor(
          () => get().activeProfileId === "work",
          5_000,
          "the Work workspace in front",
        );
        await pause(600);
        // Once there and back, so both workspaces have been seen.
        await swipeWorkspace();
        await pause(600);
        await swipeWorkspace();
        await pause(600);
        await swipeWorkspace();
        await pause(800);
        // Diagnosis only (`--perf-only restyle`): what a switch of workspace
        // makes WebKit restyle and lay out, there and back.
        if (settings.only?.some((part) => part.includes("restyle"))) {
          const settle = async () => {
            await nextPaint();
            await nextPaint();
          };
          for (const id of ["work", "personal"]) {
            const result = await analyzeRestyle(
              () => get().selectProfile?.(id),
              settle,
            );
            restyle.push({ name: `switch workspace to ${id}`, ...result });
            await pause(400);
          }
        }
        await scenario(swipeName, async (measure) => {
          for (let index = 0; index < 6; index += 1) {
            await swipeWorkspace(
              measure,
              index % 2 ? "to Personal" : "to Work",
            );
            measure.mark("between swipes");
            await pause(700);
          }
        });
      } catch (error) {
        steps.push({
          name: swipeName,
          passed: false,
          detail: errorText(error),
        });
      }
    }
    // The motion check (after Rune's motion audit): a few of the moves
    // above again, every keyed element's box recorded each frame, and what
    // a person would notice listed (devPerfMotion.ts, motionAudit.ts). It
    // runs apart from the timed scenarios, so its sampling is in no figure.
    if (
      !settings.only?.length ||
      settings.only.some((part) => part.includes("motion"))
    ) {
      const check = async (
        name: string,
        body: (recorder: MotionRecorder) => Promise<void>,
      ) => {
        const recorder = recordMotion(name);
        let error: string | undefined;
        try {
          // A few frames at rest first, so whatever the move changes was seen.
          await pause(250);
          await body(recorder);
          await pause(MOTION_SETTLE_MS);
        } catch (caught) {
          error = errorText(caught);
        }
        const result = checkMotion(recorder.stop());
        motion.push(error ? { ...result, error } : result);
      };
      pressShortcut("1");
      await pause(600);
      await check("sidebar show and hide", async (recorder) => {
        for (let index = 0; index < 2; index += 1) {
          recorder.input({ label: index ? "show the sidebar" : "hide it" });
          pressShortcut("b");
          await pause(700);
        }
      });
      await check("Settings open and close", async (recorder) => {
        const settingsShown = () =>
          document.querySelector("[data-app-settings]");
        // Settings takes the place of the workspace in a cut.
        recorder.input({ label: "open Settings", expect: ["instant"] });
        pressShortcut(",");
        await waitFor(settingsShown, 5_000, "Settings");
        await pause(600);
        recorder.input({ label: "close Settings", expect: ["instant"] });
        pressShortcut("w");
        await waitFor(() => !settingsShown(), 5_000, "Settings to close");
      });
      await check("dragging a tab along the strip", async (recorder) => {
        const slots = stripSlots();
        const first = slots[0];
        const last = slots[slots.length - 1];
        if (!first || !last || first === last)
          throw new Error("No tabs to drag");
        const from = pressPoint(first);
        const to = pressPoint(last);
        recorder.input({ label: "lift a tab" });
        await smokeMouse("down", from, { settle: false });
        await smokeMouse(
          "drag",
          { x: from.x + 8, y: from.y + 2 },
          { settle: false },
        );
        // Let the lift settle, then the copy should ride the pointer.
        await pause(400);
        const pointer: { t: number; x: number; y: number }[] = [];
        recorder.input({
          label: "drag it along the strip",
          expect: ["follow"],
          element: TAB_COPY,
          pointer,
        });
        const steps = 60;
        for (let step = 1; step <= steps; step += 1) {
          const at = {
            x: from.x + 8 + (to.x - from.x - 8) * (step / steps),
            y: from.y + 2,
          };
          pointer.push({ t: recorder.now(), ...at });
          await smokeMouse("drag", at, { settle: false });
          await pause(refreshMs);
        }
        recorder.input({
          label: "let go",
          allow: {
            kinds: ["overshoot"],
            reason:
              "let go while moving, the copy lands with the throw's overshoot (TAB_SPRING.flick)",
          },
        });
        await smokeMouse("up", to, { settle: false });
      });
      await check("closing a tab", async (recorder) => {
        const active = document.querySelector<HTMLElement>(
          ".aven-tab-strip [data-motion-slot][data-active='true']",
        );
        const id = active?.dataset.motionSlot;
        if (!id) throw new Error("No tab in front");
        recorder.input({
          label: "close the tab in front",
          expect: ["leaves"],
          element: `tab:${id}`,
        });
        pressShortcut("w");
        await pause(400);
      });
      if (get().activeProfileId === "personal" && workspaces() > 1)
        await check("swiping between workspaces", async (recorder) => {
          for (const label of ["swipe to Work", "swipe back to Personal"]) {
            recorder.input({
              label,
              allow: {
                kinds: ["pop-in", "pop-out"],
                reason:
                  "the other workspace's project and its tabs replace these at once when the pages come to rest",
              },
            });
            await swipeWorkspace();
            await pause(500);
          }
        });
    }
  } catch (error) {
    steps.push({
      name: "speed test setup",
      passed: false,
      detail: errorText(error),
    });
  }

  await finishDevSmoke(steps, {
    perf: {
      refreshMs: round(refreshMs, 2),
      startup,
      scenarios,
      restyle,
      motion,
    },
  });
}

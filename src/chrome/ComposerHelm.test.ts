// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/harness/availability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/harness/availability")>()),
  probeHarnessAvailability: vi.fn(async () => {}),
  isHarnessAvailable: () => true,
}));
// The chat's turn outcomes, as the activity ledger holds them.
const ledger = vi.hoisted(() => ({ entries: [] as unknown[] }));
vi.mock("../lib/activity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/activity")>()),
  useActivity: () => ledger.entries,
}));
vi.mock("../lib/harness/registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/harness/registry")>()),
  refreshHarnessCatalogs: vi.fn(async () => {}),
}));

const { ComposerHelm } = await import("./ComposerHelm");
const { HelmRunContext } = await import("./HelmRun");
const { CLAUDE_OPUS_5_5_MODEL } = await import("../lib/models");
const { PROJECT_SIGILS, SIGIL_CRITTERS } = await import("../lib/dotSigils");
const { HELM_CRITTER_EVENT, HELM_CRITTER_KEY, HELM_DONE_MS } =
  await import("../lib/composerHelm");
type HelmRun = import("./HelmRun").HelmRun;
type Session = import("../lib/session").Session;

let root: Root;
let host: HTMLDivElement;
let field: HTMLTextAreaElement;
let storage: Map<string, string>;
let props: ComponentProps<typeof ComposerHelm>;
let run: HelmRun | null;
let animate: ReturnType<typeof vi.fn>;
let reducedMotion: boolean;

const PROJECT = "/Users/me/Developer/site";

function session(over: Partial<Session> = {}): Session {
  return {
    id: "chat-1",
    harness: "claude",
    model: CLAUDE_OPUS_5_5_MODEL.id,
    runtimeMode: "full-access",
    cwd: PROJECT,
    title: "Chat",
    blocks: [],
    createdAt: 0,
    updatedAt: 0,
    ...over,
  } as Session;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  storage = new Map([["aven.helmHint.v1", "seen"]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  reducedMotion = false;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduce") ? reducedMotion : false,
    addEventListener() {},
    removeEventListener() {},
  }));
  animate = vi.fn(() => ({ cancel() {} }));
  HTMLElement.prototype.animate = animate as never;
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(
    () => {},
  );
  host = document.createElement("div");
  host.className = "personal-composer";
  host.dataset.helm = "";
  field = document.createElement("textarea");
  document.body.append(host, field);
  root = createRoot(host);
  run = null;
  ledger.entries = [];
  props = {
    enabled: true,
    hotkeys: true,
    critterPath: PROJECT,
    harness: "claude",
    model: CLAUDE_OPUS_5_5_MODEL.id,
    modelSettings: { effort: "max" },
    runtimeMode: "full-access",
    showAgent: true,
    showAccess: true,
    busy: false,
    onModelChange: vi.fn(),
    onModelSettingsChange: vi.fn(),
    onRuntimeModeChange: vi.fn(),
    context: { used: 770_000, window: 1_000_000 },
    onCompact: vi.fn(),
    compactDisabled: false,
    attachmentsSupported: true,
    onAttach: vi.fn(),
    modes: [
      {
        id: "plan",
        label: "Plan mode",
        description: "Plans first",
        icon: null,
        pressed: false,
        onToggle: vi.fn(),
      },
      {
        id: "race",
        label: "Race",
        description: "Several AIs try it",
        icon: null,
        pressed: false,
        onToggle: vi.fn(),
      },
    ],
    recentSkills: [],
    onPickSkill: vi.fn(),
    hasValue: false,
    sendLabel: "Send",
    onSend: vi.fn(),
    stopInBar: false,
    onStop: vi.fn(),
    onReturnFocus: vi.fn(() => field.focus()),
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () =>
    root.render(
      createElement(
        HelmRunContext.Provider,
        { value: run },
        createElement(ComposerHelm, props),
      ),
    ),
  );
}

/** A turn's end as the ledger records it. */
function ended(turn: string, outcome: "completed" | "failed" | "stopped") {
  ledger.entries = [
    {
      id: `chat-1:turn:${turn}:${outcome}`,
      sessionId: "chat-1",
      outcome,
      title: "Chat",
      summary: outcome,
      cwd: PROJECT,
      harness: "claude",
      model: CLAUDE_OPUS_5_5_MODEL.id,
      createdAt: Date.now(),
      readAt: null,
      resolvedAt: null,
    },
  ];
}

const helm = () => host.querySelector<HTMLElement>("[data-helm]")!;
const critter = () =>
  host.querySelector<HTMLButtonElement>("[data-helm-critter]")!;
const dialog = () =>
  document.body.querySelector<HTMLElement>("[data-helm-dialog]");
const row = (id: string) =>
  document.body.querySelector<HTMLButtonElement>(`[data-helm-row="${id}"]`);
const rowIds = () =>
  [...document.body.querySelectorAll<HTMLElement>("[data-helm-row]")].map(
    (element) => element.dataset.helmRow,
  );
const cursorRow = () =>
  document.body.querySelector<HTMLElement>("[data-helm-row][data-active]")
    ?.dataset.helmRow;
const stops = () =>
  document.body.querySelectorAll('[aria-label="Stop"], .session-run-stop');

async function key(name: string, target: Element = document.activeElement!) {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: name,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}
async function commandPeriod() {
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: ".",
        code: "Period",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}
/** Where the critter stands, from the window's top (happy-dom has no layout). */
function critterAt(top: number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const at = this.matches("[data-helm-critter]") ? top : 0;
      return {
        top: at,
        bottom: at + 36,
        left: 900,
        right: 936,
        width: 36,
        height: 36,
        x: 900,
        y: at,
      } as DOMRect;
    },
  );
  vi.stubGlobal("innerHeight", 900);
  vi.stubGlobal("innerWidth", 1440);
}
async function openByClick() {
  await act(async () => critter().click());
}

/** The mark standing at the helm. */
const mark = () => critter().querySelector<HTMLElement>(".helm-critter")!;

describe("the mark's square", () => {
  /** Dots in a path: each starts with a move. */
  const dots = (path: Element | null) =>
    (path?.getAttribute("d")?.match(/M/g) ?? []).length;
  const css = (file: string) =>
    readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  it("draws all 25 dots at the corner, whatever the sigil, at rest and working", async () => {
    await render();
    expect(mark().dataset.frame).toBe("square");
    expect(dots(mark().querySelector(".dot-mark-grid"))).toBe(25);
    // The sigil's own dots, lit over the square.
    expect(dots(mark().querySelector(".dot-mark-lit"))).toBeGreaterThan(0);
    props.busy = true;
    await render();
    expect(mark().dataset.state).toBe("working");
    const grid = [...mark().querySelectorAll(".dot-mark-grid-d")];
    expect(grid.reduce((sum, path) => sum + dots(path), 0)).toBe(25);
  });

  it("is a 25px square whose unlit dots are plain enough to read as one", () => {
    const helm = css("src/chrome/ComposerHelm.css");
    const rule = /\.composer-helm \.dot-mark\.helm-critter \{([^}]*)\}/.exec(
      helm,
    )?.[1];
    expect(rule).toContain("width: 25px;");
    expect(rule).toContain("height: 25px;");
    const marks = css("src/chrome/DotMark.css");
    const square = (selector: string) =>
      Number(
        new RegExp(
          `${selector.replace(/[.[\]"=]/g, "\\$&")} \\{\\s*--dot-mark-unlit: ([\\d.]+);`,
        ).exec(marks)?.[1],
      );
    expect(square('.dot-mark[data-frame="square"]')).toBeGreaterThanOrEqual(
      0.18,
    );
    expect(
      square('html.theme-light .dot-mark[data-frame="square"]'),
    ).toBeGreaterThanOrEqual(0.14);
    // Small marks drop their grid; the square never does.
    expect(marks).toMatch(
      /\.dot-mark:not\(\[data-frame="square"\]\) \.dot-mark-grid,/,
    );
  });
});

describe("the mark's states", () => {
  it("rests still with the room line over it", async () => {
    await render();
    expect(helm().dataset.pose).toBe("rest");
    expect(mark().dataset.state).toBe("still");
    const line = host.querySelector<HTMLElement>(
      ".helm-perch-room .helm-room",
    )!;
    // 77% used: 23% of the line is left, in amber.
    expect(line.querySelector("i")!.style.transform).toBe("scaleX(0.23)");
    expect(line.dataset.tone).toBe("amber");
    // Nothing to send yet: the plane is put away.
    expect(
      host.querySelector<HTMLButtonElement>("[data-helm-send]")!.hidden,
    ).toBe(true);
  });

  it("breathes while you type, beside the button that sends", async () => {
    props.hasValue = true;
    await render();
    expect(helm().dataset.pose).toBe("typing");
    expect(mark().dataset.state).toBe("idle");
    const plane = host.querySelector<HTMLButtonElement>("[data-helm-send]")!;
    expect(plane.getAttribute("aria-label")).toBe("Send");
    await act(async () => plane.click());
    expect(props.onSend).toHaveBeenCalledOnce();
  });

  it("names Send for what sending does while the agent works", async () => {
    props.hasValue = true;
    props.busy = true;
    props.sendLabel = "Queue message";
    await render();
    expect(
      host.querySelector("[data-helm-send]")!.getAttribute("aria-label"),
    ).toBe("Queue message");
  });

  it("opens its menu when pointed at", async () => {
    vi.useFakeTimers();
    await render();
    await act(async () => {
      host.querySelector(".helm-perch")!.dispatchEvent(
        new MouseEvent("pointerover", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );
      vi.advanceTimersByTime(200);
    });
    expect(dialog()).not.toBeNull();
    expect(helm().dataset.pose).toBe("hover");
    // Moving from the dialog back to the critter keeps it open.
    await act(async () => {
      dialog()!.dispatchEvent(
        new MouseEvent("pointerout", {
          bubbles: true,
          relatedTarget: critter(),
        }),
      );
      vi.advanceTimersByTime(400);
    });
    expect(dialog()).not.toBeNull();
    await act(async () => {
      host.querySelector(".helm-perch")!.dispatchEvent(
        new MouseEvent("pointerout", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );
      vi.advanceTimersByTime(400);
    });
    expect(dialog()).toBeNull();
  });

  it("sweeps a light while the agent works, saying what and how long, with the one Stop", async () => {
    run = {
      session: session({
        busy: true,
        blocks: [
          {
            id: "u1",
            role: "user",
            text: "Look",
            startedAt: Date.now() - 42_000,
          },
          {
            id: "t1",
            role: "tool",
            text: "",
            streaming: true,
            tool: {
              callId: "c1",
              kind: "read",
              title: "Read src/chrome/Composer.tsx",
              status: "in_progress",
              preview: {
                kind: "read",
                path: `${PROJECT}/src/chrome/Composer.tsx`,
                fileName: "Composer.tsx",
              },
            },
          },
        ] as Session["blocks"],
      }),
      visible: true,
      placement: "row",
      onStop: vi.fn(),
    };
    props.busy = true;
    await render();
    expect(helm().dataset.pose).toBe("running");
    expect(mark().dataset.state).toBe("working");
    expect(mark().querySelectorAll(".dot-mark-lit-d").length).toBeGreaterThan(
      1,
    );
    const bubble = host.querySelector<HTMLElement>(
      '[data-helm-say="running"]',
    )!;
    expect(bubble.textContent).toContain("Composer.tsx");
    expect(bubble.querySelector('[role="timer"]')?.textContent).toBe("0:42");
    expect(stops()).toHaveLength(1);
    await act(async () => (stops()[0] as HTMLButtonElement).click());
    expect(run.onStop).toHaveBeenCalledWith("chat-1");
  });

  it("leaves Stop to the team bar where both would stop the same run", async () => {
    run = {
      session: session({ busy: true }),
      visible: true,
      placement: "attention",
      onStop: vi.fn(),
    };
    props.busy = true;
    props.stopInBar = true;
    await render();
    expect(host.querySelector('[data-helm-say="running"]')).not.toBeNull();
    expect(stops()).toHaveLength(0);
  });

  it("turns into a tick when the turn ends, says how it went, then rests again", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const start = Date.now();
    const blocks = [
      { id: "u1", role: "user", text: "Tidy", startedAt: start - 72_000 },
      ...["a.ts", "b.ts", "c.ts"].map((name, index) => ({
        id: `e${index}`,
        role: "tool",
        text: "",
        tool: {
          callId: `e${index}`,
          kind: "edit",
          title: `Edit ${name}`,
          status: "completed",
          preview: { kind: "write", path: `${PROJECT}/${name}` },
        },
      })),
    ] as Session["blocks"];
    run = {
      session: session({ busy: true, blocks }),
      visible: true,
      placement: "row",
      onStop: vi.fn(),
    };
    props.busy = true;
    await render();
    blocks[0] = { ...blocks[0], durationMs: 72_000 };
    run = { ...run, session: session({ busy: false, blocks }) };
    props.busy = false;
    ended("u1", "completed");
    await render();
    expect(helm().dataset.pose).toBe("done");
    expect(mark().dataset.state).toBe("done");
    expect(mark().querySelector(".dot-mark-status")).not.toBeNull();
    const bubble = host.querySelector('[data-helm-say="done"]')!;
    expect(bubble.textContent).toContain("Done in 1:12");
    expect(bubble.textContent).toContain("3 files changed");
    await act(async () => vi.advanceTimersByTime(HELM_DONE_MS + 50));
    await render();
    expect(host.querySelector("[data-helm-say]")).toBeNull();
    expect(helm().dataset.pose).toBe("rest");
    expect(mark().dataset.state).toBe("still");
  });

  it("shows a cross on a failure and offers the fixes Aven has, until dismissed", async () => {
    const blocks = [
      {
        id: "u9",
        role: "user",
        text: "Go",
        startedAt: Date.now() - 5000,
        durationMs: 4000,
      },
    ] as Session["blocks"];
    run = {
      session: session({ blocks }),
      visible: true,
      placement: "row",
      onStop: vi.fn(),
    };
    ended("u9", "failed");
    await render();
    expect(helm().dataset.pose).toBe("error");
    expect(mark().dataset.state).toBe("error");
    const bubble = host.querySelector('[data-helm-say="error"]')!;
    const fixes = [...bubble.querySelectorAll("[data-helm-fix]")].map(
      (b) => b.textContent,
    );
    expect(fixes).toEqual(["Switch model", "Usage"]);
    // Switch model opens the agent's own panel.
    await act(async () =>
      (bubble.querySelector("[data-helm-fix]") as HTMLButtonElement).click(),
    );
    expect(document.body.querySelector("[data-agent-panel]")).not.toBeNull();
    await render();
    expect(host.querySelector('[data-helm-say="error"]')).toBeNull();
  });

  it("offers Open terminal when Claude Code needs signing in again", async () => {
    const blocks = [
      {
        id: "u2",
        role: "user",
        text: "Go",
        startedAt: Date.now() - 5000,
        durationMs: 4000,
      },
      {
        id: "s1",
        role: "system",
        text: "Failed to authenticate. API Error: 401",
      },
    ] as Session["blocks"];
    const onOpenTerminal = vi.fn();
    run = {
      session: session({ blocks }),
      visible: true,
      placement: "row",
      onStop: vi.fn(),
      onOpenTerminal,
    };
    ended("u2", "failed");
    await render();
    const fix = host.querySelector<HTMLButtonElement>("[data-helm-fix]")!;
    expect(fix.textContent).toBe("Open terminal");
    await act(async () => fix.click());
    expect(onOpenTerminal).toHaveBeenCalledWith("chat-1");
  });

  it("opens its menu with a short fade from the stylesheet, never stepped frames", async () => {
    critterAt(700);
    await render();
    await openByClick();
    expect(dialog()).not.toBeNull();
    // No size stepping from script: the fade is CSS, off with reduced motion.
    expect(animate).not.toHaveBeenCalled();
  });

  it("pauses while the window is hidden or the pane is parked", async () => {
    props.enabled = false;
    await render();
    expect(helm().dataset.paused).toBe("true");
  });
});

/**
 * Focus as a browser does it: an element under `visibility: hidden` (a
 * popover's first, measuring pass) refuses it. happy-dom would take it.
 */
function refuseFocusWhileHidden() {
  const focus = HTMLElement.prototype.focus;
  const hidden = (element: HTMLElement) => {
    for (let at: HTMLElement | null = element; at; at = at.parentElement)
      if (at.style.visibility === "hidden") return true;
    return false;
  };
  vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (
    this: HTMLElement,
    options?: FocusOptions,
  ) {
    if (!hidden(this)) focus.call(this, options);
  });
}
/** A window in the background, as the real-app check's can be: no frames. */
function withholdAnimationFrames() {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
}

describe("opening and closing", () => {
  it("lands Cmd+. on Model once the dialog is placed, though its first pass is hidden", async () => {
    refuseFocusWhileHidden();
    withholdAnimationFrames();
    await render();
    field.focus();
    await commandPeriod();
    await act(async () => {});
    expect(dialog()).not.toBeNull();
    expect(cursorRow()).toBe("model");
    expect(document.activeElement).toBe(row("model"));
    expect(helm().dataset.open).toBe("keyboard");
  });

  it("takes Cmd+. into a dialog the pointer opened, rather than closing it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await render();
    field.focus();
    await act(async () => {
      host.querySelector(".helm-perch")!.dispatchEvent(
        new MouseEvent("pointerover", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );
      vi.advanceTimersByTime(200);
    });
    expect(helm().dataset.open).toBe("hover");
    await commandPeriod();
    expect(dialog()).not.toBeNull();
    expect(helm().dataset.open).toBe("keyboard");
    expect(document.activeElement).toBe(row("model"));
    // A second press (not the same press heard twice) closes it and hands
    // the keyboard back.
    const later = performance.now() + 1000;
    vi.spyOn(performance, "now").mockReturnValue(later);
    await commandPeriod();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(field);
  });

  it("folds the portal dialog away when the pointer leaves it, not on the way between it and the critter", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await render();
    const move = (from: Element, to: Element) =>
      act(async () => {
        from.dispatchEvent(
          new MouseEvent("pointerout", { bubbles: true, relatedTarget: to }),
        );
        to.dispatchEvent(
          new MouseEvent("pointerover", { bubbles: true, relatedTarget: from }),
        );
      });
    // Onto the critter: it unfurls.
    await move(document.body, critter());
    await act(async () => vi.advanceTimersByTime(200));
    expect(dialog()).not.toBeNull();
    // The dialog lives in a portal, outside the message box.
    expect(host.contains(dialog())).toBe(false);
    // Up across the gap into the dialog: still open.
    await move(critter(), document.body);
    await act(async () => vi.advanceTimersByTime(100));
    await move(document.body, row("model")!);
    await act(async () => vi.advanceTimersByTime(400));
    expect(dialog()).not.toBeNull();
    // Straight from the dialog back onto the critter: still open.
    await move(row("model")!, critter());
    await act(async () => vi.advanceTimersByTime(400));
    expect(dialog()).not.toBeNull();
    // Back into the dialog, then out of it to the page: it folds away.
    await move(critter(), row("files")!);
    await move(row("files")!, document.body);
    await act(async () => vi.advanceTimersByTime(400));
    expect(dialog()).toBeNull();
    expect(helm().dataset.open).toBeUndefined();
  });
});

describe("the dialog", () => {
  it("unfurls above the box with every row the old bar had", async () => {
    props.recentSkills = [
      {
        kind: "file",
        name: "polish",
        description: "Polish",
        invocation: "polish",
        path: "/s",
        scope: "project",
        source: "agents",
      },
    ];
    await render();
    await openByClick();
    expect(rowIds()).toEqual([
      "model",
      "effort",
      "access",
      "room",
      "files",
      "modes",
      "skills",
      "critter",
    ]);
    expect(row("model")!.textContent).toContain("Opus 5.5");
    expect(row("model")!.textContent).toContain("Claude");
    expect(row("effort")!.textContent).toContain("Max");
    expect(row("access")!.textContent).toContain("Full access");
    expect(row("room")!.textContent).toContain("23% left");
    expect(row("room")!.textContent).toContain("Free up space");
    expect(row("files")!.textContent).toContain("Attach files");
    // In a portal, placed above the critter, never flipped over the text.
    expect(dialog()!.closest(".composer-helm")).toBeNull();
    expect(dialog()!.dataset.popoverSide).toBe("top");
  });

  it("stays above the box in a short pane, capped to the room there, its rows scrolling", async () => {
    // A pane under 300px tall: the critter 150px from the window's top, with
    // the whole window below it.
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(324);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(240);
    critterAt(150);
    await render();
    await openByClick();
    const placed = dialog()!;
    expect(placed.dataset.popoverSide).toBe("top");
    // The room above: 150px, less the gap over the room line and the
    // window's edge.
    expect(placed.style.maxHeight).toBe("128px");
    // Every row is still there to scroll to and press.
    expect(rowIds()).toContain("model");
    await act(async () => row("model")!.click());
    expect(document.body.querySelector("[data-agent-panel]")).not.toBeNull();
  });

  it("is named for what it holds, without a tooltip", async () => {
    await render();
    expect(critter().getAttribute("aria-label")).toBe(
      "Message settings, Claude Opus 5.5, Max effort, Full access, 23% room left",
    );
    expect(critter().getAttribute("title")).toBeNull();
    expect(critter().getAttribute("aria-haspopup")).toBe("dialog");
  });

  it("opens with Cmd+. and moves its cursor with the arrow keys", async () => {
    await render();
    field.focus();
    await commandPeriod();
    expect(dialog()).not.toBeNull();
    expect(cursorRow()).toBe("model");
    expect(document.activeElement).toBe(row("model"));
    await key("ArrowDown");
    expect(cursorRow()).toBe("effort");
    expect(document.activeElement).toBe(row("effort"));
    await key("ArrowUp");
    await key("ArrowUp");
    expect(cursorRow()).toBe("critter");
    await key("Home");
    expect(cursorRow()).toBe("model");
    await key("Escape");
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(field);
    expect(props.onReturnFocus).toHaveBeenCalled();
  });

  it("opens each row's existing picker", async () => {
    await render();
    await commandPeriod();
    // Model, Effort and Access open the agent's panel, at their section.
    for (const [id, focus] of [
      ["model", "model"],
      ["effort", "effort"],
      ["access", "access"],
    ] as const) {
      if (!dialog()) await openByClick();
      await act(async () => row(id)!.click());
      const panel =
        document.body.querySelector<HTMLElement>("[data-agent-panel]")!;
      expect(panel.dataset.agentPanelFocus).toBe(focus);
      expect(panel.querySelector("[data-access-options]")).not.toBeNull();
      await key("Escape", panel);
      expect(document.body.querySelector("[data-agent-panel]")).toBeNull();
    }
    await openByClick();
    await act(async () => row("room")!.click());
    expect(props.onCompact).toHaveBeenCalledOnce();
    await openByClick();
    await act(async () => row("files")!.click());
    expect(props.onAttach).toHaveBeenCalledOnce();
  });

  it("closes the agent panel, not stacking the dialog on it, from Cmd+. or the critter", async () => {
    await render();
    await openByClick();
    await act(async () => row("model")!.click());
    expect(document.body.querySelector("[data-agent-panel]")).not.toBeNull();
    await commandPeriod();
    expect(document.body.querySelector("[data-agent-panel]")).toBeNull();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(field);
    await openByClick();
    await act(async () => row("access")!.click());
    expect(document.body.querySelector("[data-agent-panel]")).not.toBeNull();
    await openByClick();
    expect(document.body.querySelector("[data-agent-panel]")).toBeNull();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(field);
  });

  it("keeps the + menu's modes on a page of their own", async () => {
    await render();
    await commandPeriod();
    await key("End");
    await key("ArrowUp");
    expect(cursorRow()).toBe("modes");
    await act(async () => row("modes")!.click());
    const page = document.body.querySelector<HTMLElement>(
      "[data-composer-plus]",
    )!;
    expect(page.getAttribute("aria-label")).toBe("Modes");
    expect(
      document.body.querySelector("[data-composer-plan]")!.textContent,
    ).toContain("Plan mode");
    expect(document.activeElement).toBe(
      document.body.querySelector("[data-composer-plan]"),
    );
    await key("ArrowDown");
    expect(document.activeElement).toBe(
      document.body.querySelector("[data-composer-race]"),
    );
    // Escape steps back to the row it came from.
    await key("Escape");
    expect(document.body.querySelector("[data-composer-plus]")).toBeNull();
    expect(cursorRow()).toBe("modes");
    await act(async () => row("modes")!.click());
    await act(async () =>
      document.body
        .querySelector<HTMLButtonElement>("[data-composer-race]")!
        .click(),
    );
    expect(props.modes[1].onToggle).toHaveBeenCalledOnce();
    expect(dialog()).toBeNull();
  });

  it("says why the modes are off while a discussion runs", async () => {
    props.modes = [];
    props.modesNote = "Modes return when this chat's discussion ends";
    await render();
    await openByClick();
    expect(row("modes")!.textContent).toContain("Modes return");
    expect(row("modes")!.getAttribute("aria-disabled")).toBe("true");
    await act(async () => row("modes")!.click());
    expect(document.body.querySelector("[data-composer-plus]")).toBeNull();
  });

  it("gives a recent skill's name its own column, so it is never cut", async () => {
    props.recentSkills = [
      {
        kind: "file",
        name: "release-notes",
        description: "Write the release notes",
        invocation: "release-notes",
        path: "/s",
        scope: "project",
        source: "agents",
      },
    ];
    await render();
    await openByClick();
    await act(async () => row("skills")!.click());
    const item = document.body.querySelector<HTMLElement>(
      '[aria-label="Recent skills"] [data-helm-item-index="0"]',
    )!;
    expect(item.classList).toContain("helm-row-skill");
    // The name, then what it does: no label column to squeeze it.
    expect([...item.children].map((child) => child.className)).toEqual([
      "helm-value helm-skill",
      "helm-aside",
    ]);
    expect(item.querySelector(".helm-skill")!.textContent).toBe(
      "/release-notes",
    );
  });

  it("starts the message with a recent skill", async () => {
    const skill = {
      kind: "file",
      name: "polish",
      description: "Polish",
      invocation: "polish",
      path: "/s",
      scope: "project",
      source: "agents",
    } as const;
    props.recentSkills = [skill];
    await render();
    await openByClick();
    await act(async () => row("skills")!.click());
    await act(async () =>
      document.body
        .querySelector<HTMLButtonElement>('[data-helm-item-index="0"]')!
        .click(),
    );
    expect(props.onPickSkill).toHaveBeenCalledWith(skill);
  });

  it("leaves out the agent's choices in a bot's chat", async () => {
    props.showAgent = false;
    await render();
    await openByClick();
    expect(rowIds()).toEqual(["room", "files", "modes", "critter"]);
    expect(critter().getAttribute("aria-label")).toBe(
      "Message settings, 23% room left",
    );
  });

  it("says once to point at it, on a first run", async () => {
    vi.useFakeTimers();
    storage.delete("aven.helmHint.v1");
    await render();
    await act(async () => vi.advanceTimersByTime(1300));
    expect(host.querySelector('[data-helm-say="hint"]')!.textContent).toBe(
      "Point at me for settings",
    );
    expect(storage.get("aven.helmHint.v1")).toBe("seen");
    await openByClick();
    expect(host.querySelector('[data-helm-say="hint"]')).toBeNull();
  });

  it("shortens what it says in a narrow pane", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(280);
    await render();
    expect(helm().dataset.fit).toBe("narrow");
  });
});

describe("choosing the mark", () => {
  async function openPicker() {
    await commandPeriod();
    await key("End");
    await act(async () => row("critter")!.click());
  }
  const cells = () => [
    ...document.body.querySelectorAll<HTMLButtonElement>("[data-mark-choice]"),
  ];

  const current = () =>
    PROJECT_SIGILS.findIndex((sigil) => sigil.key === mark().dataset.sigil);
  const stage = () =>
    document.body.querySelector(".helm-critter-stage")!.textContent;

  it("labels its row Mark, in plain words", async () => {
    await render();
    await commandPeriod();
    expect(row("critter")!.textContent).toContain("Mark");
    expect(row("critter")!.textContent).toContain(
      PROJECT_SIGILS[current()].label,
    );
    // Its label is words in the system font, not drawn letters.
    expect(row("critter")!.querySelector(".helm-label svg")).toBeNull();
    expect(row("critter")!.querySelector(".helm-label")!.textContent).toBe(
      "Mark",
    );
  });

  it("shows every mark by name, opens on the current one, and moves with the arrow keys", async () => {
    await render();
    const at = current();
    expect(at).toBeGreaterThanOrEqual(0);
    await openPicker();
    expect(cells().map((cell) => cell.getAttribute("aria-label"))).toEqual(
      PROJECT_SIGILS.map((sigil) => sigil.label),
    );
    // The cursor and the preview start on the mark standing here.
    expect(document.activeElement).toBe(cells()[at]);
    expect(stage()).toContain(PROJECT_SIGILS[at].label);
    await key("ArrowRight");
    const next = (at + 1) % PROJECT_SIGILS.length;
    expect(document.activeElement).toBe(cells()[next]);
    await key("ArrowDown");
    const below = next + 6 < PROJECT_SIGILS.length ? next + 6 : next % 6;
    expect(document.activeElement).toBe(cells()[below]);
    // The one under the cursor is previewed.
    expect(stage()).toContain(PROJECT_SIGILS[below].label);
  });

  it("forgets the preview on leaving the picker", async () => {
    await render();
    const at = current();
    await openPicker();
    await key("ArrowRight");
    const next = (at + 1) % PROJECT_SIGILS.length;
    expect(stage()).toContain(PROJECT_SIGILS[next].label);
    await key("Escape");
    expect(cursorRow()).toBe("critter");
    await act(async () => row("critter")!.click());
    expect(stage()).toContain(PROJECT_SIGILS[at].label);
  });

  it("saves a project's pick under its critter name, where the project keeps it", async () => {
    await render();
    const next = PROJECT_SIGILS[(current() + 1) % PROJECT_SIGILS.length];
    await openPicker();
    await key("ArrowRight");
    await act(async () =>
      (document.activeElement as HTMLButtonElement).click(),
    );
    const saved = JSON.parse(storage.get("monocode:tab-group:mascots") ?? "{}");
    expect(Object.values(saved)).toEqual([SIGIL_CRITTERS[next.key]]);
    expect(mark().dataset.sigil).toBe(next.key);
    expect(critter().querySelector(".helm-critter-hop")).not.toBeNull();
  });

  it("keeps your own mark for chats outside a project, and any colour saved before", async () => {
    props.critterPath = "~";
    storage.set(
      HELM_CRITTER_KEY,
      JSON.stringify({ mascot: "owl", colorIndex: 3 }),
    );
    await render();
    // Read again, as another window's change would be.
    await act(async () => {
      window.dispatchEvent(new Event(HELM_CRITTER_EVENT));
    });
    // The owl picked before marks reads as the Eye.
    expect(mark().dataset.sigil).toBe("eye");
    await openPicker();
    // Marks have no colour, so the picker offers none.
    expect(document.body.querySelector(".helm-critter-colors")).toBeNull();
    await act(async () =>
      cells()
        .find((cell) => cell.dataset.markChoice === "flag")!
        .click(),
    );
    expect(JSON.parse(storage.get(HELM_CRITTER_KEY)!)).toEqual({
      mascot: "fox",
      colorIndex: 3,
    });
    expect(mark().dataset.sigil).toBe("flag");
    expect(storage.get("monocode:tab-group:mascots")).toBeUndefined();
  });
});

describe("a pane that goes off screen", () => {
  it("takes a clicked-open dialog and the agent panel with it when parked", async () => {
    await render();
    await openByClick();
    expect(dialog()).not.toBeNull();
    props.enabled = false;
    await render();
    // In a portal, it would otherwise float over the chat on screen now.
    expect(dialog()).toBeNull();
    expect(helm().dataset.open).toBeUndefined();

    props.enabled = true;
    await render();
    await openByClick();
    await act(async () => row("model")!.click());
    expect(document.body.querySelector("[data-agent-panel]")).not.toBeNull();
    props.enabled = false;
    await render();
    expect(document.body.querySelector("[data-agent-panel]")).toBeNull();
  });

  it("takes a dialog the pointer opened with it when parked", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await render();
    await act(async () => {
      host.querySelector(".helm-perch")!.dispatchEvent(
        new MouseEvent("pointerover", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );
      vi.advanceTimersByTime(200);
    });
    expect(helm().dataset.open).toBe("hover");
    props.enabled = false;
    await render();
    expect(dialog()).toBeNull();
  });

  it("closes the dialog while the window is hidden", async () => {
    let state: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => state,
    );
    await render();
    await openByClick();
    expect(dialog()).not.toBeNull();
    state = "hidden";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(dialog()).toBeNull();
  });
});

describe("the keyboard around the critter", () => {
  /** Focus as Tab gives it: `:focus-visible` matches. */
  function focusVisible() {
    const matches = Element.prototype.matches;
    vi.spyOn(Element.prototype, "matches").mockImplementation(function (
      this: Element,
      selector: string,
    ) {
      if (selector === ":focus-visible") return this === document.activeElement;
      return matches.call(this, selector);
    });
  }

  it("lets Tab land on the critter without opening the dialog", async () => {
    focusVisible();
    await render();
    await act(async () => critter().focus());
    expect(document.activeElement).toBe(critter());
    expect(dialog()).toBeNull();
    // An arrow key, or Enter and Space (its click), opens it on Model.
    await key("ArrowDown", critter());
    expect(dialog()).not.toBeNull();
    expect(document.activeElement).toBe(row("model"));
  });

  it("takes Shift+Tab back to the critter and Tab back to the message", async () => {
    focusVisible();
    await render();
    field.focus();
    await commandPeriod();
    expect(document.activeElement).toBe(row("model"));
    await act(async () => {
      row("model")!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(critter());

    await key("ArrowDown", critter());
    expect(document.activeElement).toBe(row("model"));
    await key("Tab");
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(field);
  });

  it("takes Tab from the mark picker back to the message", async () => {
    await render();
    field.focus();
    await commandPeriod();
    await key("End");
    await act(async () => row("critter")!.click());
    const cell = document.activeElement!;
    expect(cell.hasAttribute("data-critter-choice")).toBe(true);
    // The marks are the picker's last stop: there are no colours after them.
    await key("Tab", cell);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(field);
  });
});

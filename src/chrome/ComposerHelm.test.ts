// @vitest-environment happy-dom
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
const { PROJECT_MASCOTS } = await import("../lib/projectMascots");
const { HELM_CRITTER_KEY, HELM_DONE_MS } = await import("../lib/composerHelm");
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
const dialog = () => host.querySelector<HTMLElement>("[data-helm-dialog]");
const row = (id: string) =>
  host.querySelector<HTMLButtonElement>(`[data-helm-row="${id}"]`);
const rowIds = () =>
  [...host.querySelectorAll<HTMLElement>("[data-helm-row]")].map(
    (element) => element.dataset.helmRow,
  );
const cursorRow = () =>
  host.querySelector<HTMLElement>("[data-helm-row][data-active]")?.dataset
    .helmRow;
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
async function openByClick() {
  await act(async () => critter().click());
}

describe("the critter's states", () => {
  it("dozes at rest with its zzz and the room bar over its head", async () => {
    await render();
    expect(helm().dataset.pose).toBe("rest");
    expect(host.querySelector(".helm-critter-zzz")).not.toBeNull();
    const bar = host.querySelector<HTMLElement>(".helm-perch-room .helm-room")!;
    expect(bar.querySelectorAll("i[data-lit]")).toHaveLength(3);
    // 77% used: the tip is amber.
    expect(bar.dataset.tone).toBe("amber");
    // Nothing to send yet: the plane is put away.
    expect(
      host.querySelector<HTMLButtonElement>("[data-helm-send]")!.hidden,
    ).toBe(true);
  });

  it("wakes to watch the text and holds the paper plane that sends", async () => {
    props.hasValue = true;
    await render();
    expect(helm().dataset.pose).toBe("typing");
    expect(host.querySelector(".helm-critter-zzz")).toBeNull();
    const plane = host.querySelector<HTMLButtonElement>("[data-helm-send]")!;
    expect(plane.getAttribute("aria-label")).toBe("Send");
    await act(async () => plane.click());
    expect(props.onSend).toHaveBeenCalledOnce();
  });

  it("names the plane for what sending does while the agent works", async () => {
    props.hasValue = true;
    props.busy = true;
    props.sendLabel = "Queue message";
    await render();
    expect(
      host.querySelector("[data-helm-send]")!.getAttribute("aria-label"),
    ).toBe("Queue message");
  });

  it("looks up at its dialog when pointed at", async () => {
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

  it("types at its laptop while the agent works, saying what and how long, with the one Stop", async () => {
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
    expect(host.querySelector(".helm-critter-laptop")).not.toBeNull();
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

  it("sparkles when the turn ends, says how it went, then rests again", async () => {
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
    expect(host.querySelector(".helm-critter-sparkle")).not.toBeNull();
    const bubble = host.querySelector('[data-helm-say="done"]')!;
    expect(bubble.textContent).toContain("Done in 1:12");
    expect(bubble.textContent).toContain("3 files changed");
    await act(async () => vi.advanceTimersByTime(HELM_DONE_MS + 50));
    await render();
    expect(host.querySelector("[data-helm-say]")).toBeNull();
    expect(helm().dataset.pose).toBe("rest");
  });

  it("sweats on a failure and offers the fixes Aven has, until dismissed", async () => {
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
    expect(host.querySelector(".helm-critter-sweat")).not.toBeNull();
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

  it("stands still with reduced motion: no unfurl, the dialog shows at once", async () => {
    reducedMotion = true;
    await render();
    expect(helm().dataset.reduced).toBe("true");
    await openByClick();
    expect(dialog()).not.toBeNull();
    expect(animate).not.toHaveBeenCalled();
  });

  it("unfurls the dialog from its tail in stepped frames", async () => {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(320);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(180);
    await render();
    await openByClick();
    expect(animate).toHaveBeenCalledOnce();
    const [frames, timing] = animate.mock.calls[0] as [
      Keyframe[],
      KeyframeAnimationOptions,
    ];
    expect(frames[0]).toMatchObject({ width: "0px", height: "0px" });
    expect(frames.at(-1)).toMatchObject({ width: "320px", height: "180px" });
    expect(
      frames.slice(0, -1).every((frame) => frame.easing === "step-end"),
    ).toBe(true);
    expect(timing.duration).toBeLessThanOrEqual(240);
  });

  it("pauses while the window is hidden or the pane is parked", async () => {
    props.enabled = false;
    await render();
    expect(helm().dataset.paused).toBe("true");
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
    // The dialog sits in the perch above the box, never over the text.
    expect(dialog()!.closest(".composer-helm")).not.toBeNull();
  });

  it("is named for what it holds, without a tooltip", async () => {
    await render();
    expect(critter().getAttribute("aria-label")).toBe(
      "Message settings, Claude Opus 5.5, Max effort, Full access, 23% room left",
    );
    expect(critter().getAttribute("title")).toBeNull();
    expect(critter().getAttribute("aria-haspopup")).toBe("dialog");
  });

  it("opens with Cmd+. and moves its ▶ cursor with the arrow keys", async () => {
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

  it("keeps the + menu's modes on a page of their own", async () => {
    await render();
    await commandPeriod();
    await key("End");
    await key("ArrowUp");
    expect(cursorRow()).toBe("modes");
    await act(async () => row("modes")!.click());
    const page = host.querySelector<HTMLElement>("[data-composer-plus]")!;
    expect(page.getAttribute("aria-label")).toBe("Modes");
    expect(host.querySelector("[data-composer-plan]")!.textContent).toContain(
      "Plan mode",
    );
    expect(document.activeElement).toBe(
      host.querySelector("[data-composer-plan]"),
    );
    await key("ArrowDown");
    expect(document.activeElement).toBe(
      host.querySelector("[data-composer-race]"),
    );
    // Escape steps back to the row it came from.
    await key("Escape");
    expect(host.querySelector("[data-composer-plus]")).toBeNull();
    expect(cursorRow()).toBe("modes");
    await act(async () => row("modes")!.click());
    await act(async () =>
      host.querySelector<HTMLButtonElement>("[data-composer-race]")!.click(),
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
    expect(host.querySelector("[data-composer-plus]")).toBeNull();
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
      host
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

describe("choosing the critter", () => {
  async function openPicker() {
    await commandPeriod();
    await key("End");
    await act(async () => row("critter")!.click());
  }
  const cells = () => [
    ...host.querySelectorAll<HTMLButtonElement>("[data-critter-choice]"),
  ];

  it("shows every critter by name and moves through them with the arrow keys", async () => {
    await render();
    await openPicker();
    expect(cells().map((cell) => cell.getAttribute("aria-label"))).toEqual(
      PROJECT_MASCOTS.map((mascot) => mascot.label),
    );
    expect(document.activeElement).toBe(cells()[0]);
    await key("ArrowRight");
    expect(document.activeElement).toBe(cells()[1]);
    await key("ArrowDown");
    expect(document.activeElement).toBe(cells()[7]);
    // The one under the cursor is previewed, stepping its frames.
    expect(host.querySelector(".helm-critter-stage")!.textContent).toContain(
      PROJECT_MASCOTS[7].label,
    );
  });

  it("saves a project's pick where the project keeps its critter, with a hop", async () => {
    await render();
    await openPicker();
    await key("ArrowRight");
    await act(async () =>
      (document.activeElement as HTMLButtonElement).click(),
    );
    const saved = JSON.parse(storage.get("monocode:tab-group:mascots") ?? "{}");
    expect(Object.values(saved)).toEqual([PROJECT_MASCOTS[1].name]);
    expect(
      critter().querySelector(".helm-critter")!.getAttribute("data-critter"),
    ).toBe(PROJECT_MASCOTS[1].name);
    expect(critter().querySelector(".helm-critter-hop")).not.toBeNull();
  });

  it("keeps your own critter for chats outside a project", async () => {
    props.critterPath = "~";
    await render();
    expect(
      critter().querySelector(".helm-critter")!.getAttribute("data-critter"),
    ).toBe("owl");
    await openPicker();
    await act(async () =>
      cells()
        .find((cell) => cell.dataset.critterChoice === "fox")!
        .click(),
    );
    expect(JSON.parse(storage.get(HELM_CRITTER_KEY)!)).toMatchObject({
      mascot: "fox",
    });
    expect(
      critter().querySelector(".helm-critter")!.getAttribute("data-critter"),
    ).toBe("fox");
    expect(storage.get("monocode:tab-group:mascots")).toBeUndefined();
  });

  it("reuses the project's colours", async () => {
    await render();
    await openPicker();
    const swatches = host.querySelectorAll(
      ".helm-critter-colors button[aria-label^='Color']",
    );
    expect(swatches.length).toBeGreaterThan(5);
    await act(async () => (swatches[2] as HTMLButtonElement).click());
    const saved = JSON.parse(storage.get("monocode:tab-group:colors") ?? "{}");
    expect(Object.values(saved).map(Number)).toEqual([2]);
  });
});

// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Popover, type PopoverDismissReason } from "./Popover";

const native = vi.hoisted(() => ({
  enabled: false,
  focus: vi.fn<() => Promise<void>>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => native.enabled }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setFocus: native.focus }),
}));
afterEach(() => {
  native.enabled = false;
  native.focus.mockReset();
});

describe("popover focus leaving the main webview", () => {
  let root: Root;
  let container: HTMLDivElement;
  let anchor: HTMLButtonElement;
  const dismissed = vi.fn();

  function Harness() {
    const [open, setOpen] = useState(true);
    return open
      ? createElement(
          Popover,
          {
            anchor,
            role: "dialog",
            "aria-label": "Options",
            onDismiss: (reason: PopoverDismissReason) => {
              dismissed(reason);
              setOpen(false);
            },
          },
          createElement("input", { "aria-label": "First field" }),
          createElement("input", { "aria-label": "Second field" }),
        )
      : null;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    anchor = document.createElement("button");
    document.body.append(anchor, container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    anchor.remove();
    vi.unstubAllGlobals();
  });

  it("dismisses as outside when the window loses focus", async () => {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => window.dispatchEvent(new FocusEvent("blur")));
    expect(dismissed).toHaveBeenCalledExactlyOnceWith("outside");
    expect(document.querySelector('[aria-label="Options"]')).toBeNull();
    expect(document.activeElement).not.toBe(anchor);
  });

  it("keeps the popover open while focus moves between its fields", async () => {
    await act(async () => root.render(createElement(Harness)));
    const first = document.querySelector<HTMLInputElement>(
      '[aria-label="First field"]',
    )!;
    const second = document.querySelector<HTMLInputElement>(
      '[aria-label="Second field"]',
    )!;
    await act(async () => {
      first.focus();
      second.focus();
      first.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    });
    expect(dismissed).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label="Options"]')).not.toBeNull();
    expect(document.activeElement).toBe(second);
  });

  it("removes the window listener when the popover unmounts", async () => {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => root.render(null));
    window.dispatchEvent(new FocusEvent("blur"));
    expect(dismissed).not.toHaveBeenCalled();
  });
});

describe("popover autofocus", () => {
  let root: Root;
  let anchor: HTMLButtonElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    anchor = document.createElement("button");
    document.body.append(anchor);
    root = createRoot(document.createElement("div"));
    // Like a real browser: focus does nothing while the popover is still
    // hidden for measuring.
    const focus = HTMLElement.prototype.focus;
    vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (
      this: HTMLElement,
      options?: FocusOptions,
    ) {
      if (this.closest<HTMLElement>('[style*="visibility: hidden"]')) return;
      focus.call(this, options);
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    anchor.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("takes focus once it is placed and visible", async () => {
    await act(async () =>
      root.render(
        createElement(
          Popover,
          { anchor, autoFocus: true, tabIndex: -1, "aria-label": "Menu" },
          createElement("button", null, "Item"),
        ),
      ),
    );
    expect(document.activeElement).toBe(
      document.querySelector('[aria-label="Menu"]'),
    );
  });
  it("hands keyboard input from Chromium to the app once after opening", async () => {
    native.enabled = true;
    native.focus.mockResolvedValue(undefined);
    await act(async () =>
      root.render(
        createElement(
          Popover,
          {
            anchor,
            autoFocus: true,
            initialFocus: "input",
            tabIndex: -1,
          },
          createElement("input", { "aria-label": "Search menu" }),
        ),
      ),
    );
    expect(native.focus).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(
      document.querySelector('[aria-label="Search menu"]'),
    );
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(native.focus).toHaveBeenCalledOnce();
  });

  it.each(["outside", "unmount"])(
    "does not reclaim input after a late native focus response and %s",
    async (exit) => {
      native.enabled = true;
      let finish!: () => void;
      native.focus.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      await act(async () =>
        root.render(
          createElement(
            Popover,
            {
              anchor,
              autoFocus: true,
              initialFocus: "input",
              tabIndex: -1,
            },
            createElement("input", { "aria-label": "Search menu" }),
          ),
        ),
      );
      const search = document.querySelector<HTMLInputElement>(
        '[aria-label="Search menu"]',
      )!;
      const refocus = vi.fn(search.focus.bind(search));
      search.focus = refocus;
      if (exit === "unmount") await act(async () => root.render(null));
      await act(async () => {
        anchor.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true }),
        );
        anchor.focus();
        finish();
      });
      expect(document.activeElement).toBe(anchor);
      expect(refocus).not.toHaveBeenCalled();
    },
  );
});

describe("panel popover material", () => {
  let root: Root;
  let anchor: HTMLButtonElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    anchor = document.createElement("button");
    document.body.append(anchor);
    root = createRoot(document.createElement("div"));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    anchor.remove();
    vi.unstubAllGlobals();
  });

  it("paints the panel surface on the still frame, outside the animated content", async () => {
    await act(async () =>
      root.render(
        createElement(
          Popover,
          { anchor, panel: true, "aria-label": "Panel menu" },
          createElement("div", {
            className: "toolbar-panel",
            style: { "--toolbar-panel-bg": "rgb(1, 2, 3)" },
          }),
        ),
      ),
    );
    const content = document.querySelector<HTMLElement>(
      '[aria-label="Panel menu"]',
    )!;
    const frame = content.parentElement!;
    expect(frame.classList).toContain("aven-popover-panel");
    const backdrop = frame.querySelector(".aven-popover-panel-backdrop");
    expect(backdrop?.parentElement).toBe(frame);
    expect(content.contains(backdrop)).toBe(false);
    expect(content.classList).toContain("popover-open");
    expect(frame.style.getPropertyValue("--aven-popover-panel-bg")).toBe(
      "rgb(1, 2, 3)",
    );
    expect(frame.style.opacity).toBe("");
  });

  it("keeps the opaque backdrop for ordinary popovers", async () => {
    await act(async () =>
      root.render(
        createElement(Popover, { anchor, "aria-label": "Menu" }, "Item"),
      ),
    );
    const frame = document.querySelector('[aria-label="Menu"]')!.parentElement!;
    expect(frame.querySelector(":scope > .popover-backdrop")).not.toBeNull();
    expect(frame.querySelector(".aven-popover-panel-backdrop")).toBeNull();
  });
});

describe("popover stylesheet", () => {
  const motion = readFileSync("src/motion.css", "utf8");
  const mac = readFileSync("src/macos-theme.css", "utf8");
  const rule = (css: string, selector: string) => {
    const at = css.indexOf(`${selector} {`);
    if (at < 0) throw new Error(`Missing rule ${selector}`);
    return css.slice(at, css.indexOf("}", at));
  };
  const token = (name: string) =>
    Number(new RegExp(`${name}: (\\d+)ms`).exec(rule(motion, ":root"))?.[1]);

  it("opens quickly, gently and without an empty-frame first frame", () => {
    const open = rule(motion, ".popover-open");
    expect(open).toContain(
      "animation: popover-open var(--aven-motion-fast) var(--aven-ease-out)",
    );
    expect(token("--aven-motion-fast")).toBeGreaterThanOrEqual(100);
    expect(token("--aven-motion-fast")).toBeLessThanOrEqual(120);
    const keyframes = motion.slice(motion.indexOf("@keyframes popover-open"));
    const from = keyframes.slice(0, keyframes.indexOf("}"));
    expect(Number(/opacity: ([\d.]+)/.exec(from)?.[1])).toBeGreaterThan(0);
    // Reduce motion zeroes the duration.
    expect(rule(motion, ':root[data-motion="reduce"]')).toContain(
      "--aven-motion-fast: 0ms;",
    );
  });

  it("springs its frame in by scale alone, so it is solid from the first frame", () => {
    expect(
      rule(motion, ".aven-popover-frame,\n.modal-panel,\n.discussion-float"),
    ).toContain(
      "animation: aven-pop var(--aven-motion-base) var(--aven-ease-spring)",
    );
    const pop = motion.slice(motion.indexOf("@keyframes aven-pop"));
    const from = pop.slice(0, pop.indexOf("}"));
    // It grows out of its control from a scale set once in :root, small
    // enough to read as growing and large enough to stay gentle.
    expect(from).toContain("transform: scale(var(--aven-pop-scale));");
    const scale = Number(
      /--aven-pop-scale: ([\d.]+);/.exec(rule(motion, ":root"))?.[1],
    );
    expect(scale).toBeGreaterThanOrEqual(0.92);
    expect(scale).toBeLessThan(1);
    // Both ways of reducing motion leave it at full size: Aven's switch and
    // the system's setting.
    expect(rule(motion, ':root[data-motion="reduce"]')).toContain(
      "--aven-pop-scale: 1;",
    );
    const system = motion.slice(
      motion.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(system.slice(0, system.indexOf("}"))).toContain(
      "--aven-pop-scale: 1;",
    );
    expect(from).not.toContain("opacity");
  });

  it("gives a dark panel popover a solid frame, never a see-through one", () => {
    const frame = rule(mac, ".aven-popover-panel-backdrop");
    expect(frame).toContain(
      "background: var(--aven-popover-panel-bg, var(--aven-popup));",
    );
    expect(frame).not.toContain("backdrop-filter");
    const inner = rule(
      mac,
      '.aven-popover-panel-content\n  > .toolbar-panel:not([data-theme="light"])',
    );
    expect(inner).toContain("backdrop-filter: none;");
    expect(inner).toContain("background: transparent;");
    // Declared after the shared ToolbarPanel glass, which it overrides.
    expect(mac.indexOf(inner)).toBeGreaterThan(
      mac.indexOf('  .toolbar-panel:not([data-theme="light"]) {'),
    );
  });
});

describe("popover content changes", () => {
  let root: Root;
  let anchor: HTMLButtonElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("innerHeight", 800);
    anchor = document.createElement("button");
    document.body.append(anchor);
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(
      new DOMRect(20, 600, 80, 20),
    );
    // Layout stand-in: each row is 50px tall.
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.querySelectorAll("li").length * 50;
      },
    );
    root = createRoot(document.createElement("div"));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    anchor.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const render = (rows: number) =>
    act(async () =>
      root.render(
        createElement(
          Popover,
          { anchor, "aria-label": "Paged menu" },
          createElement(
            "ul",
            null,
            Array.from({ length: rows }, (_, index) =>
              createElement("li", { key: index }, `Row ${index}`),
            ),
          ),
        ),
      ),
    );

  it("re-places a longer page in the same pass, without remounting", async () => {
    await render(2);
    const content = document.querySelector<HTMLElement>(
      '[aria-label="Paged menu"]',
    )!;
    expect(content.parentElement!.dataset.popoverSide).toBe("bottom");
    await render(6);
    expect(document.querySelector('[aria-label="Paged menu"]')).toBe(content);
    // 300px no longer fits below the trigger, so it flips above it.
    expect(content.parentElement!.dataset.popoverSide).toBe("top");
    expect(content.classList).toContain("popover-open");
  });
});

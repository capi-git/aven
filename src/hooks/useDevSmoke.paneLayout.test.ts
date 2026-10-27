// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/harness/child", () => ({ resolveClaudeBinary: vi.fn() }));
vi.mock("../lib/floatingSidebar", () => ({
  nativeFloatingSidebar: { send: vi.fn(), listen: vi.fn() },
}));

import { paneLayoutProblem, singlePaneProblem } from "./useDevSmoke";

type Box = { left: number; top: number; width: number; height: number };

const boxes = new Map<Element, Box>();
function measure() {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const box = boxes.get(this) ?? { left: 0, top: 0, width: 1, height: 1 };
      return new DOMRect(box.left, box.top, box.width, box.height);
    },
  );
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (
    this: Element,
  ) {
    return [this.getBoundingClientRect()] as unknown as DOMRectList;
  });
}
const at = (selector: string, box: Box) =>
  boxes.set(document.querySelector(selector)!, box);

/** A tab holding a chat beside a file, measured as on screen. */
function layout({
  chatStrips = 1,
  fileNameStrip = false,
  floating = false,
  chip = false,
  stripHeight = 32,
  radius = "0px",
  edge = "0px",
  inset = 0,
  divider = 0.5,
  hairlines = true,
  fileTabHeight = 26,
} = {}) {
  const hairline = hairlines
    ? "box-shadow:inset 0 -0.5px 0 rgba(255,255,255,0.2)"
    : "";
  const strip = `
    <div class="aven-tab-bar" data-pane-strip
      style="position:${floating ? "absolute" : "relative"};${hairline}">
      <div class="aven-tab"><div class="aven-tab-button" data-chat-tab
        style="border-top-left-radius:6px"></div></div>
    </div>`;
  document.body.innerHTML = `
    <div data-workspace-stage>
      <div class="workspace-stage-surface" data-workspace-surface="tab"
        style="border-top-left-radius:${radius};border-top-width:${edge}">
        <div data-tree>
          <div data-pane-id="chat">
            <div data-session-drop="chat">
              ${chip ? "<div data-session-pane-controls></div>" : ""}
              ${strip.repeat(chatStrips)}
              <div data-chat-content></div>
            </div>
          </div>
          <div data-pane-id="files">
            ${fileNameStrip ? '<div class="aven-tab-bar" data-file-name-strip></div>' : ""}
            <div class="aven-surface-tabs aven-tab-bar" style="${hairline}"><button
              class="aven-tab-button" data-file-tab
              style="border-top-left-radius:6px"></button></div>
            <div data-file-body></div>
          </div>
          <div role="separator" aria-orientation="vertical" data-divider></div>
        </div>
      </div>
      <div data-workspace-header="tab" style="${hairline}"><button
        class="aven-tab-button" data-header-tab
        style="border-top-left-radius:6px"></button></div>
    </div>`;
  boxes.clear();
  at("[data-workspace-stage]", { left: 0, top: 0, width: 1000, height: 600 });
  at(".workspace-stage-surface", {
    left: inset,
    top: inset,
    width: 1000 - 2 * inset,
    height: 600 - 2 * inset,
  });
  at("[data-workspace-header]", { left: 0, top: 0, width: 1000, height: 32 });
  at("[data-header-tab]", { left: 6, top: 3, width: 200, height: 26 });
  document.querySelectorAll("[data-pane-strip]").forEach((element, index) =>
    boxes.set(element, {
      left: 0,
      top: 32 + index * stripHeight,
      width: 500,
      height: stripHeight,
    }),
  );
  document
    .querySelectorAll("[data-chat-tab]")
    .forEach((tab) =>
      boxes.set(tab, { left: 6, top: 35, width: 200, height: 26 }),
    );
  // A floating strip lies over the content, which starts at the pane's top.
  at("[data-chat-content]", {
    left: 0,
    top: floating ? 32 : 32 + chatStrips * stripHeight,
    width: 500,
    height: 400,
  });
  at(".aven-surface-tabs", { left: 500, top: 32, width: 500, height: 32 });
  at("[data-file-tab]", {
    left: 506,
    top: 35,
    width: 200,
    height: fileTabHeight,
  });
  at("[data-file-body]", { left: 500, top: 64, width: 500, height: 536 });
  at("[data-divider]", { left: 500, top: 32, width: divider, height: 568 });
  measure();
  return document.querySelector<HTMLElement>("[data-file-body]")!;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("paneLayoutProblem", () => {
  it("passes one strip per pane above its content, flush panes and matching tabs", () => {
    const result = paneLayoutProblem(layout());
    expect(result.problem).toBeNull();
    expect(result.summary).toBe(
      "one 32px strip per pane above its content, each over a hairline; square panes flush with the workspace, divided by a 0.5px hairline; tab, chat and file tabs 26px tall, 6px corners",
    );
    // Under Increase contrast, or on a 1x screen, the hairline is a full pixel.
    expect(paneLayoutProblem(layout({ divider: 1 })).problem).toBeNull();
  });

  it("names a missing, doubled or floating strip and the old chip", () => {
    expect(paneLayoutProblem(layout({ chatStrips: 0 })).problem).toBe(
      "the chat has 0 strips, not one",
    );
    expect(paneLayoutProblem(layout({ chatStrips: 2 })).problem).toBe(
      "the chat has 2 strips, not one",
    );
    expect(paneLayoutProblem(layout({ fileNameStrip: true })).problem).toBe(
      "the file has 2 strips, not one",
    );
    expect(paneLayoutProblem(layout({ floating: true })).problem).toBe(
      "the chat's strip floats over its content",
    );
    expect(paneLayoutProblem(layout({ chip: true })).problem).toBe(
      "the chat still has the floating chip",
    );
  });

  it("names a strip over content, the old cards, missing hairlines and mismatched tabs", () => {
    const file = layout();
    at("[data-chat-content]", { left: 0, top: 44, width: 500, height: 400 });
    expect(paneLayoutProblem(file).problem).toBe(
      "the chat's strip covers 20px of its content",
    );
    // The iOS look's floating cards: rounded, edged and inset.
    expect(paneLayoutProblem(layout({ radius: "11px" })).problem).toBe(
      "the pane's corners are 11px",
    );
    expect(paneLayoutProblem(layout({ edge: "1px" })).problem).toBe(
      "the pane has a 1px edge of its own",
    );
    expect(paneLayoutProblem(layout({ inset: 5 })).problem).toBe(
      "the pane is 5px from the workspace edge",
    );
    expect(paneLayoutProblem(layout({ divider: 8 })).problem).toBe(
      "the divider between the panes is 8px thick",
    );
    expect(paneLayoutProblem(layout({ hairlines: false })).problem).toBe(
      "the chat's strip has no hairline under it",
    );
    expect(paneLayoutProblem(layout({ stripHeight: 24 })).problem).toBe(
      "the tab's bar is 32px, the chat's strip 24px and the file's 32px",
    );
    expect(paneLayoutProblem(layout({ fileTabHeight: 32 })).problem).toBe(
      "the tab is 26px tall, 6px corners and the file's is 32px tall, 6px corners",
    );
  });
});

describe("singlePaneProblem", () => {
  function lone(strip: boolean) {
    document.body.innerHTML = `
      <div data-workspace-stage>
        <div class="workspace-stage-surface" data-workspace-surface="tab">
          <div data-pane-id="chat">
            <div data-session-drop="chat">
              ${strip ? '<div class="aven-tab-bar" data-pane-strip></div>' : ""}
              <div data-chat-content></div>
            </div>
          </div>
        </div>
      </div>`;
    measure();
    return document.querySelector<HTMLElement>("[data-session-drop]")!;
  }

  it("passes a chat alone in its tab without a strip and names one with it", () => {
    expect(singlePaneProblem(lone(false))).toBeNull();
    expect(singlePaneProblem(lone(true))).toBe(
      "a chat alone in its tab shows 1 strip",
    );
  });
});

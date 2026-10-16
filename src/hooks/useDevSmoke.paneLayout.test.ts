// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/harness/child", () => ({ resolveClaudeBinary: vi.fn() }));
vi.mock("../lib/floatingSidebar", () => ({
  nativeFloatingSidebar: { send: vi.fn(), listen: vi.fn() },
}));

import { paneLayoutProblem } from "./useDevSmoke";

type Box = { left: number; top: number; width: number; height: number };

/** A tab holding a chat beside a discussion's page, measured as on screen. */
function layout({
  controlsInRow = false,
  radius = "12px",
  inset = 5,
  pageTabHeight = 26,
} = {}) {
  document.body.innerHTML = `
    <div data-workspace-stage>
      <div class="workspace-stage-surface" data-workspace-surface="tab"
        style="border-top-left-radius:${radius};border-top-width:1px">
        <div data-pane-id="chat">
          <div data-session-drop="chat">
            <div data-session-pane-controls
              style="position:${controlsInRow ? "static" : "absolute"}"></div>
            <div data-chat-content style="position:relative"></div>
          </div>
        </div>
        <div data-pane-id="files">
          <div class="aven-surface-tabs"><button class="aven-tab-button"
            data-page-tab style="border-top-left-radius:6px"></button></div>
          <div data-discussion-view="d"></div>
        </div>
      </div>
      <div data-workspace-header="tab"><button class="aven-tab-button"
        style="border-top-left-radius:6px"></button></div>
    </div>`;
  const boxes = new Map<Element, Box>();
  const at = (selector: string, box: Box) =>
    boxes.set(document.querySelector(selector)!, box);
  at("[data-workspace-stage]", { left: 0, top: 0, width: 1000, height: 600 });
  at(".workspace-stage-surface", {
    left: inset,
    top: inset,
    width: 1000 - 2 * inset,
    height: 600 - 2 * inset,
  });
  at("[data-session-drop]", { left: 6, top: 38, width: 500, height: 560 });
  at("[data-session-pane-controls]", {
    left: 400,
    top: 44,
    width: 80,
    height: 24,
  });
  at("[data-chat-content]", {
    left: 6,
    top: controlsInRow ? 74 : 38,
    width: 500,
    height: 400,
  });
  at("[data-workspace-header]", { left: 6, top: 6, width: 988, height: 32 });
  at(".aven-surface-tabs", { left: 507, top: 38, width: 488, height: 32 });
  at("[data-workspace-header] .aven-tab-button", {
    left: 12,
    top: 9,
    width: 200,
    height: 26,
  });
  at("[data-page-tab]", {
    left: 513,
    top: 41,
    width: 200,
    height: pageTabHeight,
  });
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
  return document.querySelector<HTMLElement>("[data-discussion-view]")!;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("paneLayoutProblem", () => {
  it("passes one bar per pane, a card clear of the edge and matching tabs", () => {
    const result = paneLayoutProblem(layout());
    expect(result.problem).toBeNull();
    expect(result.summary).toBe(
      "one bar per pane; cards with 12px corners 5px from the edge; chat and page tabs 26px tall, 6px corners",
    );
  });

  it("names a second header row, square or edge-to-edge panes and mismatched tabs", () => {
    expect(paneLayoutProblem(layout({ controlsInRow: true })).problem).toBe(
      "the split chat's controls take a row of their own",
    );
    expect(paneLayoutProblem(layout({ radius: "0px" })).problem).toBe(
      "the pane's corners are 0px",
    );
    expect(paneLayoutProblem(layout({ inset: 0 })).problem).toBe(
      "the card is 0px from the workspace edge",
    );
    expect(paneLayoutProblem(layout({ pageTabHeight: 32 })).problem).toBe(
      "the chat's tab is 26px tall, 6px corners and the page's is 32px tall, 6px corners",
    );
  });
});

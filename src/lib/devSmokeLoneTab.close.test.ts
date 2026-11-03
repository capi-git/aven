// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import {
  closeCheckPage,
  stripPlace,
  type SmokeLoneTab,
} from "./devSmokeLoneTab";

type Strip = ReturnType<SmokeLoneTab["strip"]>;

/**
 * The workspace as the check drives it: closing a page changes nothing
 * drawn until a later task (React draws after the step's own code has run
 * on).
 */
function workspace(strip: Strip) {
  let drawn = strip;
  const pane = document.createElement("div");
  pane.dataset.browserPane = "page";
  document.body.append(pane);
  const loneTab: SmokeLoneTab = {
    select: () => {},
    split: () => {},
    panes: () => [],
    strip: () => drawn,
    closePage: (id) => {
      setTimeout(() => {
        drawn = drawn.flatMap((entry) =>
          "id" in entry
            ? entry.id === id
              ? []
              : [entry]
            : entry.split
                .filter((tab) => tab !== id)
                .map((tab) => ({ id: tab })),
        );
        document.querySelector(`[data-browser-pane="${id}"]`)?.remove();
      }, 20);
    },
  };
  return { get: () => ({ loneTab }), drawn: () => drawn };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("a check's page closed as its step ends", () => {
  it("reads where the strip holds a tab", () => {
    const strip: Strip = [{ id: "a" }, { split: ["chat", "page"] }];
    expect(stripPlace(strip, "a")).toBe("alone");
    expect(stripPlace(strip, "page")).toBe("split");
    expect(stripPlace(strip, "gone")).toBeNull();
  });

  it("is gone before the next step starts", async () => {
    // 0.1.160's trial: the next step began straight after the close, found
    // the page still drawn in front and took it for its own.
    const { get, drawn } = workspace([
      { id: "other" },
      { split: ["chat", "page"] },
    ]);
    const closing = closeCheckPage(get, "page");
    // As the next step would have seen it, at once.
    expect(stripPlace(drawn(), "page")).toBe("split");
    expect(document.querySelector('[data-browser-pane="page"]')).not.toBeNull();
    await closing;
    expect(drawn()).toEqual([{ id: "other" }, { id: "chat" }]);
    expect(document.querySelector('[data-browser-pane="page"]')).toBeNull();
  });
});

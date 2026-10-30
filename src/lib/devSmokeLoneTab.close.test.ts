// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import {
  closeCheckPage,
  dismissLayoutNotice,
  stripPlace,
  type SmokeLoneTab,
} from "./devSmokeLoneTab";

type Strip = ReturnType<SmokeLoneTab["strip"]>;

/** A notice after a move, as the workspace draws it, with its cross. */
function showNotice(text: string) {
  const notice = document.createElement("div");
  notice.dataset.layoutNotice = "";
  notice.setAttribute("data-native-browser-occluded", "true");
  const words = document.createElement("p");
  words.className = "aven-layout-notice-text";
  words.textContent = text;
  const cross = document.createElement("button");
  cross.setAttribute("aria-label", "Dismiss");
  cross.addEventListener("click", () => notice.remove());
  notice.append(words, cross);
  document.body.append(notice);
  return notice;
}

/**
 * The workspace as the check drives it: closing a page changes nothing
 * drawn until a later task (React draws after the step's own code has run
 * on), and a page closed out of a split of two leaves the notice that says
 * what stayed, a moment after that.
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
      const split = stripPlace(drawn, id) === "split";
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
        if (split)
          setTimeout(
            () =>
              showNotice(
                "Closed “Aven check page”. “New chat” stays on its own, where the split was.",
              ),
            30,
          );
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

  it("is gone, with its notice put away, before the next step starts", async () => {
    // 0.1.160's trial: the next step began straight after the close, found
    // the page still drawn in front and took it for its own; and the notice
    // that the split came apart was cut out of the next page for 6 s.
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
    expect(document.querySelector("[data-layout-notice]")).toBeNull();
  });

  it("waits for no notice when the page stood alone", async () => {
    const { get, drawn } = workspace([{ id: "chat" }, { id: "page" }]);
    const started = Date.now();
    await closeCheckPage(get, "page");
    expect(drawn()).toEqual([{ id: "chat" }]);
    expect(Date.now() - started).toBeLessThan(900);
  });

  it("puts away a notice that is up, and does nothing when none is", async () => {
    await dismissLayoutNotice();
    showNotice("Moved “Aven check page” out of the split with “New chat”.");
    await dismissLayoutNotice();
    expect(document.querySelector("[data-layout-notice]")).toBeNull();
  });
});

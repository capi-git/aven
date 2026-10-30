import { describe, expect, it } from "vitest";
import {
  foldedPageProblem,
  railProblem,
  reopenedProblem,
  reshownPageProblem,
} from "./devSmokeRail";

describe("the real-app check's rail", () => {
  const hidden = { width: 0, hidden: true };
  it("passes a page folded to a 28px rail beside the chat with the room", () => {
    expect(
      railProblem(
        { width: 27, hidden: false },
        hidden,
        { width: 872, hidden: false },
        900,
      ),
    ).toBeNull();
  });

  it("names what is wrong with a fold", () => {
    expect(railProblem(null, hidden, { width: 900, hidden: false }, 900)).toBe(
      "the page has no rail",
    );
    expect(
      railProblem(
        { width: 60, hidden: false },
        hidden,
        { width: 840, hidden: false },
        900,
      ),
    ).toBe("the rail is 60px wide, not about 28px");
    expect(
      railProblem(
        { width: 27, hidden: false },
        { width: 4, hidden: false },
        { width: 868, hidden: false },
        900,
      ),
    ).toBe("the page's pane is still on screen");
    expect(
      railProblem(
        { width: 27, hidden: false },
        hidden,
        { width: 450, hidden: false },
        900,
      ),
    ).toBe("the chat has 450px of 900px");
  });

  it("passes the page open again at about half, and names what is not", () => {
    expect(
      reopenedProblem(null, { width: 450, hidden: false }, 900),
    ).toBeNull();
    expect(reopenedProblem({ width: 27, hidden: false }, hidden, 900)).toBe(
      "the page's rail is still there",
    );
    expect(reopenedProblem(null, { width: 120, hidden: false }, 900)).toBe(
      "the page came back at 13% of the stage, not about half",
    );
  });

  const record = (visible: boolean, width = 450) => ({
    visible,
    bounds: { x: 1000 - width, width },
  });

  it("passes a folded page whose live view is hidden, and names one still drawn", () => {
    expect(foldedPageProblem(record(false), "while held")).toBeNull();
    expect(foldedPageProblem(record(true, 172), "while held")).toBe(
      "while held, the live page was still drawn, 172px wide at x 828, though its pane had folded to its rail",
    );
    expect(foldedPageProblem(undefined, "while held")).toBe(
      "while held, the page had sent its native view nothing",
    );
  });

  it("passes the live page drawn again at about its width, and names what is not", () => {
    expect(reshownPageProblem(record(true, 440), 450)).toBeNull();
    expect(reshownPageProblem(record(false), 450)).toBe(
      "the live page is still hidden",
    );
    expect(reshownPageProblem(record(true, 200), 450)).toBe(
      "the live page came back 200px wide, not about the 450px it had",
    );
    expect(reshownPageProblem(undefined, 450)).toBe(
      "the page sent its native view nothing",
    );
  });
});

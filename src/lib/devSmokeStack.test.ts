import { describe, expect, it } from "vitest";
import { longestMs, stackProblem, type StackReading } from "./devSmokeStack";

const turned = (degrees: number) => {
  if (!degrees) return "none";
  const radians = (degrees * Math.PI) / 180;
  const [cos, sin] = [Math.cos(radians), Math.sin(radians)];
  return `matrix(${cos}, ${sin}, ${-sin}, ${cos}, 1.5, 0.4)`;
};

const reading = (patch: Partial<StackReading> = {}): StackReading => ({
  kind: "stack",
  animations: [],
  back: "none",
  middle: "none",
  durations: ["0.16s", "0.16s"],
  ...patch,
});

const motion = { open: false, reducedMotion: false };

describe("reading the Stack in the real app", () => {
  it("passes a still Stack, closed or fanned", () => {
    expect(stackProblem(reading(), motion)).toBeNull();
    expect(
      stackProblem(reading({ back: turned(-14), middle: turned(-6) }), {
        ...motion,
        open: true,
      }),
    ).toBeNull();
  });

  it("says when the mark is missing or isn't a Stack", () => {
    expect(stackProblem(null, motion)).toBe("is missing");
    expect(stackProblem(reading({ kind: "mark" }), motion)).toBe(
      "is not a Stack (it is mark)",
    );
  });

  it("says when it moves on its own", () => {
    expect(
      stackProblem(reading({ animations: ["dot-mark-sweep"] }), motion),
    ).toBe("moves (dot-mark-sweep)");
  });

  it("says when its pages are not fanned as the project is", () => {
    expect(stackProblem(reading(), { ...motion, open: true })).toBe(
      "has its back page at 0.0°, expected -14° while the project is open",
    );
    expect(
      stackProblem(reading({ back: turned(-14), middle: turned(-6) }), motion),
    ).toBe(
      "has its back page at -14.0°, expected 0° while the project is closed",
    );
    // Half-way through the fan is not there yet.
    expect(
      stackProblem(reading({ back: turned(-14), middle: turned(-3) }), {
        ...motion,
        open: true,
      }),
    ).toContain("middle page at -3.0°");
    expect(stackProblem(reading({ back: "rotate(-14deg)" }), motion)).toContain(
      "can't read",
    );
  });

  it("wants the fan eased unless Reduce motion is on", () => {
    expect(stackProblem(reading({ durations: ["0s", "0s"] }), motion)).toBe(
      "fans without easing",
    );
    expect(
      stackProblem(reading({ durations: ["0s", "0s"] }), {
        ...motion,
        reducedMotion: true,
      }),
    ).toBeNull();
    expect(
      stackProblem(reading(), { ...motion, reducedMotion: true }),
    ).toContain("with reduced motion on");
  });

  it("reads CSS times", () => {
    expect(longestMs("0.16s")).toBe(160);
    expect(longestMs("160ms, 0s")).toBe(160);
    expect(longestMs("0s")).toBe(0);
    expect(longestMs("")).toBe(0);
  });
});

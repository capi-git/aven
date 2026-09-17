import { describe, expect, it, vi } from "vitest";
import {
  createWorkspacePipReturns,
  type PipGroupTarget,
} from "./workspacePictureInPicture";

const entries = [
  {
    label: "session-a",
    target: { kind: "session", id: "a", surfaceId: "tab-a" },
  },
  {
    label: "session-b",
    target: { kind: "session", id: "b", surfaceId: "tab-b" },
  },
  { label: "browser-c", target: { kind: "browser", id: "c", surfaceId: "c" } },
] satisfies Array<{ label: string; target: PipGroupTarget }>;
const labels = entries.map((entry) => entry.label);
const permutations = <T>(values: T[]): T[][] =>
  values.length
    ? values.flatMap((value, index) =>
        permutations(values.filter((_, at) => at !== index)).map((rest) => [
          value,
          ...rest,
        ]),
      )
    : [[]];

describe("grouped PiP return focus", () => {
  it.each(
    permutations([0, 1, 2, 3]).map(
      (order) => [order.join(","), order] as const,
    ),
  )(
    "selects the browser only after all restored-state and native events in order %s",
    (_name, order) => {
      const returns = createWorkspacePipReturns();
      returns.register(entries);
      let focused = "original";
      const restored = new Set<string>();
      const focus = entries.map(({ target }) =>
        vi.fn(() => {
          expect(restored.size).toBe(3);
          focused = target.id;
        }),
      );
      for (const [step, event] of order.entries()) {
        if (event === 3) returns.complete("browser-c", labels);
        else {
          const { target } = entries[event];
          restored.add(target.id);
          expect(returns.restored(target.kind, target.id, focus[event])).toBe(
            true,
          );
        }
        if (step < 3) expect(focused).toBe("original");
      }
      expect(focused).toBe("c");
      expect(focus[0]).not.toHaveBeenCalled();
      expect(focus[1]).not.toHaveBeenCalled();
      expect(focus[2]).toHaveBeenCalledOnce();
      returns.complete("browser-c", labels);
      expect(focus[2]).toHaveBeenCalledOnce();
    },
  );

  it("restores the selected session once rather than the last session to acknowledge", () => {
    const returns = createWorkspacePipReturns();
    returns.register(entries);
    const focused: string[] = [];
    returns.complete("session-a", labels);
    returns.restored("session", "a", () => focused.push("a"));
    returns.restored("browser", "c", () => focused.push("c"));
    returns.restored("session", "b", () => focused.push("b"));
    expect(focused).toEqual(["a"]);
  });

  it("retains remaining members when a detached native tab returns independently", () => {
    const returns = createWorkspacePipReturns();
    returns.register(entries);
    const focused: string[] = [];
    returns.complete("session-a", ["session-a"]);
    returns.restored("session", "a", () => focused.push("a"));
    expect(focused).toEqual(["a"]);
    returns.restored("session", "b", () => focused.push("b"));
    returns.complete("browser-c", ["session-b", "browser-c"]);
    expect(focused).toEqual(["a"]);
    returns.restored("browser", "c", () => focused.push("c"));
    expect(focused).toEqual(["a", "c"]);
  });

  it("preserves an explicit Open Diff action and its source focus after sibling restoration", () => {
    const returns = createWorkspacePipReturns();
    returns.register(entries);
    let focused = "original";
    let view = "chat";
    const sequence: string[] = [];
    returns.restored(
      "session",
      "b",
      () => {
        focused = "b";
        sequence.push("focus b");
        expect(focused).toBe("b");
        view = "diff";
        sequence.push("open diff");
      },
      true,
    );
    returns.complete("session-b", labels);
    returns.restored("browser", "c", () => {
      focused = "c";
      view = "browser";
    });
    expect(sequence).toEqual([]);
    returns.restored("session", "a", () => {
      focused = "a";
      view = "chat";
    });
    expect(sequence).toEqual(["focus b", "open diff"]);
    expect(focused).toBe("b");
    expect(view).toBe("diff");
  });

  it("restores the remaining browser after a two-tab group becomes a singleton", () => {
    const returns = createWorkspacePipReturns();
    returns.register([entries[0], entries[2]]);
    const focused: string[] = [];
    returns.restored("session", "a", () => focused.push("a"));
    returns.complete("session-a", ["session-a"]);
    expect(focused).toEqual(["a"]);

    // Native keeps the singleton's ownership until its independent Return.
    returns.restored("browser", "c", () => focused.push("c"));
    expect(focused).toEqual(["a"]);
    returns.complete("browser-c", ["browser-c"]);
    expect(focused).toEqual(["a", "c"]);
    expect(returns.restored("browser", "c", vi.fn())).toBe(false);
  });

  it("releases a singleton session's pending file action after the detached sibling returned", () => {
    const returns = createWorkspacePipReturns();
    returns.register([entries[0], entries[1]]);
    const actions: string[] = [];
    returns.complete("session-a", ["session-a"]);
    returns.restored("session", "a", () => actions.push("return a"));
    returns.complete("session-b", ["session-b"]);
    returns.restored(
      "session",
      "b",
      () => {
        actions.push("focus b", "open file b");
      },
      true,
    );
    expect(actions).toEqual(["return a", "focus b", "open file b"]);
    expect(returns.restored("session", "b", vi.fn())).toBe(false);
  });

  it("leaves ungrouped returns immediate and releases deferred returns if native grouping fails", () => {
    const returns = createWorkspacePipReturns();
    const focus = vi.fn();
    expect(returns.restored("session", "a", focus)).toBe(false);
    returns.register(entries);
    expect(returns.restored("session", "a", focus)).toBe(true);
    expect(focus).not.toHaveBeenCalled();
    returns.cancel(labels);
    expect(focus).toHaveBeenCalledOnce();
    expect(returns.restored("browser", "c", focus)).toBe(false);
  });
});

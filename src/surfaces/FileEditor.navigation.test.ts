// @vitest-environment happy-dom
import type { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scheduleEditorNavigation } from "./FileEditor";

afterEach(() => vi.unstubAllGlobals());

describe("editor search navigation", () => {
  it.each(["background request", "user left during load"])(
    "does not take focus for %s",
    (reason) => {
      const frames: FrameRequestCallback[] = [];
      vi.stubGlobal(
        "requestAnimationFrame",
        (callback: FrameRequestCallback) => {
          frames.push(callback);
          return frames.length;
        },
      );
      vi.stubGlobal("cancelAnimationFrame", vi.fn());
      const dispatch = vi.fn(),
        focus = vi.fn();
      const view = {
        state: { doc: { lines: 2, line: () => ({ from: 6, to: 10 }) } },
        dispatch,
        focus,
      } as unknown as EditorView;
      let active = true;
      scheduleEditorNavigation(
        view,
        {
          line: 2,
          ...(reason === "background request" ? { focus: false } : {}),
        },
        () => active,
      );
      frames[0](0);
      active = false;
      frames[1](0);
      expect(dispatch).toHaveBeenCalledOnce();
      expect(focus).not.toHaveBeenCalled();
      if (reason === "background request")
        expect(dispatch.mock.calls[0][0]).not.toHaveProperty("selection");
    },
  );
  it("clamps a stale line to the loaded document without scheduling more frames", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const dispatch = vi.fn();
    const focus = vi.fn();
    const view = {
      state: {
        doc: {
          lines: 2,
          line: (number: number) => {
            expect(number).toBe(2);
            return { from: 6, to: 10 };
          },
        },
      },
      dispatch,
      focus,
    } as unknown as EditorView;

    scheduleEditorNavigation(view, { line: 100, column: 20 });
    expect(frames).toHaveLength(1);
    frames[0](0);
    expect(frames).toHaveLength(2);
    frames[1](0);
    expect(frames).toHaveLength(2);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ selection: { anchor: 10 } }),
    );
    expect(focus).toHaveBeenCalledOnce();
  });

  it("cancels navigation when the editor closes before the second frame", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const cancel = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const dispatch = vi.fn();
    const view = { dispatch } as unknown as EditorView;
    const stop = scheduleEditorNavigation(view, { line: 4 });
    frames[0](0);
    stop();
    frames[1](0);
    expect(cancel).toHaveBeenCalledWith(2);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

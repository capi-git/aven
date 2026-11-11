// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DictationEvent } from "../lib/dictation";
import {
  DICTATION_IDLE_MS,
  useDictation,
  type DictationDeps,
} from "./useDictation";

type Hook = ReturnType<typeof useDictation>;

describe("listening for the message box", () => {
  let root: Root;
  let container: HTMLDivElement;
  let hook: Hook;
  let send: (event: DictationEvent) => void;
  let deps: DictationDeps & {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  };
  const onStart = vi.fn();
  const onWords = vi.fn();

  function Harness({ enabled }: { enabled: boolean }) {
    hook = useDictation({ enabled, onStart, onWords, deps });
    return null;
  }
  const render = (enabled = true) =>
    act(async () => root.render(createElement(Harness, { enabled })));
  const hear = (event: DictationEvent) => act(async () => send(event));

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    onStart.mockClear();
    onWords.mockClear();
    let generation = 0;
    deps = {
      start: vi.fn(async (onEvent: (event: DictationEvent) => void) => {
        send = onEvent;
        return ++generation;
      }),
      stop: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
    };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows it's on at once, then passes on the words as they're heard", async () => {
    await render();
    await act(async () => hook.toggle());
    expect(hook.state).toBe("starting");
    expect(hook.active).toBe(true);
    expect(onStart).toHaveBeenCalledTimes(1);
    await hear({ kind: "listening" });
    expect(hook.state).toBe("listening");
    await hear({ kind: "words", text: "Add a", final: false });
    await hear({ kind: "words", text: "Add a mic", final: false });
    expect(onWords.mock.calls.map(([text]) => text)).toEqual([
      "Add a",
      "Add a mic",
    ]);
  });

  it("stops on a second press, keeping the last words", async () => {
    await render();
    await act(async () => hook.toggle());
    await hear({ kind: "listening" });
    await act(async () => hook.toggle());
    expect(hook.state).toBe("stopping");
    expect(deps.stop).toHaveBeenCalledWith(1);
    await hear({ kind: "words", text: "Add a mic button.", final: true });
    await hear({ kind: "end" });
    expect(hook.state).toBe("idle");
    expect(onWords).toHaveBeenLastCalledWith("Add a mic button.");
  });

  it("keeps what was heard before a pause, and adds what's heard after it", async () => {
    await render();
    await act(async () => hook.toggle());
    await hear({ kind: "listening" });
    await hear({ kind: "words", text: "Add a mic", final: false });
    await hear({ kind: "words", text: "Add a mic button", final: false });
    // After a pause the recogniser's text starts over.
    await act(async () => vi.advanceTimersByTime(2000));
    await hear({ kind: "words", text: "And", final: false });
    expect(onWords).toHaveBeenLastCalledWith("Add a mic button And");
    await hear({ kind: "words", text: "And make it round", final: false });
    expect(onWords).toHaveBeenLastCalledWith(
      "Add a mic button And make it round",
    );
    // A stretch it closes itself, then the next one right behind it.
    await hear({
      kind: "words",
      text: "And make it round.",
      final: false,
      pause: true,
    });
    await hear({ kind: "words", text: "Thanks", final: false });
    expect(onWords).toHaveBeenLastCalledWith(
      "Add a mic button And make it round. Thanks",
    );
  });

  it("keeps every word when a stop ends on no text", async () => {
    await render();
    await act(async () => hook.toggle());
    await hear({ kind: "listening" });
    await hear({ kind: "words", text: "Add a mic button", final: false });
    await act(async () => hook.toggle());
    await hear({ kind: "words", text: "", final: true });
    await hear({ kind: "end" });
    expect(hook.state).toBe("idle");
    expect(onWords).toHaveBeenLastCalledWith("Add a mic button");
  });

  it("keeps every word when the long quiet stops it", async () => {
    await render();
    await act(async () => hook.toggle());
    await hear({ kind: "listening" });
    await hear({ kind: "words", text: "Add a mic button", final: false });
    await act(async () => vi.advanceTimersByTime(DICTATION_IDLE_MS));
    expect(deps.stop).toHaveBeenCalledWith(1);
    // By now the recogniser has only its newest stretch, or nothing.
    await hear({ kind: "words", text: "", final: true });
    await hear({ kind: "end" });
    expect(hook.state).toBe("idle");
    expect(onWords).toHaveBeenLastCalledWith("Add a mic button");
  });

  it("starts each listen with nothing heard", async () => {
    await render();
    await act(async () => hook.toggle());
    await hear({ kind: "listening" });
    await hear({ kind: "words", text: "Add a mic button", final: false });
    await hear({ kind: "end" });
    await act(async () => hook.toggle());
    await hear({ kind: "listening" });
    await hear({ kind: "words", text: "Thanks", final: false });
    expect(onWords).toHaveBeenLastCalledWith("Thanks");
  });

  it("stops as soon as the host answers when pressed again while starting", async () => {
    let answer: (generation: number) => void = () => {};
    deps.start.mockImplementationOnce(
      (onEvent: (event: DictationEvent) => void) => {
        send = onEvent;
        return new Promise<number>((resolve) => (answer = resolve));
      },
    );
    await render();
    await act(async () => hook.toggle());
    await act(async () => hook.toggle());
    expect(deps.stop).not.toHaveBeenCalled();
    await act(async () => answer(7));
    expect(deps.stop).toHaveBeenCalledWith(7);
  });

  it("hears nothing more once cancelled", async () => {
    await render();
    await act(async () => hook.toggle());
    await hear({ kind: "listening" });
    await act(async () => hook.cancel());
    expect(hook.state).toBe("idle");
    expect(deps.cancel).toHaveBeenCalledWith(1);
    await hear({ kind: "words", text: "late", final: false });
    expect(onWords).not.toHaveBeenCalled();
  });

  it("explains a refusal and ends", async () => {
    await render();
    await act(async () => hook.toggle());
    await hear({ kind: "error", code: "microphone-denied", message: "" });
    await hear({ kind: "end" });
    expect(hook.state).toBe("idle");
    expect(hook.problem?.settings).toBe("microphone");
    // Trying again clears it.
    await act(async () => hook.toggle());
    expect(hook.problem).toBeNull();
  });

  it("explains a host that couldn't start", async () => {
    deps.start.mockRejectedValueOnce(new Error("Speech framework missing."));
    await render();
    await act(async () => hook.toggle());
    expect(hook.state).toBe("idle");
    expect(hook.problem?.text).toBe(
      "Couldn't listen: Speech framework missing.",
    );
  });

  it("stops by itself after a long quiet", async () => {
    await render();
    await act(async () => hook.toggle());
    await hear({ kind: "listening" });
    await act(async () => vi.advanceTimersByTime(DICTATION_IDLE_MS - 1000));
    await hear({ kind: "words", text: "still here", final: false });
    await act(async () => vi.advanceTimersByTime(DICTATION_IDLE_MS - 1000));
    expect(deps.stop).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1000));
    expect(deps.stop).toHaveBeenCalledWith(1);
  });

  it("lets go when the message box goes away or is turned off", async () => {
    await render();
    await act(async () => hook.toggle());
    await hear({ kind: "listening" });
    await render(false);
    expect(deps.cancel).toHaveBeenCalledWith(1);
    expect(hook.state).toBe("idle");
    await act(async () => hook.toggle());
    expect(deps.start).toHaveBeenCalledTimes(1);

    await render(true);
    await act(async () => hook.toggle());
    await hear({ kind: "listening" });
    await act(async () => root.unmount());
    expect(deps.cancel).toHaveBeenCalledWith(2);
    root = createRoot(container);
  });
});

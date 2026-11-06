import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelNativeDictation,
  dictationProblem,
  startNativeDictation,
  stopNativeDictation,
  type DictationEvent,
  type DictationProblem,
} from "../lib/dictation";
import { errorText } from "../lib/errors";

/** Listening stops by itself after this long without a new word. */
export const DICTATION_IDLE_MS = 60_000;

export type DictationState = "idle" | "starting" | "listening" | "stopping";

export type DictationDeps = {
  start: (onEvent: (event: DictationEvent) => void) => Promise<number>;
  stop: (generation: number) => Promise<void>;
  cancel: (generation: number) => Promise<void>;
};

const NATIVE_DEPS: DictationDeps = {
  start: startNativeDictation,
  stop: stopNativeDictation,
  cancel: cancelNativeDictation,
};

type Options = {
  /** False hides nothing but stops a listen and refuses new ones. */
  enabled: boolean;
  /** A listen is about to start: remember where its words will go. */
  onStart: () => void;
  /** Everything heard so far in this listen. */
  onWords: (heard: string) => void;
  deps?: DictationDeps;
};

/**
 * One listen at a time for a message box: start, stop (keeping the last
 * words) or cancel (keeping what's already in the field), with a refusal in
 * plain words. Unmounting or disabling cancels.
 */
export function useDictation({
  enabled,
  onStart,
  onWords,
  deps = NATIVE_DEPS,
}: Options) {
  const [state, setState] = useState<DictationState>("idle");
  const [problem, setProblem] = useState<DictationProblem | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const callbacks = useRef({ onStart, onWords, deps });
  callbacks.current = { onStart, onWords, deps };
  // Each start's token; events and replies for an older one are ignored.
  const tokenRef = useRef(0);
  const generationRef = useRef<number | null>(null);
  const stopWantedRef = useRef(false);
  const idleTimerRef = useRef<number | null>(null);

  const clearIdle = useCallback(() => {
    if (idleTimerRef.current !== null)
      window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = null;
  }, []);

  const stop = useCallback(() => {
    if (stateRef.current === "idle" || stateRef.current === "stopping") return;
    clearIdle();
    setState("stopping");
    stateRef.current = "stopping";
    const generation = generationRef.current;
    if (generation === null) {
      // The host hasn't answered yet; stop as soon as it does.
      stopWantedRef.current = true;
      return;
    }
    void callbacks.current.deps.stop(generation).catch(() => undefined);
  }, [clearIdle]);

  const armIdle = useCallback(() => {
    clearIdle();
    idleTimerRef.current = window.setTimeout(stop, DICTATION_IDLE_MS);
  }, [clearIdle, stop]);

  const finish = useCallback(() => {
    clearIdle();
    generationRef.current = null;
    stopWantedRef.current = false;
    stateRef.current = "idle";
    setState("idle");
  }, [clearIdle]);

  const cancel = useCallback(() => {
    if (stateRef.current === "idle") return;
    tokenRef.current += 1;
    const generation = generationRef.current;
    if (generation !== null)
      void callbacks.current.deps.cancel(generation).catch(() => undefined);
    finish();
  }, [finish]);

  const start = useCallback(() => {
    if (!enabled || stateRef.current !== "idle") return;
    const token = ++tokenRef.current;
    setProblem(null);
    stateRef.current = "starting";
    setState("starting");
    callbacks.current.onStart();
    const onEvent = (event: DictationEvent) => {
      if (tokenRef.current !== token) return;
      switch (event.kind) {
        case "listening":
          if (stateRef.current === "starting") {
            stateRef.current = "listening";
            setState("listening");
          }
          armIdle();
          return;
        case "words":
          callbacks.current.onWords(event.text);
          if (stateRef.current === "listening") armIdle();
          return;
        case "error":
          setProblem(dictationProblem(event.code, event.message));
          return;
        case "end":
          finish();
          return;
      }
    };
    callbacks.current.deps
      .start(onEvent)
      .then((generation) => {
        if (tokenRef.current !== token) {
          void callbacks.current.deps.cancel(generation).catch(() => undefined);
          return;
        }
        generationRef.current = generation;
        if (stopWantedRef.current) {
          stopWantedRef.current = false;
          void callbacks.current.deps.stop(generation).catch(() => undefined);
        }
      })
      .catch((error: unknown) => {
        if (tokenRef.current !== token) return;
        setProblem(dictationProblem("failed", errorText(error)));
        finish();
      });
  }, [armIdle, enabled, finish]);

  const toggle = useCallback(() => {
    if (stateRef.current === "idle") start();
    else stop();
  }, [start, stop]);

  useEffect(() => {
    if (!enabled) cancel();
  }, [cancel, enabled]);
  useEffect(() => cancel, [cancel]);

  return {
    state,
    /** Listening, or about to: the field belongs to the microphone. */
    active: state !== "idle",
    problem,
    dismissProblem: useCallback(() => setProblem(null), []),
    start,
    stop,
    cancel,
    toggle,
  };
}

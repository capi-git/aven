import { useCallback, useRef, useState } from "react";
import { tidyIntoBrief, type BriefResult } from "../lib/brief";
import { wordCount } from "../lib/dictation";

/** Fewer spoken words than this are already short enough to send. */
export const BRIEF_MIN_WORDS = 8;

/** What the message box offers for what was said, if anything. */
export type BriefAction =
  /** Rewrite the words in the field as a brief. */
  | "tidy"
  /** Waiting for the cheap model. */
  | "tidying"
  /** The field holds the brief: put the speaker's words back. */
  | "words"
  /** The field holds the words the brief came from: put the brief back. */
  | "brief";

type Saved = { words: string; brief: string };

type Options = {
  /** Replace what's in the message box. */
  setText: (text: string) => void;
  tidy?: (
    words: string,
    options: { onText: (brief: string) => void },
  ) => Promise<BriefResult>;
};

/**
 * "Tidy into a brief" for words spoken into the message box. The brief
 * replaces the words in the field, where it can be edited before sending;
 * the words (and the brief, edits and all) stay one press away until the
 * field is emptied.
 */
export function useSpokenBrief({ setText, tidy = tidyIntoBrief }: Options) {
  const [spoken, setSpoken] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [showing, setShowing] = useState<"words" | "brief">("words");
  const [tidying, setTidying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef(0);
  // The words being tidied, to put back if the brief fails or is cancelled
  // after it has started to replace them.
  const tidyingWordsRef = useRef<string | null>(null);
  const setTextRef = useRef(setText);
  setTextRef.current = setText;
  const tidyRef = useRef(tidy);
  tidyRef.current = tidy;

  /** Words were spoken into this draft. */
  const markSpoken = useCallback(() => setSpoken(true), []);

  /** The draft was sent or emptied: nothing is left to tidy or go back to. */
  const reset = useCallback(() => {
    tokenRef.current += 1;
    tidyingWordsRef.current = null;
    setSpoken(false);
    setSaved(null);
    setShowing("words");
    setTidying(false);
    setError(null);
  }, []);

  /**
   * Speaking again: what's in the field becomes the words, and the brief
   * and words from before are let go. A brief still being written gives
   * way to the words it was replacing.
   */
  const forget = useCallback(() => {
    tokenRef.current += 1;
    const words = tidyingWordsRef.current;
    tidyingWordsRef.current = null;
    if (words !== null) setTextRef.current(words);
    setSaved(null);
    setShowing("words");
    setTidying(false);
    setError(null);
  }, []);

  const start = useCallback((words: string) => {
    const token = ++tokenRef.current;
    tidyingWordsRef.current = words;
    setError(null);
    setTidying(true);
    // The brief writes itself over the words as it arrives.
    const onText = (brief: string) => {
      if (tokenRef.current === token && brief) setTextRef.current(brief);
    };
    void tidyRef.current(words, { onText }).then((result) => {
      if (tokenRef.current !== token) return;
      tidyingWordsRef.current = null;
      setTidying(false);
      if (!result.ok) {
        setError(result.error);
        setTextRef.current(words);
        return;
      }
      setSaved({ words, brief: result.brief });
      setShowing("brief");
      setTextRef.current(result.brief);
    });
  }, []);

  const cancel = useCallback(() => {
    tokenRef.current += 1;
    setTidying(false);
    const words = tidyingWordsRef.current;
    tidyingWordsRef.current = null;
    if (words !== null) setTextRef.current(words);
  }, []);

  /** Back to the words; the brief keeps any edits made to it. */
  const showWords = useCallback(
    (current: string) => {
      if (!saved) return;
      setSaved({ ...saved, brief: current });
      setShowing("words");
      setTextRef.current(saved.words);
    },
    [saved],
  );

  const showBrief = useCallback(() => {
    if (!saved) return;
    setShowing("brief");
    setTextRef.current(saved.brief);
  }, [saved]);

  /** What to offer for `text`, the field as it is now. */
  const action = (text: string): BriefAction | null => {
    if (tidying) return "tidying";
    if (saved && showing === "brief") return "words";
    if (saved && text === saved.words) return "brief";
    if (spoken && wordCount(text) >= BRIEF_MIN_WORDS) return "tidy";
    return null;
  };

  return {
    action,
    tidying,
    error,
    clearError: useCallback(() => setError(null), []),
    markSpoken,
    reset,
    forget,
    start,
    cancel,
    showWords,
    showBrief,
  };
}

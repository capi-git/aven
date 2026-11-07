import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  firstRecentPick,
  recentOrder,
  RECENT_OPEN_MS,
  RECENT_SHOW_DELAY_MS,
  stepRecent,
  touchRecent,
} from "../lib/recentSurfaces";
import { motionReduced } from "../lib/motion";

/** What the switcher shows: entries newest first and the one picked. */
export type RecentSwitcherState = {
  keys: string[];
  picked: number;
  /** "open" while choosing; "opening" while the pick grows into place. */
  phase: "open" | "opening" | "closing";
};

type Options = {
  /** The project whose strip is in front. */
  project: string;
  /** The strip entry in front. */
  front: string;
  /** The strip's entry keys, in strip order. */
  entryKeys: () => string[];
  /** Bring a strip entry to the front. */
  open: (key: string) => void;
  /**
   * Stand pictures in for the browser pages showing, so the switcher can
   * draw over them; resolves with the pages held.
   */
  holdPages: () => Promise<readonly string[]> | null;
  /** Show held pages live again after `ms`. */
  releasePages: (ids: readonly string[], ms: number) => void;
  /**
   * Keep fresh pictures of the browser pages showing, for their cards once
   * they are behind: taken a moment after an entry comes forward (once its
   * page has drawn) and again as ⌃⇥ is pressed.
   */
  refreshPictures?: () => void;
};

/** How long an entry is in front before its pages are pictured (ms). */
const PICTURE_AFTER_MS = 1200;

/** How often a held ⌃ is checked while a browser page has the keys (ms). */
const CONTROL_POLL_MS = 40;
const CLOSE_MS = 160;

/**
 * The recent switcher (⌃⇥): hold ⌃ and tap ⇥ to step back through the
 * strip's entries, most recent first; let go of ⌃ to open the one picked.
 * A quick tap opens the one before at once and never shows the switcher.
 */
export function useRecentSwitcher({
  project,
  front,
  entryKeys,
  open,
  holdPages,
  releasePages,
  refreshPictures,
}: Options) {
  const latest = useRef({
    open,
    holdPages,
    releasePages,
    refreshPictures,
    entryKeys,
    front,
  });
  latest.current = {
    open,
    holdPages,
    releasePages,
    refreshPictures,
    entryKeys,
    front,
  };
  const recents = useRef(new Map<string, string[]>());
  useEffect(() => {
    if (!front) return;
    recents.current.set(
      project,
      touchRecent(recents.current.get(project) ?? [], front),
    );
    if (!latest.current.refreshPictures) return;
    const timer = window.setTimeout(
      () => latest.current.refreshPictures?.(),
      PICTURE_AFTER_MS,
    );
    return () => window.clearTimeout(timer);
  }, [project, front]);

  const [state, setState] = useState<RecentSwitcherState | null>(null);
  const live = useRef<{
    keys: string[];
    picked: number;
    shown: boolean;
    done: boolean;
    held: Promise<readonly string[]> | null;
    timers: number[];
    stopWatch: () => void;
  } | null>(null);

  const finish = useCallback((delay: number) => {
    const run = live.current;
    if (!run) return;
    run.done = true;
    run.stopWatch();
    run.timers.forEach((timer) => window.clearTimeout(timer));
    const held = run.held;
    window.setTimeout(() => {
      if (live.current === run) {
        live.current = null;
        setState(null);
      }
    }, delay);
    if (held) {
      void held.then((ids) => latest.current.releasePages(ids, delay));
    }
  }, []);

  const show = useCallback(() => {
    const run = live.current;
    if (!run || run.shown || run.done) return;
    run.shown = true;
    run.held = latest.current.holdPages();
    // Browser pages draw above the window: the cascade waits (briefly)
    // for pictures of them to stand in their place.
    const reveal = () => {
      if (live.current !== run || run.done) return;
      setState({ keys: run.keys, picked: run.picked, phase: "open" });
    };
    if (run.held) void run.held.then(reveal, reveal);
    else reveal();
  }, []);

  const commit = useCallback(() => {
    const run = live.current;
    if (!run || run.done) return;
    const key = run.keys[run.picked];
    if (!run.shown) {
      finish(0);
      if (key && key !== latest.current.front) latest.current.open(key);
      return;
    }
    const ms = motionReduced() ? CLOSE_MS : RECENT_OPEN_MS;
    setState({ keys: run.keys, picked: run.picked, phase: "opening" });
    finish(ms);
    // The picked card answers at once by growing into place; the entry
    // itself comes forward as it lands, under the card's last frames.
    window.setTimeout(
      () => {
        if (key && key !== latest.current.front) latest.current.open(key);
      },
      Math.max(0, ms - 60),
    );
  }, [finish]);

  const cancel = useCallback(() => {
    const run = live.current;
    if (!run || run.done) return;
    if (run.shown)
      setState({ keys: run.keys, picked: run.picked, phase: "closing" });
    finish(run.shown ? CLOSE_MS : 0);
  }, [finish]);

  const move = useCallback(
    (step: number) => {
      const run = live.current;
      if (!run || run.done) return;
      run.picked = stepRecent(run.picked, step, run.keys.length);
      // A second ⇥ before the switcher appeared: show it now.
      if (!run.shown) show();
      else setState({ keys: run.keys, picked: run.picked, phase: "open" });
    },
    [show],
  );

  const pick = useCallback((index: number) => {
    const run = live.current;
    if (!run || run.done || !run.shown) return;
    if (index === run.picked) return;
    run.picked = stepRecent(index, 0, run.keys.length);
    setState({ keys: run.keys, picked: run.picked, phase: "open" });
  }, []);

  const choose = useCallback(
    (index: number) => {
      const run = live.current;
      if (!run || run.done) return;
      run.picked = stepRecent(index, 0, run.keys.length);
      commit();
    },
    [commit],
  );

  /** ⌃⇥ (1) or ⌃⇧⇥ (-1). */
  const step = useCallback(
    (direction: 1 | -1) => {
      if (live.current && !live.current.done) {
        move(direction);
        return;
      }
      if (live.current) return;
      const { entryKeys, front } = latest.current;
      const keys = recentOrder(
        recents.current.get(project) ?? [],
        entryKeys(),
        front,
      );
      if (keys.length < 2) return;
      // The page leaving is pictured as it is now, for its card.
      latest.current.refreshPictures?.();
      const run = {
        keys,
        picked: firstRecentPick(direction, keys.length),
        shown: false,
        done: false,
        held: null,
        timers: [] as number[],
        stopWatch: () => {},
      };
      live.current = run;
      run.stopWatch = watchControl(() => commit());
      run.timers.push(window.setTimeout(show, RECENT_SHOW_DELAY_MS));
    },
    [commit, move, project, show],
  );

  // While the switcher shows it owns the keyboard: arrows and ⇥ move,
  // return opens, escape stays where you were.
  const shown = state !== null;
  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "Tab") return;
      const steps: Record<string, number> = {
        ArrowLeft: -1,
        ArrowUp: -1,
        ArrowRight: 1,
        ArrowDown: 1,
        Tab: e.shiftKey ? -1 : 1,
      };
      if (e.key in steps) move(steps[e.key]);
      else if (e.key === "Enter") commit();
      else if (e.key === "Escape") cancel();
      else if (e.key === "Control") return;
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onBlur = () => cancel();
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [shown, move, commit, cancel]);

  // A project change mid-hold leaves nothing to switch between.
  useEffect(() => () => cancel(), [project, cancel]);

  return { state, step, pick, choose, cancel };
}

/**
 * Calls `released` once ⌃ is let go: on the window's own key-up, or, as a
 * focused browser page keeps its key-ups, by asking the system now and
 * then. Returns a stop function.
 */
function watchControl(released: () => void): () => void {
  let stopped = false;
  let timer = 0;
  const stop = () => {
    stopped = true;
    window.clearTimeout(timer);
    window.removeEventListener("keyup", onKeyUp, true);
  };
  const fire = () => {
    if (stopped) return;
    stop();
    released();
  };
  function onKeyUp(e: KeyboardEvent) {
    if (e.key === "Control" || !e.ctrlKey) fire();
  }
  window.addEventListener("keyup", onKeyUp, true);
  const poll = () => {
    if (stopped) return;
    invoke<boolean | null>("control_key_held")
      .then((held) => {
        if (stopped || held === null) return;
        if (!held) fire();
        else timer = window.setTimeout(poll, CONTROL_POLL_MS);
      })
      .catch(() => {});
  };
  timer = window.setTimeout(poll, CONTROL_POLL_MS);
  return stop;
}

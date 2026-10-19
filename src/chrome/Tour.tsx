import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { LAYER } from "../lib/layers";
import {
  TOUR_STOPS,
  clipTourRect,
  nextTourIndex,
  placeTourPopover,
  tourRectOnScreen,
  type TourPlacement,
  type TourRect,
  type TourStop,
  type TourStopId,
} from "../lib/tour";
import { focusableWithin, isVisible } from "./Modal";
import "./Tour.css";

/** Room left around the spotlit element. */
const SPOTLIGHT_PAD = 6;
/** How long a stop keeps re-measuring while a panel it opened settles. */
const SETTLE_MS = 450;
/** Time for what was just opened (a project's first chat) to draw first. */
const START_MS = 150;

export type TourPrepare = Partial<
  Record<TourStopId, () => (() => void) | void>
>;

type Props = {
  stops?: readonly TourStop[];
  /**
   * Bring a stop's element on screen when that is cheap and safe, such as
   * opening the side panel. Returns how to put things back.
   */
  prepare?: TourPrepare;
  /** `finished`: Done on the last stop; otherwise skipped or left. */
  onClose: (finished: boolean) => void;
  /** Wait before looking for the stops' elements. */
  startDelay?: number;
};

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}

/** The first on-screen element tagged with one of the stop's anchors. */
export function findTourAnchor(stop: TourStop): HTMLElement | null {
  for (const name of stop.anchors) {
    for (const element of document.querySelectorAll<HTMLElement>(
      `[data-tour="${name}"]`,
    )) {
      if (!isVisible(element)) continue;
      const rect = element.getBoundingClientRect();
      if (tourRectOnScreen(rect, viewport())) return element;
    }
  }
  return null;
}

function spotlightRect(element: HTMLElement): TourRect {
  const rect = clipTourRect(element.getBoundingClientRect(), viewport());
  return {
    left: rect.left - SPOTLIGHT_PAD,
    top: rect.top - SPOTLIGHT_PAD,
    width: rect.width + SPOTLIGHT_PAD * 2,
    height: rect.height + SPOTLIGHT_PAD * 2,
  };
}

function sameRect(a: TourRect | null, b: TourRect | null) {
  return (
    a === b ||
    (!!a &&
      !!b &&
      Math.abs(a.left - b.left) < 0.5 &&
      Math.abs(a.top - b.top) < 0.5 &&
      Math.abs(a.width - b.width) < 0.5 &&
      Math.abs(a.height - b.height) < 0.5)
  );
}

/**
 * A short tour over the real app: a soft spotlight on one element at a time
 * and a small popover beside it. Stops whose element is not on screen are
 * skipped. While it runs, browser pages show as still images (the layer is
 * a modal dialog), so nothing native covers it.
 */
export function Tour({
  stops = TOUR_STOPS,
  prepare,
  onClose,
  startDelay = START_MS,
}: Props) {
  const ids = useId();
  const popoverRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const opener = useRef(
    typeof document === "undefined" ? null : document.activeElement,
  );
  // Stops that can be shown: on screen now, or brought on screen by
  // `prepare`. One that still can't be found when reached is dropped.
  const [open, setOpen] = useState<readonly TourStop[] | null>(null);
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  // The stop on screen and its element. It changes only once the next
  // stop's element is found, so text and spotlight move together.
  const [found, setFound] = useState<{
    stop: TourStop;
    element: HTMLElement;
  } | null>(null);
  const [rect, setRect] = useState<TourRect | null>(null);
  const [placement, setPlacement] = useState<TourPlacement | null>(null);
  const prepareRef = useRef(prepare);
  prepareRef.current = prepare;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    const timer = setTimeout(() => {
      const shown = stops.filter(
        (stop) => !!prepareRef.current?.[stop.id] || !!findTourAnchor(stop),
      );
      if (!shown.length) closeRef.current(false);
      else setOpen(shown);
    }, startDelay);
    return () => clearTimeout(timer);
  }, [stops, startDelay]);

  const stop = open?.[index] ?? null;

  // Reach a stop: prepare it, then find its element once the frames after
  // have laid it out. Leaving the stop undoes what it prepared.
  useEffect(() => {
    if (!stop) return;
    const undo = prepareRef.current?.[stop.id]?.();
    let frame = 0;
    let cancelled = false;
    const drop = () => {
      // Not on screen after all: go on the same way without it.
      const current = openRef.current ?? [];
      const position = current.indexOf(stop);
      const remaining = current.filter((each) => each !== stop);
      if (!remaining.length) closeRef.current(false);
      else if (direction === 1 && position >= remaining.length)
        closeRef.current(true);
      else {
        setOpen(remaining);
        setIndex(direction === 1 ? position : Math.max(0, position - 1));
      }
    };
    const locate = (tries: number) => {
      if (cancelled) return;
      const element = findTourAnchor(stop);
      if (element) setFound({ stop, element });
      else if (tries > 0)
        frame = requestAnimationFrame(() => locate(tries - 1));
      else drop();
    };
    // A panel `prepare` opened mounts over the next few frames.
    frame = requestAnimationFrame(() =>
      locate(prepareRef.current?.[stop.id] ? 12 : 3),
    );
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      if (typeof undo === "function") undo();
    };
  }, [stop, direction]);

  const target = found?.element ?? null;
  const shownStop = found?.stop ?? null;
  const measure = useCallback(() => {
    if (!target || !shownStop) return;
    if (!target.isConnected) {
      // The element was replaced: point at its successor.
      const again = findTourAnchor(shownStop);
      if (again) setFound({ stop: shownStop, element: again });
      return;
    }
    const next = spotlightRect(target);
    setRect((previous) => (sameRect(previous, next) ? previous : next));
  }, [target, shownStop]);

  // Follow the element while a panel settles, and on any later resize.
  useLayoutEffect(() => {
    if (!target) return;
    measure();
    const started = performance.now();
    let frame = requestAnimationFrame(function settle() {
      measure();
      if (performance.now() - started < SETTLE_MS)
        frame = requestAnimationFrame(settle);
    });
    const resize =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => measure());
    resize?.observe(target);
    window.addEventListener("resize", measure);
    document.addEventListener("transitionend", measure, true);
    return () => {
      cancelAnimationFrame(frame);
      resize?.disconnect();
      window.removeEventListener("resize", measure);
      document.removeEventListener("transitionend", measure, true);
    };
  }, [target, measure]);

  // Place the popover once it has a size, beside the spotlight.
  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!popover || !rect) return;
    const next = placeTourPopover(
      rect,
      { width: popover.offsetWidth, height: popover.offsetHeight },
      viewport(),
    );
    setPlacement((previous) =>
      previous &&
      previous.side === next.side &&
      Math.abs(previous.left - next.left) < 0.5 &&
      Math.abs(previous.top - next.top) < 0.5
        ? previous
        : next,
    );
  }, [rect, shownStop]);

  // The page and the app are sibling native views: DOM focus alone can
  // leave the keyboard with a browser page, so take it back for Escape.
  const takeKeyboard = useCallback(() => {
    const focusNext = () => nextRef.current?.focus({ preventScroll: true });
    focusNext();
    if (!isTauri()) return;
    void getCurrentWebview()
      .setFocus()
      .then(focusNext)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (shownStop) takeKeyboard();
  }, [shownStop, takeKeyboard]);

  useEffect(
    () => () => {
      const previous = opener.current;
      if (previous instanceof HTMLElement && isVisible(previous))
        previous.focus({ preventScroll: true });
    },
    [],
  );

  const count = open?.length ?? 0;
  // Count and buttons follow the stop on screen.
  const at = shownStop && open ? open.indexOf(shownStop) : -1;
  const go = useCallback(
    (step: 1 | -1) => {
      if (!open) return;
      // Ignore presses while the next stop is still being found.
      if (open[index] !== shownStop) return;
      const following = nextTourIndex(open.length, index, step, () => true);
      if (following === null) {
        if (step === 1) closeRef.current(true);
        return;
      }
      setDirection(step);
      setIndex(following);
    },
    [open, index, shownStop],
  );

  const keys = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keys.current = (event: KeyboardEvent) => {
    if (event.isComposing) return;
    const inPopover =
      event.target instanceof Node &&
      !!popoverRef.current?.contains(event.target);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeRef.current(false);
    } else if (event.key === "Enter") {
      // A focused button presses itself.
      if (inPopover && event.target instanceof HTMLButtonElement) return;
      event.preventDefault();
      event.stopPropagation();
      go(1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      go(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      go(-1);
    } else if (event.key === "Tab") {
      const popover = popoverRef.current;
      if (!popover) return;
      const focusable = focusableWithin([popover]);
      if (!focusable.length) return;
      const at = focusable.indexOf(document.activeElement as HTMLElement);
      const next =
        at < 0
          ? 0
          : (at + (event.shiftKey ? -1 : 1) + focusable.length) %
            focusable.length;
      event.preventDefault();
      event.stopPropagation();
      focusable[next].focus({ preventScroll: true });
    }
  };
  useEffect(() => {
    const handle = (event: KeyboardEvent) => keys.current(event);
    // Capture: the tour owns the keyboard while it runs.
    window.addEventListener("keydown", handle, true);
    return () => window.removeEventListener("keydown", handle, true);
  }, []);

  if (typeof document === "undefined") return null;
  const last = at === count - 1;
  return createPortal(
    <div
      className="aven-tour"
      style={{ zIndex: LAYER.dialog }}
      data-native-browser-occluded="true"
      onMouseDown={(event) => event.preventDefault()}
    >
      {rect ? (
        <div
          className="aven-tour-spotlight"
          aria-hidden
          style={{
            transform: `translate(${rect.left}px, ${rect.top}px)`,
            width: rect.width,
            height: rect.height,
          }}
        />
      ) : (
        <div className="aven-tour-scrim" aria-hidden />
      )}
      {shownStop ? (
        <div
          ref={popoverRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${ids}-title`}
          aria-describedby={`${ids}-body`}
          className="aven-tour-popover"
          data-side={placement?.side}
          data-placed={placement && rect ? "true" : undefined}
          style={
            placement && rect
              ? { left: placement.left, top: placement.top }
              : undefined
          }
          onMouseDown={(event) => event.stopPropagation()}
        >
          <h3 id={`${ids}-title`}>{shownStop.title}</h3>
          <p id={`${ids}-body`}>{shownStop.body}</p>
          <footer>
            <span className="aven-tour-count" aria-live="polite">
              {at + 1} of {count}
            </span>
            <button
              type="button"
              className="aven-tour-skip"
              onClick={() => closeRef.current(false)}
            >
              Skip tour
            </button>
            {at > 0 ? (
              <button
                type="button"
                className="aven-tour-secondary"
                onClick={() => go(-1)}
              >
                Back
              </button>
            ) : null}
            <button
              ref={nextRef}
              type="button"
              className="aven-tour-primary"
              onClick={() => go(1)}
            >
              {last ? "Done" : "Next"}
            </button>
          </footer>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

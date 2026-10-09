import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  activePromptId,
  barLift,
  barWindow,
  promptBlocks,
  promptLabel,
  promptPreview,
  NEAR_END_PX,
  RIPPLE_SPAN,
  type OutlineAnchor,
  type OutlineBand,
} from "../lib/promptOutline";
import type { Block } from "../lib/session";
import { effectiveCssZoom } from "../lib/drag";
import { setTranscriptScrollDragging } from "../lib/transcriptScrollIntent";
import { Popover } from "./Popover";
import "./PromptOutline.css";

const OPEN_DELAY_MS = 25;
const SCROLL_INSET_PX = 8;
const POPOVER_WIDTH = 288;
const MIN_PROMPTS = 2;
const BAR_HEIGHT_PX = 2;
const BAR_WIDTH_PX = 11;
const BAR_WIDTH_LIFTED_PX = 24;
const BAR_OPACITY_IDLE = 0.15;
const BAR_OPACITY_LIT = 0.85;
const RIPPLE_STEP_MS = 18;
const BAR_GAP_PX = 10;
const BAR_GAP_MIN_PX = 1;
const BAR_STACK_MAX_PX = 330;
const BAR_STACK_PANE_SHARE = 0.75;
const SCROLLER = ".agent-transcript";
const TURN = ".transcript-turn";
const ANCHOR = "[data-prompt-anchor]";
const DRAG_THRESHOLD_PX = 4;
const MIN_THUMB_PX = 24;

type Hover = { id: string; el: HTMLElement };
type ScrollPosition = { top: number; max: number; share: number; id: string };
type Drag = {
  pointerId: number;
  startY: number;
  startTop: number;
  max: number;
  travel: number;
  rail: HTMLElement;
  scroller: HTMLElement;
  active: boolean;
};

type Props = {
  blocks: Block[];
  scope: RefObject<HTMLElement | null>;
  visible?: boolean;
  /** Renders the turn that holds the block. Returns false when the block is unknown. */
  revealBlock?: (blockId: string) => boolean;
};

export function PromptOutline({
  blocks,
  scope,
  visible = true,
  revealBlock,
}: Props) {
  const prompts = useMemo(() => promptBlocks(blocks), [blocks]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [stackBudget, setStackBudget] = useState(BAR_STACK_MAX_PX);
  const [hover, setHover] = useState<Hover | null>(null);
  const [open, setOpen] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [scrollPosition, setScrollPosition] = useState<ScrollPosition>({
    top: 0,
    max: 0,
    share: 1,
    id: "",
  });
  const [dragging, setDragging] = useState(false);
  const hasRail = prompts.length >= MIN_PROMPTS || scrollPosition.max > 0;
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const rail = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);
  const alignmentFrame = useRef<number | null>(null);
  const openTimer = useRef<number | null>(null);
  const visibleRef = useRef(visible);
  const pointerInside = useRef(false);
  const lastPromptId = useRef<string | null>(null);
  lastPromptId.current = prompts[prompts.length - 1]?.id ?? null;

  const cancelOpen = useCallback(() => {
    if (openTimer.current == null) return;
    window.clearTimeout(openTimer.current);
    openTimer.current = null;
  }, []);

  const cancelFrames = useCallback(() => {
    for (const pending of [frame, alignmentFrame]) {
      if (pending.current == null) continue;
      window.cancelAnimationFrame(pending.current);
      pending.current = null;
    }
  }, []);

  const finishDrag = useCallback(() => {
    const gesture = drag.current;
    drag.current = null;
    if (!gesture) return;
    if (gesture.active) {
      suppressClick.current = true;
      setTranscriptScrollDragging(gesture.scroller, false);
      if (!pointerInside.current && !keyboardFocused(gesture.rail)) {
        setHover(null);
        setOpen(false);
      }
    }
    if (gesture.rail.hasPointerCapture?.(gesture.pointerId)) {
      gesture.rail.releasePointerCapture(gesture.pointerId);
    }
    setDragging(false);
  }, []);

  useLayoutEffect(() => {
    visibleRef.current = visible;
    if (!visible) {
      finishDrag();
      pointerInside.current = false;
      setHover(null);
      setOpen(false);
    }
    // Retained tabs keep their layout boxes. Visibility, not zero dimensions,
    // determines whether their outline can measure, align, or show a preview.
    return () => {
      visibleRef.current = false;
      cancelFrames();
      cancelOpen();
      finishDrag();
    };
  }, [visible, cancelFrames, cancelOpen, finishDrag]);

  const measure = useCallback(() => {
    if (!visibleRef.current) return;
    const scroller = scope.current?.querySelector<HTMLElement>(SCROLLER);
    if (!scroller) {
      setActiveId(null);
      return;
    }
    const viewport = scroller.getBoundingClientRect();
    // A hidden tab has zero-size boxes. The rule would then select the last prompt.
    if (viewport.height === 0) return;
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const nextPosition = {
      top: Math.max(0, Math.min(max, scroller.scrollTop)),
      max,
      share: Math.min(
        1,
        scroller.clientHeight / Math.max(1, scroller.scrollHeight),
      ),
      id: scroller.id,
    };
    setScrollPosition((previous) =>
      previous.top === nextPosition.top &&
      previous.max === nextPosition.max &&
      previous.share === nextPosition.share &&
      previous.id === nextPosition.id
        ? previous
        : nextPosition,
    );
    setStackBudget(
      Math.min(
        BAR_STACK_MAX_PX,
        Math.floor(scroller.clientHeight * BAR_STACK_PANE_SHARE),
      ),
    );
    // Streaming re-measures on every frame, and it almost always lands here:
    // pinned to the end, where the last prompt wins whatever the anchors say.
    // Answer from the block list and skip the walk.
    const distanceToEnd =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (distanceToEnd <= NEAR_END_PX) {
      setActiveId(lastPromptId.current);
      return;
    }
    const anchors: OutlineAnchor[] = [];
    for (const el of scroller.querySelectorAll<HTMLElement>(ANCHOR)) {
      const id = el.dataset.promptAnchor;
      if (id) anchors.push({ id, ...promptBand(el, viewport) });
    }
    setActiveId(
      activePromptId(
        { top: viewport.top, bottom: viewport.bottom },
        anchors,
        distanceToEnd,
      ),
    );
  }, [scope]);

  const schedule = useCallback(() => {
    if (!visibleRef.current || frame.current != null) return;
    frame.current = window.requestAnimationFrame(() => {
      frame.current = null;
      measure();
    });
  }, [measure]);

  useEffect(() => {
    if (!visible) return;
    const scroller = scope.current?.querySelector<HTMLElement>(SCROLLER);
    if (!scroller) return;
    let attached = true;
    const onChange = () => {
      if (attached) schedule();
    };
    scroller.addEventListener("scroll", onChange, { passive: true });
    const observer = new ResizeObserver(onChange);
    observer.observe(scroller);
    // Content growth moves the anchors without a scroll event.
    if (scroller.firstElementChild)
      observer.observe(scroller.firstElementChild);
    schedule();
    return () => {
      attached = false;
      scroller.removeEventListener("scroll", onChange);
      observer.disconnect();
      if (frame.current != null) {
        window.cancelAnimationFrame(frame.current);
        frame.current = null;
      }
    };
  }, [schedule, scope, visible]);

  useEffect(() => {
    schedule();
  }, [schedule, blocks, visible]);

  useEffect(() => {
    const control = rail.current;
    if (!visible || !hasRail || !control) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      const mode = event.deltaMode;
      const deltaY = event.deltaY;
      if (
        !Number.isFinite(deltaY) ||
        deltaY === 0 ||
        Math.abs(event.deltaX) >= Math.abs(deltaY)
      )
        return;
      const scroller = scope.current?.querySelector<HTMLElement>(SCROLLER);
      if (!scroller) return;
      const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      if (max <= 0) return;
      const lineHeight = Number.parseFloat(
        getComputedStyle(scroller).lineHeight,
      );
      const unit =
        mode === 1
          ? Number.isFinite(lineHeight) && lineHeight > 0
            ? lineHeight
            : 16
          : mode === 2
            ? scroller.clientHeight
            : 1 / effectiveCssZoom(scroller);
      const delta = deltaY * unit;
      event.preventDefault();
      // The outline sits beside, rather than inside, the transcript. Forward
      // only its vertical wheel input; the transcript owns native wheel input
      // everywhere else and its normal upward gesture releases the bottom pin.
      if (delta < 0)
        scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: delta }));
      scroller.scrollTop = Math.max(
        0,
        Math.min(max, scroller.scrollTop + delta),
      );
      schedule();
    };
    control.addEventListener("wheel", onWheel, { passive: false });
    return () => control.removeEventListener("wheel", onWheel);
  }, [hasRail, schedule, scope, visible]);

  useEffect(() => {
    if (!visible) return;
    const move = (event: PointerEvent) => {
      const gesture = drag.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const delta = event.clientY - gesture.startY;
      if (!gesture.active && Math.abs(delta) < DRAG_THRESHOLD_PX) return;
      if (!gesture.active) {
        gesture.active = true;
        cancelOpen();
        setOpen(false);
        setDragging(true);
        setTranscriptScrollDragging(gesture.scroller, true);
        // A pointer cancelled by the OS may already be inactive by this point.
        try {
          gesture.rail.setPointerCapture?.(event.pointerId);
        } catch {
          finishDrag();
          return;
        }
      }
      event.preventDefault();
      const max = Math.max(
        0,
        gesture.scroller.scrollHeight - gesture.scroller.clientHeight,
      );
      gesture.scroller.scrollTop = Math.max(
        0,
        Math.min(
          max,
          gesture.startTop + (delta / gesture.travel) * gesture.max,
        ),
      );
      // Capture keeps the gesture alive outside the rail. Keep its ripple
      // following the nearest mark without opening a card while dragging.
      let nearest: HTMLElement | null = null;
      let distance = Number.POSITIVE_INFINITY;
      for (const bar of gesture.rail.querySelectorAll<HTMLElement>(
        "[data-prompt-bar]",
      )) {
        const box = bar.getBoundingClientRect();
        const away = Math.abs(event.clientY - (box.top + box.height / 2));
        if (away < distance) {
          nearest = bar;
          distance = away;
        }
      }
      if (nearest?.dataset.promptBar) {
        const el = nearest;
        const id = nearest.dataset.promptBar;
        setHover((previous) => (previous?.id === id ? previous : { id, el }));
      }
      schedule();
    };
    const release = (event: PointerEvent) => {
      if (drag.current?.pointerId === event.pointerId) finishDrag();
    };
    const blur = () => {
      pointerInside.current = false;
      finishDrag();
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", blur);
      finishDrag();
    };
  }, [visible, cancelOpen, finishDrag, schedule]);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      !visibleRef.current ||
      drag.current
    )
      return;
    suppressClick.current = false;
    const scroller = scope.current?.querySelector<HTMLElement>(SCROLLER);
    if (!scroller) return;
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    if (max <= 0) return;
    const height = event.currentTarget.getBoundingClientRect().height;
    if (height <= 0) return;
    const share = scroller.clientHeight / Math.max(1, scroller.scrollHeight);
    // Pointer distances use the painted track, including CSS zoom.
    const scale = effectiveCssZoom(event.currentTarget);
    const thumb = Math.min(
      height,
      Math.max(MIN_THUMB_PX * scale, height * share),
    );
    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startTop: scroller.scrollTop,
      max,
      travel: Math.max(1, height - thumb),
      rail: event.currentTarget,
      scroller,
      active: false,
    };
  };

  /** The ripple follows the pointer at once. The card waits out a pass-through. */
  const hoverBar = (id: string, el: HTMLElement) => {
    if (!visibleRef.current) return;
    setHover({ id, el });
    if (drag.current?.active) return;
    if (open || openTimer.current != null) return;
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      if (visibleRef.current) setOpen(true);
    }, OPEN_DELAY_MS);
  };
  const showBar = (id: string, el: HTMLElement) => {
    if (!visibleRef.current) return;
    cancelOpen();
    setHover({ id, el });
    setOpen(true);
  };
  const close = () => {
    cancelOpen();
    setHover(null);
    setOpen(false);
  };

  const leaveRail = () => {
    pointerInside.current = false;
    if (drag.current?.active) return;
    // Keyboard focus holds the card open after the pointer moves away.
    if (keyboardFocused(rail.current)) return;
    close();
  };
  const blurRail = (event: ReactFocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    if (pointerInside.current) return;
    close();
  };

  const hoverId = hover?.id ?? null;
  const preview = useMemo(
    () => (hoverId ? promptPreview(blocks, hoverId) : null),
    [blocks, hoverId],
  );

  const jumpTo = (id: string) => {
    if (!visibleRef.current) return;
    const scroller = scope.current?.querySelector<HTMLElement>(SCROLLER);
    if (!scroller) return;
    // The transcript scrolls to the bottom on each streaming update until a
    // wheel-up event occurs. Send one, so the jump stays.
    scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -1 }));
    const selector = `[data-prompt-anchor="${CSS.escape(id)}"]`;
    let anchor = scroller.querySelector<HTMLElement>(selector);
    if (!anchor && revealBlock?.(id)) {
      anchor = scroller.querySelector<HTMLElement>(selector);
    }
    if (!anchor) {
      scroller.scrollTop = 0;
      return;
    }
    const target = anchor.closest<HTMLElement>(TURN) ?? anchor;
    const align = () => {
      if (!visibleRef.current) return;
      const delta =
        target.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        SCROLL_INSET_PX;
      if (Math.abs(delta) > 2) scroller.scrollTop += delta;
    };
    align();
    // Turns that enter the screen get their real height. That can move the
    // target.
    if (alignmentFrame.current != null)
      window.cancelAnimationFrame(alignmentFrame.current);
    alignmentFrame.current = window.requestAnimationFrame(() => {
      alignmentFrame.current = null;
      align();
    });
  };

  if (!visible || !hasRail) return null;

  const activeIndex = prompts.findIndex((prompt) => prompt.id === activeId);
  const stack = barStack(
    prompts.length,
    activeIndex >= 0 ? activeIndex : null,
    stackBudget,
  );
  const bars = prompts.slice(stack.start, stack.end);
  const hoverIndex = hover ? bars.findIndex((bar) => bar.id === hover.id) : -1;
  // One tab stop for prompt marks; the scroll thumb has its own.
  const tabId =
    [focusId, activeId].find((id) => bars.some((bar) => bar.id === id)) ??
    bars[0]?.id;

  const thumbHeight = Math.min(
    stackBudget,
    Math.max(MIN_THUMB_PX, stackBudget * scrollPosition.share),
  );
  const thumbTop =
    scrollPosition.max > 0
      ? (scrollPosition.top / scrollPosition.max) *
        Math.max(0, stackBudget - thumbHeight)
      : 0;

  const scrollByKey = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    const scroller = scope.current?.querySelector<HTMLElement>(SCROLLER);
    if (!scroller) return;
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const step = Math.max(40, scroller.clientHeight * 0.1);
    const page = scroller.clientHeight * 0.9;
    const destinations: Partial<Record<string, number>> = {
      ArrowUp: scroller.scrollTop - step,
      ArrowDown: scroller.scrollTop + step,
      PageUp: scroller.scrollTop - page,
      PageDown: scroller.scrollTop + page,
      Home: 0,
      End: max,
    };
    const next = destinations[event.key];
    if (next == null) return;
    event.preventDefault();
    event.stopPropagation();
    setTranscriptScrollDragging(scroller, true);
    scroller.scrollTop = Math.max(0, Math.min(max, next));
    setTranscriptScrollDragging(scroller, false);
    schedule();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const from = bars.findIndex((bar) => bar.id === tabId);
    const next = bars[from + step];
    if (!next) return;
    setFocusId(next.id);
    rail.current
      ?.querySelector<HTMLElement>(`[data-prompt-bar="${CSS.escape(next.id)}"]`)
      ?.focus();
  };

  return (
    <div
      ref={rail}
      role="toolbar"
      aria-label="Prompts"
      data-prompt-count={prompts.length}
      aria-orientation="vertical"
      data-dragging={dragging || undefined}
      style={{ width: BAR_WIDTH_LIFTED_PX, height: stackBudget }}
      onPointerDown={startDrag}
      onLostPointerCapture={finishDrag}
      onClickCapture={(event) => {
        if (!suppressClick.current || event.detail === 0) return;
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      onMouseEnter={() => {
        pointerInside.current = true;
      }}
      onMouseLeave={leaveRail}
      onBlur={blurRail}
      onKeyDown={onKeyDown}
      className="prompt-outline absolute top-1/2 right-1 z-30 flex -translate-y-1/2 flex-col items-end justify-center"
    >
      {scrollPosition.max > 0 ? (
        <span
          role="scrollbar"
          tabIndex={0}
          aria-label="Scroll chat"
          aria-controls={scrollPosition.id || undefined}
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(
            (scrollPosition.top / scrollPosition.max) * 100,
          )}
          onKeyDown={scrollByKey}
          style={{ top: thumbTop, height: thumbHeight }}
          className="prompt-outline-scrollbar"
        />
      ) : null}
      {bars.map((prompt, index) => {
        const lift = barLift(index, hoverIndex);
        const distance = hoverIndex < 0 ? 0 : Math.abs(index - hoverIndex);
        // The pointer owns the fill while it is on the rail. Off the rail, the
        // fill goes back to marking the scroll position.
        const lit =
          hoverIndex >= 0 ? index === hoverIndex : prompt.id === activeId;
        return (
          <button
            key={prompt.id}
            type="button"
            data-prompt-bar={prompt.id}
            tabIndex={prompt.id === tabId ? 0 : -1}
            aria-label={promptLabel(prompt)}
            aria-current={prompt.id === activeId ? "true" : undefined}
            onMouseEnter={(event) => hoverBar(prompt.id, event.currentTarget)}
            onFocus={(event) => {
              setFocusId(prompt.id);
              // A click focuses the bar too, and the pointer already opened
              // the card. Only arrow keys and Tab open it from here.
              if (event.currentTarget.matches(":focus-visible")) {
                showBar(prompt.id, event.currentTarget);
              }
            }}
            onClick={() => jumpTo(prompt.id)}
            style={{ height: BAR_HEIGHT_PX + stack.gap }}
            className="flex w-full shrink-0 items-center justify-end outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/60"
          >
            <span
              aria-hidden="true"
              style={{
                height: BAR_HEIGHT_PX,
                width:
                  BAR_WIDTH_PX + (BAR_WIDTH_LIFTED_PX - BAR_WIDTH_PX) * lift,
                opacity: lit ? BAR_OPACITY_LIT : BAR_OPACITY_IDLE,
                // The wave reaches the outer bars a beat after the hovered one.
                transitionDelay: `${Math.min(distance, RIPPLE_SPAN) * RIPPLE_STEP_MS}ms`,
              }}
              className="prompt-outline-bar rounded-full bg-content transition-[width,opacity] duration-200 ease-out"
            />
          </button>
        );
      })}
      {open && preview && hoverIndex >= 0 ? (
        <Popover
          anchor={hover?.el ?? null}
          side="left"
          align="center"
          gap={10}
          width={POPOVER_WIDTH}
          onDismiss={close}
          aria-label="Prompt preview"
          className="pointer-events-none flex flex-col gap-1.5 p-3 font-sans"
        >
          <p className="line-clamp-2 text-sm leading-snug text-content">
            {preview.title}
          </p>
          {preview.reply ? (
            <p className="line-clamp-2 text-sm leading-snug text-content/45">
              {preview.reply}
            </p>
          ) : null}
          {preview.detail ? (
            <p className="line-clamp-2 border-l-2 border-content/15 pl-3 text-sm leading-snug text-content/35">
              {preview.detail}
            </p>
          ) : null}
        </Popover>
      ) : null}
    </div>
  );
}

/** Clicking a bar focuses it as well. Only a keyboard focus holds the card open. */
function keyboardFocused(rail: HTMLElement | null): boolean {
  const el = document.activeElement;
  return (
    el instanceof HTMLElement &&
    !!rail?.contains(el) &&
    el.matches(":focus-visible")
  );
}

/**
 * content-visibility skips off-screen turns. A read inside a skipped turn
 * forces its layout. Use the turn box for an off-screen turn. Use the exact
 * prompt box for an on-screen turn.
 */
function promptBand(anchor: HTMLElement, viewport: DOMRect): OutlineBand {
  const turn = anchor.closest<HTMLElement>(TURN) ?? anchor;
  const turnBox = turn.getBoundingClientRect();
  const onScreen =
    turnBox.bottom > viewport.top && turnBox.top < viewport.bottom;
  const box =
    turn !== anchor && onScreen ? anchor.getBoundingClientRect() : turnBox;
  return { top: box.top, bottom: box.bottom };
}

/** One bar per prompt while the bars fit the budget. The gap shrinks first. Past that, a window slides. */
function barStack(count: number, activeIndex: number | null, budget: number) {
  const fit = Math.max(
    1,
    Math.floor((budget + BAR_GAP_MIN_PX) / (BAR_HEIGHT_PX + BAR_GAP_MIN_PX)),
  );
  const window_ = barWindow(count, activeIndex, fit);
  const shown = window_.end - window_.start;
  const gap =
    shown > 1
      ? Math.min(
          BAR_GAP_PX,
          Math.max(
            BAR_GAP_MIN_PX,
            Math.floor((budget - shown * BAR_HEIGHT_PX) / (shown - 1)),
          ),
        )
      : 0;
  return { ...window_, gap };
}

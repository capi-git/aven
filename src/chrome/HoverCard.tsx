import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import type { PopoverAlign, PopoverSide } from "../lib/popover";
import { Popover } from "./Popover";
import "./HoverCard.css";

/** Pointing has to rest this long before a card opens. */
export const HOVER_CARD_OPEN_MS = 380;
/** Moving between a trigger and its card within this time keeps it open. */
export const HOVER_CARD_CLOSE_MS = 150;
/** Once one card is out, the next opens almost at once, as menus do. */
export const HOVER_CARD_SWITCH_MS = 60;

// One card at a time across the whole window: opening one closes the rest.
let current: string | null = null;
const listeners = new Set<() => void>();
function setCurrent(id: string | null) {
  if (current === id) return;
  current = id;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
/** The card open now, for tests and for callers that peek without a hook. */
export const openHoverCardId = () => current;

export type HoverCardMode = "hover" | "pinned";

/** What a card reads from a pointer event: React's or the DOM's. */
export type HoverPointer = Pick<PointerEvent, "pointerType" | "buttons">;

export type HoverCardState = {
  open: boolean;
  /** "pinned" after a click: stays open until an outside click or Escape. */
  mode: HoverCardMode;
  /** Spread on the trigger. */
  triggerProps: {
    onPointerEnter: (event: HoverPointer) => void;
    onPointerLeave: (event: HoverPointer) => void;
  };
  /** Spread on the card body so moving onto it keeps it open. */
  cardProps: {
    onPointerEnter: () => void;
    onPointerLeave: () => void;
  };
  /** Opens and pins the card, or closes a pinned one: a button's click. */
  toggle: () => void;
  close: () => void;
};

/**
 * Hover and click behaviour shared by every hover card.
 *
 * Pointing rests for {@link HOVER_CARD_OPEN_MS} before a card opens; leaving
 * both the trigger and the card closes it. A click pins it like a menu. Only
 * a mouse opens a card by pointing, so a touch or pen tap does not.
 */
export function useHoverCard({
  disabled = false,
  openDelay = HOVER_CARD_OPEN_MS,
}: { disabled?: boolean; openDelay?: number } = {}): HoverCardState {
  const id = useId();
  // Each card reads only whether it is the open one, so opening a card
  // renders the two cards that change, not every trigger in a long list.
  const isOpen = useCallback(() => current === id, [id]);
  const active = useSyncExternalStore(subscribe, isOpen, isOpen);
  const [mode, setMode] = useState<HoverCardMode>("hover");
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const clearTimers = useCallback(() => {
    if (openTimer.current != null) window.clearTimeout(openTimer.current);
    if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);

  const close = useCallback(() => {
    clearTimers();
    setMode("hover");
    if (current === id) setCurrent(null);
  }, [clearTimers, id]);

  useEffect(() => clearTimers, [clearTimers]);
  useEffect(() => {
    if (disabled) close();
  }, [disabled, close]);
  useEffect(() => {
    if (!active && mode === "pinned") setMode("hover");
  }, [active, mode]);

  const scheduleClose = useCallback(() => {
    if (modeRef.current === "pinned") return;
    if (openTimer.current != null) window.clearTimeout(openTimer.current);
    openTimer.current = null;
    if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      if (current === id) setCurrent(null);
    }, HOVER_CARD_CLOSE_MS);
  }, [id]);

  const cancelClose = useCallback(() => {
    if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  const onPointerEnter = useCallback(
    (event: HoverPointer) => {
      // Only a mouse at rest: a button held down means a drag or a press.
      if (disabled || event.pointerType !== "mouse" || event.buttons !== 0)
        return;
      cancelClose();
      if (current === id || openTimer.current != null) return;
      const delay = current ? HOVER_CARD_SWITCH_MS : openDelay;
      openTimer.current = window.setTimeout(() => {
        openTimer.current = null;
        setMode("hover");
        setCurrent(id);
      }, delay);
    },
    [cancelClose, disabled, id, openDelay],
  );

  const onPointerLeave = useCallback(
    (event: HoverPointer) => {
      if (event.pointerType !== "mouse") return;
      scheduleClose();
    },
    [scheduleClose],
  );

  const toggle = useCallback(() => {
    if (disabled) return;
    clearTimers();
    if (current === id && modeRef.current === "pinned") {
      close();
      return;
    }
    setMode("pinned");
    setCurrent(id);
  }, [clearTimers, close, disabled, id]);

  return {
    open: active && !disabled,
    mode,
    triggerProps: { onPointerEnter, onPointerLeave },
    cardProps: { onPointerEnter: cancelClose, onPointerLeave: scheduleClose },
    toggle,
    close,
  };
}

export type HoverCardProps = {
  state: HoverCardState;
  anchor: RefObject<HTMLElement | null>;
  side?: PopoverSide;
  align?: PopoverAlign;
  width?: number;
  /** Read by screen readers; the card is a dialog when pinned. */
  label: string;
  children: ReactNode;
};

/**
 * The card itself: the shared popup glass, placed against its trigger.
 * Content uses the `hover-card-*` classes from `HoverCard.css`.
 */
export function HoverCard({
  state,
  anchor,
  side = "right",
  align = "start",
  width = 300,
  label,
  children,
}: HoverCardProps) {
  if (!state.open) return null;
  const pinned = state.mode === "pinned";
  return (
    <Popover
      anchor={anchor}
      side={side}
      align={align}
      gap={8}
      width={width}
      role={pinned ? "dialog" : "tooltip"}
      aria-label={label}
      autoFocus={pinned}
      tabIndex={-1}
      className="hover-card"
      onDismiss={(reason) => {
        state.close();
        if (reason === "escape" && pinned) anchor.current?.focus();
      }}
      {...state.cardProps}
    >
      {children}
    </Popover>
  );
}

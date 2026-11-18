import { memo, useEffect, useRef, type CSSProperties } from "react";
import type { OrbLook } from "@yogesharc/thinking-orbs";
import { mountOrb } from "@yogesharc/thinking-orbs/vanilla";
import { useOrbHold } from "../hooks/useOrbHold";
import "./ThinkingOrb.css";

/** Every orb is drawn in a 20-unit box and scaled by CSS to its size. */
const BOX = 20;

type Props = {
  look: OrbLook;
  /** Whether it moves at all; a still orb draws one frame and stops. */
  moving?: boolean;
  /**
   * `true` when it should keep moving after Aven has been left alone a
   * minute: working and needing you never settle.
   */
  urgent?: boolean;
  speed?: number;
  /** For screen readers; without one it is hidden from them. */
  label?: string;
  className?: string;
  style?: CSSProperties;
};

/** Whether this page can draw an orb (a test page may not). */
const canDraw =
  typeof window !== "undefined" &&
  typeof IntersectionObserver !== "undefined" &&
  typeof matchMedia !== "undefined" &&
  typeof requestAnimationFrame !== "undefined";

/** One observer for every orb: which are on screen. */
const seen = new Map<Element, (visible: boolean) => void>();
let observer: IntersectionObserver | null = null;

function watch(svg: Element, apply: (visible: boolean) => void) {
  observer ??= new IntersectionObserver((entries) => {
    for (const entry of entries) seen.get(entry.target)?.(entry.isIntersecting);
  });
  seen.set(svg, apply);
  observer.observe(svg);
}

function unwatch(svg: Element) {
  seen.delete(svg);
  observer?.unobserve(svg);
}

/**
 * A Thinking Orb (thinkingorbs.com, MIT): a sphere of dots in the text
 * colour, animated for what an agent is doing. It draws in `currentColor`,
 * fills its box, and moves only while it's on screen, the window is shown
 * and nothing is resizing. Reduce motion shows a still frame.
 */
export const ThinkingOrb = memo(function ThinkingOrb({
  look,
  moving = true,
  urgent = false,
  speed = 1,
  label,
  className = "",
  style,
}: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const handle = useRef<ReturnType<typeof mountOrb> | null>(null);
  const shown = useRef(false);
  const heldRef = useRef(true);
  const hold = useOrbHold();
  const held = !moving || (urgent ? hold.all : hold.resting);
  heldRef.current = held;
  const state = look.state;
  const variant = look.variant;
  // The library reads the system's Reduce motion once, as it mounts: mount
  // again when it changes, so an orb doesn't stay still after it is off.
  const reduced = hold.reduced;

  useEffect(() => {
    const svg = ref.current;
    if (!svg || !canDraw) return;
    const orb = mountOrb(svg, {
      ...({ state, variant } as OrbLook),
      size: BOX,
      speed,
      label,
    });
    // It runs a frame loop only while on screen: the library's own loop
    // keeps ticking off screen, so it starts held until it is seen.
    orb.pause();
    handle.current = orb;
    const apply = (visible: boolean) => {
      shown.current = visible;
      if (visible && !heldRef.current) orb.play();
      else orb.pause();
    };
    watch(svg, apply);
    return () => {
      unwatch(svg);
      handle.current = null;
      orb.destroy();
    };
  }, [state, variant, speed, label, reduced]);

  useEffect(() => {
    const orb = handle.current;
    if (!orb) return;
    if (held || !shown.current) orb.pause();
    else orb.play();
  }, [held, state, variant, speed, label, reduced]);

  return (
    <svg
      ref={ref}
      className={`thinking-orb ${className}`}
      viewBox={`0 0 ${BOX} ${BOX}`}
      fill="currentColor"
      data-orb={
        variant && variant !== "default"
          ? `${state}-${variant}`
          : (state ?? "idle")
      }
      style={style}
      {...(label
        ? { role: "img", "aria-label": label }
        : { "aria-hidden": true })}
    />
  );
});

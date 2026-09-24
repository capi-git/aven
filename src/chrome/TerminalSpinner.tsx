import { useEffect, useRef } from "react";

const FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
] as const;

export function TerminalSpinner({
  className = "inline-block w-3.5 select-none text-center text-[11px] leading-none",
}: {
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  // Write the glyph directly: a React state update every 80 ms re-rendered the
  // spinner (and ran effects) for every busy row. Pause while the window is
  // hidden.
  useEffect(() => {
    let frame = 0;
    let id: number | undefined;
    const tick = () => {
      frame = (frame + 1) % FRAMES.length;
      const glyph = ref.current?.firstChild;
      if (glyph) glyph.nodeValue = FRAMES[frame];
    };
    const sync = () => {
      window.clearInterval(id);
      id = document.hidden ? undefined : window.setInterval(tick, 80);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      window.clearInterval(id);
    };
  }, []);

  return (
    <span ref={ref} aria-hidden className={className}>
      {FRAMES[0]}
    </span>
  );
}

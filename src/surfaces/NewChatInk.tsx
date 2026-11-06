import { type RefObject, useEffect, useRef, useState } from "react";
import { useInkField } from "../hooks/useInkField";
import "./NewChatInk.css";

/** Past the fade's own length, in case WebKit holds the transition back. */
const FADE_OUT_MS = 520;

type Props = {
  /** The chat's message area: the pointer over it stirs the ink. */
  host: RefObject<HTMLElement | null>;
  /** A new chat with nothing in it yet, where the ink belongs. */
  active: boolean;
  /** The chat is on screen; off screen the ink holds still. */
  visible: boolean;
};

/**
 * The ink behind a new chat (`src/lib/inkField.ts`). It sits under the
 * chat's words and takes no input of its own. Once the chat has messages it
 * fades out and goes.
 */
export function NewChatInk({ host, active, visible }: Props) {
  const [present, setPresent] = useState(active);
  const canvas = useRef<HTMLCanvasElement>(null);
  if (active && !present) setPresent(true);
  const leaving = present && !active;

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setPresent(false), FADE_OUT_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  useInkField(host, canvas, present && active && visible);

  // Off screen the canvas goes, so a hidden new chat holds no drawing; the
  // field lives on in the hook and draws again when the chat is shown.
  if (!present || !visible) return null;
  return (
    <div
      className="new-chat-ink"
      data-leaving={leaving || undefined}
      aria-hidden="true"
    >
      <canvas ref={canvas} />
    </div>
  );
}

import { MOTION_EASE, motionReduced } from "./motion";

// What you send flies from the message box into its bubble, after Rune's
// `Tx::fly_text` and opencode's send flight (github.com/anomalyco/rune,
// crates/rune/README.md and research/18-desktop-timeline-motion.md, MIT,
// © 2026 Anomaly). A copy of the box's visible words and a copy of the new
// bubble travel together on one 320 ms curve: the words fade out early and
// the bubble fades in, so where the two wrap differently it reads as one
// message moving. Only transforms and opacity move, above the transcript,
// so its scroller never clips them. Reduce motion: no flight.

export const SEND_FLIGHT_MS = 320;
/** A send whose bubble takes longer than this to appear doesn't fly. */
const PENDING_MS = 400;

type TakeOff = {
  text: string;
  /** The words as the box drew them, with its own font and colour. */
  copy: HTMLElement;
  /** Where the box drew them (viewport). */
  rect: DOMRect;
  /** Where the first line of words starts (viewport). */
  textLeft: number;
  textTop: number;
  /** How tall its lines are, without the box's padding. */
  textHeight: number;
  at: number;
};

let pending: TakeOff | null = null;

/**
 * Called by the message box as it sends `text`, before it clears: keeps a
 * copy of the words it shows and where they are.
 */
export function takeOffSentText(source: HTMLElement | null, text: string) {
  pending = null;
  if (!source || !text.trim() || motionReduced()) return;
  const rect = source.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const style = getComputedStyle(source);
  const copy = source.cloneNode(true) as HTMLElement;
  copy.removeAttribute("id");
  for (const name of [
    "font-family",
    "font-size",
    "font-weight",
    "line-height",
    "letter-spacing",
    "color",
    "white-space",
    "overflow-wrap",
    "word-break",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
  ])
    copy.style.setProperty(name, style.getPropertyValue(name));
  copy.dataset.scrollTop = String(source.scrollTop);
  pending = {
    text,
    copy,
    rect,
    textLeft: rect.left + (Number.parseFloat(style.paddingLeft) || 0),
    textTop: rect.top + (Number.parseFloat(style.paddingTop) || 0),
    textHeight:
      source.scrollHeight -
      (Number.parseFloat(style.paddingTop) || 0) -
      (Number.parseFloat(style.paddingBottom) || 0),
    at: performance.now(),
  };
}

/** Whether a sent message's words match what the box sent. */
export function sameSentText(sent: string, shown: string): boolean {
  const tidy = (value: string) => value.replace(/\s+/g, " ").trim();
  const a = tidy(sent);
  const b = tidy(shown);
  return a.length > 0 && (a === b || b.startsWith(a) || a.startsWith(b));
}

/**
 * Called as a sent message's bubble first appears: flies the words the box
 * just sent into it and returns true, or returns false when nothing was sent
 * from a box just now (an older message, another window), so the caller
 * plays its usual entrance.
 */
export function landSentText(bubble: HTMLElement, text: string): boolean {
  const flight = pending;
  if (!flight) return false;
  if (performance.now() - flight.at > PENDING_MS) {
    pending = null;
    return false;
  }
  if (!sameSentText(flight.text, text) || motionReduced()) return false;
  pending = null;
  if (typeof bubble.animate !== "function") return false;
  // Hidden where it lands until the copy arrives; measured once the
  // transcript has settled this commit (it pins the new message first).
  bubble.style.opacity = "0";
  queueMicrotask(() => fly(bubble, flight));
  return true;
}

function fly(bubble: HTMLElement, flight: TakeOff) {
  const show = () => {
    bubble.style.opacity = "";
  };
  if (!bubble.isConnected) return;
  const box = bubble.getBoundingClientRect();
  const words =
    bubble.querySelector<HTMLElement>("pre") ?? bubble.firstElementChild;
  const wordsBox = (words as HTMLElement | null)?.getBoundingClientRect();
  if (
    box.width <= 0 ||
    box.bottom < 0 ||
    box.top > window.innerHeight ||
    !wordsBox
  ) {
    show();
    return;
  }
  const layer = flightLayer(bubble);
  const origin = layer.getBoundingClientRect();

  const landing = bubble.cloneNode(true) as HTMLElement;
  landing.style.cssText += `;position:absolute;margin:0;left:${box.left - origin.left}px;top:${box.top - origin.top}px;width:${box.width}px;height:${box.height}px;opacity:1;pointer-events:none`;
  const words0 = flight.copy;
  words0.style.position = "absolute";
  words0.style.margin = "0";
  words0.style.left = `${flight.rect.left - origin.left}px`;
  words0.style.top = `${flight.rect.top - origin.top}px`;
  words0.style.width = `${flight.rect.width}px`;
  words0.style.height = `${flight.rect.height}px`;
  words0.style.overflow = "hidden";
  words0.style.pointerEvents = "none";
  words0.style.inset = "";
  layer.append(landing, words0);
  words0.scrollTop = Number(words0.dataset.scrollTop ?? 0);

  // Line the box's first word up with the bubble's.
  const dx = flight.textLeft - wordsBox.left;
  const dy = flight.textTop - wordsBox.top;
  // Words that wrap the same hand over late; different wraps cross early.
  const sameWrap =
    Math.abs(flight.textHeight - wordsBox.height) <= 2 + wordsBox.height * 0.1;
  const out = sameWrap ? 0.4 : 0.25;
  const inFrom = sameWrap ? 0.15 : 0.1;
  const inTo = sameWrap ? 0.5 : 0.4;
  const timing: KeyframeAnimationOptions = {
    duration: SEND_FLIGHT_MS,
    easing: MOTION_EASE.spring,
    fill: "forwards",
  };
  const arrive = landing.animate(
    [
      { transform: `translate(${dx}px, ${dy}px)`, opacity: 0, offset: 0 },
      { opacity: 0, offset: inFrom },
      { opacity: 1, offset: inTo },
      { transform: "none", opacity: 1, offset: 1 },
    ],
    timing,
  );
  const leave = words0.animate(
    [
      { transform: "none", opacity: 1, offset: 0 },
      { opacity: 0, offset: out },
      { transform: `translate(${-dx}px, ${-dy}px)`, opacity: 0, offset: 1 },
    ],
    timing,
  );
  let done = false;
  const land = () => {
    if (done) return;
    done = true;
    show();
    landing.remove();
    words0.remove();
    if (!layer.childElementCount) layer.remove();
  };
  void Promise.allSettled([arrive.finished, leave.finished]).then(land);
  // A bubble that goes away mid-flight (a closed tab) takes the copy along.
  window.setTimeout(land, SEND_FLIGHT_MS + 200);
}

function flightLayer(bubble: HTMLElement): HTMLElement {
  const host = bubble.closest<HTMLElement>(".personal-shell") ?? document.body;
  let layer = host.querySelector<HTMLElement>(":scope > .send-flight-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "send-flight-layer";
    layer.setAttribute("aria-hidden", "true");
    host.append(layer);
  }
  return layer;
}

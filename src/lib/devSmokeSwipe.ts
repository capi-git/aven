import { invoke } from "@tauri-apps/api/core";
import { viewportRect } from "./drag";
import { loadUiScale } from "./uiScale";

export type SwipePhase =
  | "began"
  | "changed"
  | "ended"
  | "momentum-begin"
  | "momentum"
  | "momentum-end";

export type SwipeStep = { phase: SwipePhase; dx: number };

/**
 * A quick two-finger swipe as a Mac trackpad reports it: the fingers move
 * `distance` CSS pixels over `frames` display frames, speeding up and then
 * easing a little before they lift, and momentum follows from the speed at
 * the lift, decaying each frame. Positive moves the content left (towards
 * the next page). Every step is one display frame apart.
 */
export function swipeSteps(distance: number, frames = 10): SwipeStep[] {
  const steps: SwipeStep[] = [];
  // A half sine: slow at the touch, fastest in the middle, slower at lift.
  const weights = Array.from({ length: frames }, (_, index) =>
    Math.sin((Math.PI * (index + 0.5)) / frames),
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const moves = weights.map((weight) => (distance * weight) / total);
  moves.forEach((dx, index) =>
    steps.push({ phase: index ? "changed" : "began", dx }),
  );
  steps.push({ phase: "ended", dx: 0 });
  // Momentum carries on from the lift's speed, a trackpad's usual decay.
  let speed = moves
    .slice(-3)
    .reduce((fast, move) => (Math.abs(move) > Math.abs(fast) ? move : fast));
  steps.push({ phase: "momentum-begin", dx: speed });
  while (Math.abs(speed) >= 0.5) {
    speed *= 0.9;
    steps.push({ phase: "momentum", dx: speed });
  }
  steps.push({ phase: "momentum-end", dx: 0 });
  return steps;
}

/**
 * One trackpad scroll event over `at` (client pixels): the workspace's web
 * view gets it from AppKit (`dev_smoke_scroll`, debug builds only), so
 * WebKit scrolls, snaps and fires scroll events as for a person's fingers.
 */
export function smokeScroll(at: { x: number; y: number }, step: SwipeStep) {
  return invoke("dev_smoke_scroll", {
    x: at.x,
    y: at.y,
    zoom: loadUiScale(),
    dx: step.dx,
    phase: step.phase,
  });
}

/** The middle of `element`, where a swipe over it starts. */
export function swipePoint(element: HTMLElement) {
  const box = viewportRect(element, element.getBoundingClientRect());
  return { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
}

/**
 * Plays `swipeSteps` over `element`, one step per `frameMs`, sending each as
 * soon as the last is delivered, as the trackpad's events arrive at the
 * display's rate whatever the page is doing.
 */
export async function smokeSwipe(
  element: HTMLElement,
  distance: number,
  frameMs: number,
) {
  const at = swipePoint(element);
  const started = performance.now();
  const steps = swipeSteps(distance);
  for (let index = 0; index < steps.length; index += 1) {
    const due = started + index * frameMs;
    const wait = due - performance.now();
    if (wait > 1) await new Promise((resolve) => setTimeout(resolve, wait));
    await smokeScroll(at, steps[index]);
  }
}

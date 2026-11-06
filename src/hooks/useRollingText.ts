import { useLayoutEffect, useRef } from "react";
import { MOTION_EASE, motionReduced } from "../lib/motion";
import {
  glyphs as splitGlyphs,
  matchGlyphs,
  ROLL_MS,
  ROLL_STAGGER_CAP,
  ROLL_STAGGER_MS,
  rollsDown,
} from "../lib/rollingText";

type Glyph = { char: string; node: HTMLSpanElement };
type Memory = { glyphs: Glyph[]; value?: number; settle: number };

/** How far a rolling character travels: its own height, out of sight. */
const TRAVEL = "100%";
/** Levels above the label whose children glide when its width changes. */
const NEIGHBOUR_LEVELS = 3;
const gliding = new WeakMap<Element, Animation>();

/**
 * Fills `row` with one span per character of `text` and, when the text
 * changes, rolls only the characters that changed: kept ones slide to their
 * new place, new ones roll in and old ones out, up as `value` rises and down
 * as it falls. Whatever sits beside the label glides to where its new width
 * puts it rather than jumping. Only transforms and opacity move, and nothing
 * moves with Reduce motion on.
 */
export function useRollingText(
  row: { readonly current: HTMLElement | null },
  text: string,
  value?: number,
  trailing = false,
) {
  const memory = useRef<Memory | null>(null);
  useLayoutEffect(() => {
    const element = row.current;
    if (!element) return;
    const next = splitGlyphs(text);
    const known = memory.current;
    if (!known) {
      const glyphs = next.map(makeGlyph);
      element.replaceChildren(...glyphs.map((glyph) => glyph.node));
      memory.current = { glyphs, value: finite(value), settle: 0 };
      return;
    }
    const before = known.glyphs.map((glyph) => glyph.char);
    const down = rollsDown(known.value, value);
    if (finite(value) != null) known.value = value;
    if (before.join("") === text) return;

    const matched = matchGlyphs(before, next, trailing);
    const animate =
      !motionReduced() &&
      element.isConnected &&
      typeof element.animate === "function";
    // Where everything is drawn now, mid-roll included, before the change.
    const oldLeft = animate
      ? known.glyphs.map((glyph) => glyph.node.getBoundingClientRect().left)
      : [];
    const neighbours = animate ? captureNeighbours(element) : [];

    const kept = new Set<number>();
    const glyphs = next.map((char, index) => {
      const from = matched[index];
      if (from == null) return makeGlyph(char);
      kept.add(from);
      return known.glyphs[from];
    });
    const leaving = known.glyphs
      .map((glyph, index) => ({ glyph, left: oldLeft[index] }))
      .filter((_, index) => !kept.has(index));
    element.replaceChildren(...glyphs.map((glyph) => glyph.node));
    known.glyphs = glyphs;
    if (!animate) return;

    const settle = ++known.settle;
    element.setAttribute("data-rolling", "");
    const rowLeft = element.getBoundingClientRect().left;
    const enter = down ? `-${TRAVEL}` : TRAVEL;
    const exit = down ? TRAVEL : `-${TRAVEL}`;
    const running: Animation[] = [];
    let rank = 0;
    glyphs.forEach((glyph, index) => {
      const from = matched[index];
      if (from == null) {
        const stagger = ROLL_STAGGER_MS * Math.min(rank, ROLL_STAGGER_CAP);
        rank += 1;
        running.push(
          glyph.node.animate(
            [
              { transform: `translateY(${enter})`, opacity: 0 },
              { transform: "none", opacity: 1 },
            ],
            { duration: ROLL_MS + stagger, easing: MOTION_EASE.out },
          ),
        );
        return;
      }
      for (const old of glyph.node.getAnimations()) old.cancel();
      const dx = oldLeft[from] - glyph.node.getBoundingClientRect().left;
      if (Math.abs(dx) < 0.5) return;
      running.push(
        glyph.node.animate(
          [{ transform: `translateX(${dx}px)` }, { transform: "none" }],
          { duration: ROLL_MS, easing: MOTION_EASE.out },
        ),
      );
    });
    for (const { glyph, left } of leaving) {
      const node = glyph.node;
      for (const old of node.getAnimations()) old.cancel();
      node.setAttribute("aria-hidden", "true");
      node.classList.add("rolling-text-leaving");
      node.style.left = `${left - rowLeft}px`;
      element.appendChild(node);
      const out = node.animate(
        [
          { transform: "none", opacity: 1 },
          { transform: `translateY(${exit})`, opacity: 0 },
        ],
        { duration: ROLL_MS, easing: MOTION_EASE.out, fill: "forwards" },
      );
      void out.finished.then(
        () => node.remove(),
        () => node.remove(),
      );
      running.push(out);
    }
    running.push(...glideNeighbours(neighbours));
    void Promise.allSettled(
      running.map((animation) => animation.finished),
    ).then(() => {
      if (memory.current?.settle === settle) {
        element.removeAttribute("data-rolling");
      }
    });
  }, [row, text, value, trailing]);
}

function makeGlyph(char: string): Glyph {
  const node = document.createElement("span");
  node.className = "rolling-text-glyph";
  node.textContent = char;
  return { char, node };
}

function finite(value: number | undefined): number | undefined {
  return value != null && Number.isFinite(value) ? value : undefined;
}

type Neighbour = { node: HTMLElement; left: number; top: number };

/**
 * The elements beside the label, and beside each of its parents up to a few
 * levels or a `data-roll-scope` ancestor: the ones its width can move.
 */
function captureNeighbours(label: HTMLElement): Neighbour[] {
  const out: Neighbour[] = [];
  let child: Element = label;
  let parent = label.parentElement;
  for (let level = 0; level < NEIGHBOUR_LEVELS && parent; level += 1) {
    for (const sibling of parent.children) {
      if (sibling === child || !(sibling instanceof HTMLElement)) continue;
      const box = sibling.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;
      out.push({ node: sibling, left: box.left, top: box.top });
    }
    if (parent.hasAttribute("data-roll-scope")) break;
    child = parent;
    parent = parent.parentElement;
  }
  return out;
}

/** Slides each neighbour the label's new width moved from where it was. */
function glideNeighbours(neighbours: readonly Neighbour[]): Animation[] {
  const out: Animation[] = [];
  for (const { node, left, top } of neighbours) {
    gliding.get(node)?.cancel();
    const box = node.getBoundingClientRect();
    const dx = left - box.left;
    if (Math.abs(dx) < 0.5 || Math.abs(top - box.top) >= 1) continue;
    const animation = node.animate(
      [{ transform: `translateX(${dx}px)` }, { transform: "none" }],
      { duration: ROLL_MS, easing: MOTION_EASE.out, composite: "add" },
    );
    gliding.set(node, animation);
    out.push(animation);
  }
  return out;
}

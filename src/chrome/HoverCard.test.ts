// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOVER_CARD_CLOSE_MS,
  HOVER_CARD_OPEN_MS,
  HOVER_CARD_SWITCH_MS,
  useHoverCard,
  type HoverCardState,
} from "./HoverCard";

const mouse = { pointerType: "mouse", buttons: 0 };

describe("useHoverCard", () => {
  let root: Root;
  let container: HTMLDivElement;
  const cards: Record<string, HoverCardState> = {};
  const renders: Record<string, number> = {};

  function Card({ name, disabled }: { name: string; disabled?: boolean }) {
    cards[name] = useHoverCard({ disabled });
    renders[name] = (renders[name] ?? 0) + 1;
    return null;
  }
  const render = (names: string[], disabled: string[] = []) =>
    act(() =>
      root.render(
        names.map((name) =>
          createElement(Card, {
            key: name,
            name,
            disabled: disabled.includes(name),
          }),
        ),
      ),
    );
  const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
    for (const key of Object.keys(renders)) delete renders[key];
  });

  it("opens only after pointing rests", () => {
    render(["a"]);
    act(() => cards.a.triggerProps.onPointerEnter(mouse));
    wait(HOVER_CARD_OPEN_MS - 10);
    expect(cards.a.open).toBe(false);
    wait(10);
    expect(cards.a.open).toBe(true);
    expect(cards.a.mode).toBe("hover");
  });

  it("does not open when the pointer passes through", () => {
    render(["a"]);
    act(() => cards.a.triggerProps.onPointerEnter(mouse));
    wait(100);
    act(() => cards.a.triggerProps.onPointerLeave(mouse));
    wait(HOVER_CARD_OPEN_MS);
    expect(cards.a.open).toBe(false);
  });

  it("closes after leaving, unless the pointer reaches the card", () => {
    render(["a"]);
    act(() => cards.a.triggerProps.onPointerEnter(mouse));
    wait(HOVER_CARD_OPEN_MS);
    act(() => cards.a.triggerProps.onPointerLeave(mouse));
    act(() => cards.a.cardProps.onPointerEnter());
    wait(HOVER_CARD_CLOSE_MS * 2);
    expect(cards.a.open).toBe(true);
    act(() => cards.a.cardProps.onPointerLeave());
    wait(HOVER_CARD_CLOSE_MS);
    expect(cards.a.open).toBe(false);
  });

  it("shows one card at a time, and the next one quickly", () => {
    render(["a", "b"]);
    act(() => cards.a.triggerProps.onPointerEnter(mouse));
    wait(HOVER_CARD_OPEN_MS);
    act(() => cards.a.triggerProps.onPointerLeave(mouse));
    act(() => cards.b.triggerProps.onPointerEnter(mouse));
    wait(HOVER_CARD_SWITCH_MS);
    expect(cards.a.open).toBe(false);
    expect(cards.b.open).toBe(true);
  });

  it("re-renders only the cards that open or close", () => {
    render(["a", "b", "c"]);
    const before = renders.c;
    act(() => cards.a.triggerProps.onPointerEnter(mouse));
    wait(HOVER_CARD_OPEN_MS);
    act(() => cards.b.toggle());
    expect(renders.c).toBe(before);
  });

  it("pins on toggle and stays through leaving; toggling again closes", () => {
    render(["a"]);
    act(() => cards.a.toggle());
    expect(cards.a.open).toBe(true);
    expect(cards.a.mode).toBe("pinned");
    act(() => cards.a.triggerProps.onPointerLeave(mouse));
    wait(HOVER_CARD_CLOSE_MS * 2);
    expect(cards.a.open).toBe(true);
    act(() => cards.a.toggle());
    expect(cards.a.open).toBe(false);
  });

  it("opens for a mouse only, and not while a button is held", () => {
    render(["a"]);
    act(() =>
      cards.a.triggerProps.onPointerEnter({ pointerType: "touch", buttons: 0 }),
    );
    act(() =>
      cards.a.triggerProps.onPointerEnter({ pointerType: "pen", buttons: 0 }),
    );
    act(() =>
      cards.a.triggerProps.onPointerEnter({ pointerType: "mouse", buttons: 1 }),
    );
    wait(HOVER_CARD_OPEN_MS * 2);
    expect(cards.a.open).toBe(false);
  });

  it("closes and stays shut while disabled", () => {
    render(["a"]);
    act(() => cards.a.toggle());
    render(["a"], ["a"]);
    expect(cards.a.open).toBe(false);
    act(() => cards.a.triggerProps.onPointerEnter(mouse));
    wait(HOVER_CARD_OPEN_MS);
    expect(cards.a.open).toBe(false);
  });
});

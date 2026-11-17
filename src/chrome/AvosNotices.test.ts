// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AvosNotice } from "../lib/avos";
import type { ScheduledRun } from "../lib/scheduledAgents";
import { BROWSER_OVERLAYS } from "../lib/browserOverlays";
import { AvosNoticeCard } from "./AvosNotices";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const notice: AvosNotice = {
  id: "/work/clippedin\nrun:r1",
  path: "/work/clippedin",
  text: "Ready to publish: 2 new articles",
  open: { kind: "run", runId: "r1" },
  runId: "r1",
};
const run = {
  id: "r1",
  review: { status: "open", kind: "publish", title: "2 new articles" },
} as unknown as ScheduledRun;
const runs = new Map([["r1", run]]);
const review: AvosNotice = {
  id: "/work/clippedin\nready",
  path: "/work/clippedin",
  text: "Look at 2 finished cards",
  open: { kind: "review" },
};
const button = (name: string) =>
  [...container.querySelectorAll("button")].find(
    (item) => item.textContent === name,
  );

it("says which Avos needs you and why, with Look at it and Publish", async () => {
  const onOpen = vi.fn();
  const onAnswer = vi.fn();
  const onDismiss = vi.fn();
  await act(async () =>
    root.render(
      createElement(AvosNoticeCard, {
        path: notice.path,
        notices: [notice],
        runs,
        onOpen,
        onAnswer,
        onDismiss,
      }),
    ),
  );
  const card = container.querySelector<HTMLElement>("[data-avos-notice]")!;
  expect(card.textContent).toContain("Avos · clippedin");
  expect(card.textContent).not.toContain("need you");
  expect(card.textContent).toContain("Ready to publish: 2 new articles");
  expect(
    card.querySelector<HTMLElement>("[data-crew-critter=lead] .agent-mark")
      ?.dataset.agent,
  ).toBe("needs");
  await act(async () => button("Publish")!.click());
  expect(onAnswer).toHaveBeenCalledWith(run);
  expect(onDismiss).toHaveBeenCalledWith([notice.id]);
  await act(async () => button("Look at it")!.click());
  expect(onOpen).toHaveBeenCalledWith(notice);
});

it("offers only Look at them for work to review, and closes on ×", async () => {
  const onDismiss = vi.fn();
  await act(async () =>
    root.render(
      createElement(AvosNoticeCard, {
        path: review.path,
        notices: [review],
        onOpen: vi.fn(),
        onAnswer: vi.fn(),
        onDismiss,
      }),
    ),
  );
  expect(button("Look at them")).toBeTruthy();
  expect(container.querySelector("[data-avos-notice-answer]")).toBeNull();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click(),
  );
  expect(onDismiss).toHaveBeenCalledWith([review.id]);
});

it("puts a project's things on one card, each with its own buttons", async () => {
  const onOpen = vi.fn();
  const onAnswer = vi.fn();
  const onDismiss = vi.fn();
  await act(async () =>
    root.render(
      createElement(AvosNoticeCard, {
        path: notice.path,
        notices: [review, notice],
        runs,
        onOpen,
        onAnswer,
        onDismiss,
      }),
    ),
  );
  expect(container.querySelectorAll("[data-avos-notice]")).toHaveLength(1);
  const card = container.querySelector<HTMLElement>("[data-avos-notice]")!;
  expect(card.querySelector("p")?.textContent).toBe(
    "Avos · clippedin · 2 things need you",
  );
  const rows = [
    ...card.querySelectorAll<HTMLElement>("[data-avos-notice-item]"),
  ];
  expect(rows.map((row) => row.dataset.avosNoticeItem)).toEqual([
    review.id,
    notice.id,
  ]);
  expect(rows[0]!.textContent).toBe("Look at 2 finished cardsLook at them");
  expect(rows[1]!.textContent).toBe(
    "Ready to publish: 2 new articlesLook at itPublish",
  );
  // Each button answers its own thing, and takes only that off the card.
  await act(async () => button("Look at them")!.click());
  expect(onOpen).toHaveBeenCalledWith(review);
  expect(onDismiss).toHaveBeenLastCalledWith([review.id]);
  await act(async () => button("Publish")!.click());
  expect(onAnswer).toHaveBeenCalledWith(run);
  expect(onDismiss).toHaveBeenLastCalledWith([notice.id]);
  // Closing takes all of them.
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click(),
  );
  expect(onDismiss).toHaveBeenLastCalledWith([review.id, notice.id]);
});

it("keeps a long line inside the card, whole on hover, and cut out of a page", async () => {
  const long: AvosNotice = {
    ...notice,
    id: "/work/clippedin\nquestion",
    text: "“Skip today's every-day reminder once it is ticked” needs you to choose how it should work",
  };
  for (const notices of [[long], [review, long]]) {
    await act(async () =>
      root.render(
        createElement(AvosNoticeCard, {
          path: notice.path,
          notices,
          onOpen: vi.fn(),
          onAnswer: vi.fn(),
          onDismiss: vi.fn(),
        }),
      ),
    );
    const card = container.querySelector<HTMLElement>("[data-avos-notice]")!;
    // A native browser page leaves a hole where the card is.
    expect(card.matches(BROWSER_OVERLAYS)).toBe(true);
    // The line wraps to two lines at most (the class clamps it), never one
    // line cut off, and its whole text shows on hover.
    const line = [
      ...card.querySelectorAll<HTMLElement>(".avos-notice-text"),
    ].find((item) => item.textContent === long.text)!;
    expect(line.title).toBe(long.text);
    expect(line.className).not.toContain("truncate");
  }
});

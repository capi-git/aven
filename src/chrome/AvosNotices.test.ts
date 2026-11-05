// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AvosNotice } from "../lib/avos";
import type { ScheduledRun } from "../lib/scheduledAgents";
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
        notice,
        run,
        onOpen,
        onAnswer,
        onDismiss,
      }),
    ),
  );
  const card = container.querySelector<HTMLElement>("[data-avos-notice]")!;
  expect(card.textContent).toContain("Avos · clippedin");
  expect(card.textContent).toContain("Ready to publish: 2 new articles");
  expect(
    card.querySelector<HTMLElement>("[data-crew-critter=lead] .agent-mark")
      ?.dataset.agent,
  ).toBe("needs");
  await act(async () => button("Publish")!.click());
  expect(onAnswer).toHaveBeenCalledWith(run);
  expect(onDismiss).toHaveBeenCalledWith(notice.id);
  await act(async () => button("Look at it")!.click());
  expect(onOpen).toHaveBeenCalledWith(notice);
});

it("offers only Look at it for work to review, and closes on ×", async () => {
  const onDismiss = vi.fn();
  await act(async () =>
    root.render(
      createElement(AvosNoticeCard, {
        notice: {
          ...notice,
          id: "ready",
          text: "Look at 2 finished cards",
          open: { kind: "review" },
          runId: undefined,
        } as AvosNotice,
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
  expect(onDismiss).toHaveBeenCalledWith("ready");
});

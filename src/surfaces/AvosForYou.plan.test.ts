// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newCrew } from "../lib/crews";
import { AvosForYou, type AvosAsk } from "./AvosForYou";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const idea = (id: string, text: string, pick?: string): AvosAsk => ({
  id: `idea:${id}`,
  kind: "idea",
  text,
  cardId: id,
  ...(pick ? { pick } : {}),
  actions: [
    { id: "give", label: "Build it", primary: true },
    { id: "not-now", label: "Not now" },
  ],
});

async function render(asks: AvosAsk[]) {
  const onAct = vi.fn();
  await act(async () =>
    root.render(
      createElement(AvosForYou, {
        project: "/Users/me/pom",
        crew: newCrew("/Users/me/pom", 1),
        asks,
        range: null,
        problems: {},
        onReview: vi.fn(),
        onAct,
      }),
    ),
  );
  return onAct;
}

it("lays two or more of Avos's jobs out as a plan, with its picks, Go and Change", async () => {
  const onAct = await render([
    idea("a", "Three settings page options", "Sonnet 5 · Medium"),
    idea("b", "Fix tab drag over a page", "Opus 5.5 · High"),
  ]);
  expect(host.querySelector(".team-post-text")?.textContent).toBe(
    "Here’s how I’d do it.",
  );
  expect(
    [...host.querySelectorAll(".avos-ask-text span")].map(
      (line) => line.textContent,
    ),
  ).toEqual(["Sonnet 5 · Medium", "Opus 5.5 · High"]);
  const plan = host.querySelector<HTMLElement>("[data-avos-plan]")!;
  const go = [...plan.querySelectorAll("button")].find(
    (button) => button.textContent === "Go",
  )!;
  await act(async () => go.click());
  expect(onAct.mock.calls).toEqual([
    ["a", "give"],
    ["b", "give"],
  ]);
});

it("keeps one idea as one idea, with no plan", async () => {
  await render([idea("a", "Fix tab drag over a page")]);
  expect(host.querySelector("[data-avos-plan]")).toBeNull();
  expect(host.querySelector(".team-post-text")?.textContent).toBe(
    "An idea, if you want it built.",
  );
});

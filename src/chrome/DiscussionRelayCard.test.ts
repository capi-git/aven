// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DiscussionRelayMeta } from "../lib/session";
import { DiscussionRelayCard } from "./DiscussionRelayCard";

vi.mock("./ProjectMark", () => ({
  ProjectMark: ({ path }: { path?: string }) =>
    createElement("span", { "data-project-mark": path }),
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

const meta = (patch: Partial<DiscussionRelayMeta>): DiscussionRelayMeta => ({
  id: "d1",
  turn: 0,
  rounds: 3,
  partner: {
    harness: "codex",
    model: "GPT-5",
    title: "Review",
    cwd: "/work/api",
  },
  ...patch,
});

async function render(value: DiscussionRelayMeta) {
  await act(async () =>
    root.render(createElement(DiscussionRelayCard, { meta: value })),
  );
}

it("labels the opening topic with the chat it will discuss with", async () => {
  await render(meta({}));
  expect(container.textContent).toBe(
    "Discussion withGPT-5 in “Review”· 3 rounds",
  );
  expect(
    container.querySelector('[data-project-mark="/work/api"]'),
  ).not.toBeNull();
});

it("marks a relayed reply with its sender, round and shortening", async () => {
  await render(meta({ turn: 3, truncated: true }));
  expect(container.textContent).toBe(
    "Relayed fromGPT-5 in “Review”· round 2 of 3 · shortened",
  );
});

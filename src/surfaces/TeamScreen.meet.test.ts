// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installCrewWorkspace } from "../lib/crewActions";
import { ensureAvos, resetCrewsCache, updateCrew } from "../lib/crews";
import { memoryStorage } from "../lib/devSmoke";
import {
  memoryFeatureCardBackend,
  setFeatureCardBackend,
} from "../lib/featureCards";
import { resetProjectBotsCache } from "../lib/projectBots";
import { resetTeamViewCache } from "../lib/teamView";
import {
  installWorkBoardActions,
  publishWorkBoardFeed,
  resetWorkBoardFeed,
} from "../lib/workBoardFeed";
import { WorkBoard } from "./WorkBoard";

const actions = vi.hoisted(() => ({
  tellTeam: vi.fn(async () => null as string | null),
}));
vi.mock("../lib/crewActions", async (original) => ({
  ...(await original<typeof import("../lib/crewActions")>()),
  ...actions,
}));
vi.mock("../hooks/useProjectBots", () => ({ claudeWeeklyUsed: () => 40 }));
vi.mock("../chrome/ProjectMark", () => ({ ProjectMark: () => null }));

const PROJECT = "/work/clippedin";
const NOW = new Date(2026, 10, 5, 9, 0).getTime();
let root: Root;
let container: HTMLDivElement;
let uninstall: () => void;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("localStorage", memoryStorage());
  resetProjectBotsCache();
  resetCrewsCache();
  resetTeamViewCache();
  setFeatureCardBackend(memoryFeatureCardBackend());
  resetWorkBoardFeed();
  installWorkBoardActions({
    openChat: vi.fn(),
    allow: vi.fn(),
    review: vi.fn(),
    ship: vi.fn(),
    watch: vi.fn(),
    compare: vi.fn(),
    preview: vi.fn(),
    openCommit: vi.fn(),
    openUrl: vi.fn(),
    build: vi.fn(() => "built"),
    draft: vi.fn(() => "drafted"),
  });
  actions.tellTeam.mockClear();
  uninstall = installCrewWorkspace({
    openChat: vi.fn(async () => null),
    openCrew: vi.fn(),
    openSettings: vi.fn(),
    stop: vi.fn(async () => undefined),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  uninstall();
  resetWorkBoardFeed();
  setFeatureCardBackend(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function open() {
  publishWorkBoardFeed({ chats: [], statuses: {}, teams: [] });
  await act(async () =>
    root.render(createElement(WorkBoard, { project: PROJECT, visible: true })),
  );
  await act(async () => {
    for (let round = 0; round < 4; round += 1)
      await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

it("opens on meeting Avos: its Bot, who it is and its question, and nothing else", async () => {
  ensureAvos(PROJECT, NOW);
  await open();
  const meet = container.querySelector<HTMLElement>("[data-avos-meet]")!;
  expect(meet).toBeTruthy();
  expect(meet.querySelector(".avos-meet-hello")?.textContent).toBe(
    "Hi, I'm Avos. I'll look after clippedin.",
  );
  expect(meet.querySelector(".avos-meet-ask")?.textContent).toBe(
    "What should I keep an eye on, and what's coming up this week?",
  );
  expect(
    meet.querySelector<HTMLElement>("[data-crew-critter] .agent-mark")?.dataset
      .agent,
  ).toBe("watching");
  // No setup sheet, no three teammates, no panel: the chat alone.
  expect(container.querySelector(".team-panel")).toBeNull();
  const box = container.querySelector<HTMLTextAreaElement>(
    ".team-compose-input",
  )!;
  expect(box.placeholder).toBe(
    "Something to keep an eye on, or what's coming up…",
  );
  expect(document.activeElement).toBe(box);
  // Your answer goes to Avos.
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(box, "Watch the Website Articles page in Notion");
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    container
      .querySelector<HTMLFormElement>("[data-team-compose]")!
      .requestSubmit(),
  );
  expect(actions.tellTeam).toHaveBeenCalledWith(
    PROJECT,
    "Watch the Website Articles page in Notion",
    "lead",
  );
});

it("is an ordinary Avos screen once it has been awake", async () => {
  ensureAvos(PROJECT, NOW);
  updateCrew(PROJECT, (crew) => ({ ...crew, on: true, onAt: NOW - 1 }));
  await open();
  expect(container.querySelector("[data-avos-meet]")).toBeNull();
  expect(container.querySelector(".team-panel")).toBeTruthy();
});

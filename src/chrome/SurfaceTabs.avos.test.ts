// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ensureAvos, resetCrewsCache } from "../lib/crews";
import { memoryStorage } from "../lib/devSmoke";
import { resetProjectBotsCache } from "../lib/projectBots";
import { surfaceTabPresentation } from "./SurfaceTabs";

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  resetProjectBotsCache();
  resetCrewsCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetCrewsCache();
});

const board = {
  id: "b1",
  path: "Board",
  cwd: "/work/clippedin",
  board: { project: "/work/clippedin" },
};

it("names a project's Board Avos once you've met its Avos", () => {
  expect(surfaceTabPresentation(board).label).toBe("Board");
  ensureAvos("/work/clippedin");
  expect(surfaceTabPresentation(board)).toMatchObject({
    name: "Avos",
    label: "Avos",
    tooltip: "Avos · /work/clippedin",
  });
});

// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetCrewsCache, updateCrew } from "./crews";
import { memoryStorage } from "./devSmoke";
import { launchRefusal } from "./harness/sessionPermissions";
import {
  crewChatPermissions,
  installBotPermissions,
  NEVER_READ_PATHS,
} from "./projectBotPermissions";
import { resetProjectBotsCache } from "./projectBots";

const PROJECT = "/Users/me/clippedin";

let stop: () => void;
beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  resetProjectBotsCache();
  resetCrewsCache();
  stop = installBotPermissions();
  // Avos is on in a folder with no copy (a project without Git has none).
  updateCrew(PROJECT, (crew) => ({
    ...crew,
    on: true,
    onAt: 1,
    copy: undefined,
    members: [
      { id: "lead", role: "lead", sessionId: "avos-chat" },
      { id: "builder", role: "builder", sessionId: "builder-chat" },
    ],
  }));
});

afterEach(() => {
  stop();
  vi.unstubAllGlobals();
  resetCrewsCache();
});

it("lets Avos read your folder before there's a copy, and change nothing in it", () => {
  const avos = crewChatPermissions("avos-chat")!;
  expect(avos.refuse).toBeUndefined();
  expect(avos).toMatchObject({
    readOnly: true,
    noMcp: true,
    noEscalation: true,
    userSettingsOnly: true,
    workFolder: PROJECT,
  });
  // Its sandbox writes nothing in the project, reaches no host and reads
  // none of your keys; its rules refuse edits there too.
  expect(avos.sandbox?.enabled).toBe(true);
  expect(avos.sandbox?.filesystem?.denyWrite).toContain(PROJECT);
  expect(avos.sandbox?.network?.allowedDomains).toEqual([]);
  expect(avos.sandbox?.filesystem?.denyRead).toEqual(
    expect.arrayContaining(NEVER_READ_PATHS),
  );
  expect(avos.rules.deny?.some((rule) => rule.startsWith("Edit("))).toBe(true);
  expect(launchRefusal("avos-chat", PROJECT)).toBeNull();
  expect(launchRefusal("avos-chat", "/Users/me")).toMatch(/only in its own/);
});

it("still keeps every other helper out until the copy exists", () => {
  expect(launchRefusal("builder-chat", PROJECT)).toMatch(/copy isn't ready/);
});

it("refuses Avos's chat while Avos is off", () => {
  updateCrew(PROJECT, (crew) => ({ ...crew, on: false }));
  expect(launchRefusal("avos-chat", PROJECT)).toMatch(/Avos is off/);
});

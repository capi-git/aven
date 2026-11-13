// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetCrewsCache, updateCrew } from "./crews";
import { memoryStorage } from "./devSmoke";
import {
  launchRefusal,
  permissionRulesKey,
} from "./harness/sessionPermissions";
import {
  agentBrowserReadOnly,
  agentBrowserRestricted,
  agentBrowserWeb,
  crewChatBrowserOff,
  crewChatPermissions,
  installBotPermissions,
  NEVER_READ_PATHS,
} from "./projectBotPermissions";
import { resetProjectBotsCache } from "./projectBots";

const PROJECT = "/Users/me/clippedin";

let socket: string | undefined;
vi.mock("./agentBrowser", () => ({ agentBrowserSocket: () => socket }));

let stop: () => void;
beforeEach(() => {
  socket = undefined;
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

it("lets a helper Avos started read your folder too, as Avos does", () => {
  updateCrew(PROJECT, (crew) => ({
    ...crew,
    helpers: [
      {
        id: "helper-1",
        role: "helper",
        name: "Audit the Users page",
        helperOf: "lead",
        sessionId: "helper-chat",
      },
    ],
  }));
  const helper = crewChatPermissions("helper-chat")!;
  expect(helper.refuse).toBeUndefined();
  expect(helper).toMatchObject({ readOnly: true, workFolder: PROJECT });
  expect(helper.sandbox?.filesystem?.denyWrite).toContain(PROJECT);
  expect(helper.sandbox?.network?.allowedDomains).toEqual([]);
  expect(launchRefusal("helper-chat", PROJECT)).toBeNull();
});

it("still keeps every teammate that changes files out until the copy exists", () => {
  expect(launchRefusal("builder-chat", PROJECT)).toMatch(/copy isn't ready/);
});

it("refuses Avos's chat while Avos is off", () => {
  updateCrew(PROJECT, (crew) => ({ ...crew, on: false }));
  expect(launchRefusal("avos-chat", PROJECT)).toMatch(/Avos is off/);
});

const SOCKET = "/tmp/aven-browser.sock";
const COPY = "/data/bots/clippedin-crew-1";
const withCopy = () =>
  updateCrew(PROJECT, (crew) => ({
    ...crew,
    copy: { path: COPY, branch: "aven/bot/crew-1", root: PROJECT },
    helpers: [
      {
        id: "helper-1",
        role: "helper" as const,
        name: "Look at Insights",
        helperOf: "lead",
        sessionId: "helper-chat",
      },
      {
        id: "helper-2",
        role: "helper" as const,
        name: "Read the routes",
        helperOf: "builder",
        sessionId: "other-helper-chat",
      },
    ],
  }));

it("gives Avos and a helper it started Aven's browser, and nothing else new", () => {
  socket = SOCKET;
  withCopy();
  for (const chat of ["avos-chat", "helper-chat"]) {
    const found = crewChatPermissions(chat)!;
    expect(crewChatBrowserOff(chat)).toBe(false);
    // The one way out of its sandbox is Aven's own browser socket.
    expect(found.sandbox?.network?.allowUnixSockets).toEqual([SOCKET]);
    expect(found.sandbox?.network?.allowedDomains).toEqual([]);
    // It still changes nothing in the copy, and has no connections.
    expect(found.sandbox?.filesystem?.denyWrite).toContain(COPY);
    expect(found).toMatchObject({ readOnly: true, noMcp: true });
    // Its pages are sandboxed ones, and reach the web as Avos may.
    expect(agentBrowserRestricted(chat)).toBe(true);
    expect(agentBrowserWeb(chat)).toBe(true);
  }
  // Avos keeps its search and fetch tools; a helper gets pages only.
  expect(crewChatPermissions("avos-chat")!.rules.deny).not.toContain(
    "WebFetch",
  );
  expect(crewChatPermissions("helper-chat")!.rules.deny).toEqual(
    expect.arrayContaining(["WebFetch", "WebSearch"]),
  );
});

it("gives no browser to a helper another teammate started", () => {
  socket = SOCKET;
  withCopy();
  const found = crewChatPermissions("other-helper-chat")!;
  expect(crewChatBrowserOff("other-helper-chat")).toBe(true);
  expect(found.sandbox?.network?.allowUnixSockets).toBeUndefined();
  expect(agentBrowserWeb("other-helper-chat")).toBe(false);
  // Still sandboxed, should it ever reach the browser.
  expect(agentBrowserRestricted("other-helper-chat")).toBe(true);
});

it("takes the browser away from Avos and its helpers when you turn the web off", () => {
  socket = SOCKET;
  withCopy();
  updateCrew(PROJECT, (crew) => ({
    ...crew,
    access: { deletes: true, web: "none" as const, others: "refuse" as const },
  }));
  for (const chat of ["avos-chat", "helper-chat"]) {
    expect(crewChatBrowserOff(chat)).toBe(true);
    expect(
      crewChatPermissions(chat)!.sandbox?.network?.allowUnixSockets,
    ).toBeUndefined();
    expect(agentBrowserWeb(chat)).toBe(false);
  }
});

it("keeps Avos's browser sandboxed in your own folder, before there's a copy", () => {
  socket = SOCKET;
  const avos = crewChatPermissions("avos-chat")!;
  expect(avos.workFolder).toBe(PROJECT);
  expect(avos.sandbox?.network?.allowUnixSockets).toEqual([SOCKET]);
  expect(avos.sandbox?.network?.allowedDomains).toEqual([]);
  expect(avos.sandbox?.filesystem?.denyWrite).toContain(PROJECT);
  // Aven's host can't tell from the folder that this chat is sandboxed, so
  // the window says so at every bind.
  expect(agentBrowserRestricted("avos-chat")).toBe(true);
  // A chat of your own is never restricted by this.
  expect(agentBrowserRestricted("my-chat")).toBe(false);
});

it("starts Avos's agent again with the new sandbox when Use the web changes", () => {
  socket = SOCKET;
  withCopy();
  const key = () => permissionRulesKey(crewChatPermissions("avos-chat"));
  const on = key();
  // The same Access, the same launch: the agent keeps running.
  expect(key()).toBe(on);
  updateCrew(PROJECT, (crew) => ({
    ...crew,
    access: { deletes: true, web: "none" as const, others: "refuse" as const },
  }));
  // A changed key starts the agent again at its next message (see
  // `settingsKeyFor`), so a chat under way loses the browser at once, and
  // gets it back the same way, without Aven starting again.
  const off = key();
  expect(off).not.toBe(on);
  updateCrew(PROJECT, (crew) => ({
    ...crew,
    access: {
      deletes: true,
      web: "builders" as const,
      others: "refuse" as const,
    },
  }));
  expect(key()).toBe(on);
});

it("has Aven save no page for a teammate that only reads", () => {
  withCopy();
  // Avos, a helper: they change nothing, and neither does Aven for them.
  expect(agentBrowserReadOnly("avos-chat")).toBe(true);
  expect(agentBrowserReadOnly("helper-chat")).toBe(true);
  expect(crewChatPermissions("avos-chat")).toMatchObject({ readOnly: true });
  // A Builder writes in its copy; a chat of your own is as it was.
  expect(agentBrowserReadOnly("builder-chat")).toBe(false);
  expect(agentBrowserReadOnly("my-chat")).toBe(false);
});

// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
const key = "monocode.projectlessWorkspaces.v1";
const base =
  "/Users/test/Library/Application Support/com.capi.monocode.personal/projectless-workspaces";
let api: typeof import("./projectlessWorkspace");
let values: Map<string, string>;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => values.set(name, value),
  });
  api = await import("./projectlessWorkspace");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("projectless session folders", () => {
  it("recognizes restored exact paths synchronously without creating folders", () => {
    values.set(key, JSON.stringify({ work: `${base}/work` }));
    expect(api.projectlessProfileForCwd(`${base}/work/`)).toBe("work");
    expect(api.projectlessCwdForProfile("work")).toBe(`${base}/work`);
    expect(api.isProjectlessCwd(`${base}/work/other`)).toBe(false);
    expect(api.isProjectlessCwd("/Users/test")).toBe(false);
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it("reuses the parsed mapping and rebuilds it when another window changes storage", () => {
    const raw = JSON.stringify({ personal: `${base}/personal` });
    values.set(key, raw);
    const parse = vi.spyOn(JSON, "parse");
    for (let i = 0; i < 20; i += 1) {
      expect(api.isProjectlessCwd(`${base}/personal`)).toBe(true);
      expect(api.projectlessCwdForProfile("personal")).toBe(`${base}/personal`);
    }
    expect(parse.mock.calls.filter(([value]) => value === raw)).toHaveLength(1);
    values.set(key, JSON.stringify({ work: `${base}/work` }));
    expect(api.isProjectlessCwd(`${base}/personal`)).toBe(false);
    expect(api.projectlessProfileForCwd(`${base}/work`)).toBe("work");
  });

  it("deduplicates pending creation and persists only the path native code returns", async () => {
    let resolve!: (cwd: string) => void;
    native.invoke.mockReturnValueOnce(
      new Promise<string>((done) => {
        resolve = done;
      }),
    );
    const first = api.ensureProjectlessWorkspace("personal");
    expect(api.ensureProjectlessWorkspace("personal")).toBe(first);
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith("projectless_cwd", {
      profileId: "personal",
    });
    resolve(`${base}/personal`);
    await expect(first).resolves.toEqual({
      profileId: "personal",
      cwd: `${base}/personal`,
    });
    expect(JSON.parse(values.get(key)!)).toEqual({
      personal: `${base}/personal`,
    });
    expect(api.isProjectlessCwd(`${base}/personal`)).toBe(true);
    expect(values.has("monocode.recentProjects")).toBe(false);
  });

  it("keeps simultaneous Personal and Work actions attributed after their replies arrive out of order", async () => {
    const replies = new Map<string, (cwd: string) => void>();
    native.invoke.mockImplementation(
      (_command: string, args: { profileId: string }) =>
        new Promise<string>((resolve) => replies.set(args.profileId, resolve)),
    );
    const personal = api.ensureProjectlessWorkspace("personal");
    const work = api.ensureProjectlessWorkspace("work");
    replies.get("work")!(`${base}/work`);
    await expect(work).resolves.toMatchObject({ profileId: "work" });
    replies.get("personal")!(`${base}/personal`);
    await expect(personal).resolves.toMatchObject({ profileId: "personal" });
    expect(JSON.parse(values.get(key)!)).toEqual({
      work: `${base}/work`,
      personal: `${base}/personal`,
    });
  });

  it("validates the native folder on every new action and permits retry after failure", async () => {
    values.set(key, JSON.stringify({ work: `${base}/work` }));
    native.invoke.mockRejectedValueOnce(new Error("Folder unavailable"));
    await expect(api.ensureProjectlessWorkspace("work")).rejects.toThrow(
      "Folder unavailable",
    );
    native.invoke.mockResolvedValueOnce(`${base}/work`);
    await api.ensureProjectlessWorkspace("work");
    expect(native.invoke).toHaveBeenCalledTimes(2);
  });

  it("rejects traversal and unrelated native responses without remembering them", async () => {
    for (const id of [
      "",
      "../work",
      "work/personal",
      "~",
      "__proto__",
      "a".repeat(97),
    ]) {
      await expect(api.ensureProjectlessWorkspace(id)).rejects.toThrow(
        "workspace identity",
      );
    }
    expect(native.invoke).not.toHaveBeenCalled();
    for (const cwd of [
      "~",
      "/Users/test",
      `${base}/personal`,
      `/tmp/../projectless-workspaces/work`,
    ]) {
      native.invoke.mockResolvedValueOnce(cwd);
      await expect(api.ensureProjectlessWorkspace("work")).rejects.toThrow(
        "invalid session folder",
      );
    }
    expect(values.has(key)).toBe(false);
  });

  it("ignores malformed persisted mappings and retains the current window when storage is unavailable", async () => {
    for (const raw of [
      "not json",
      "[]",
      '{"work":"~"}',
      '{"work":"relative/projectless-workspaces/work"}',
    ]) {
      values.set(key, raw);
      expect(api.projectlessCwdForProfile("work")).toBeUndefined();
    }
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("Blocked");
      },
      setItem: () => {
        throw new Error("Blocked");
      },
    });
    native.invoke.mockResolvedValueOnce(`${base}/work`);
    await api.ensureProjectlessWorkspace("work");
    expect(api.projectlessProfileForCwd(`${base}/work`)).toBe("work");
  });
});

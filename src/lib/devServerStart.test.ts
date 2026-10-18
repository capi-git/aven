import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const files = vi.hoisted(() => ({
  text: new Map<string, string>(),
  present: new Set<string>(),
}));
vi.mock("./fs", () => ({
  readTextFile: vi.fn(async (path: string) => {
    const text = files.text.get(path);
    if (text === undefined) throw new Error("No such file");
    return text;
  }),
  inspectPaths: vi.fn(async (paths: string[]) =>
    paths
      .filter((path) => files.present.has(path))
      .map((path) => ({
        path,
        name: path.split("/").pop()!,
        size: 1,
        isDir: false,
      })),
  ),
}));

import { reportDevServer, resetDevPreviews } from "./devPreviews";
import {
  canStartDevServers,
  devScriptFrom,
  devServerStartFor,
  devServerStartsSnapshot,
  finishDevServerStart,
  installDevServerStarter,
  isLocalDevAddress,
  loadDevScript,
  resetDevServerStarts,
  startDevServer,
} from "./devServerStart";
import { localDevAddress } from "./devServerUrls";

const PROJECT = "/Users/me/site";

beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
  files.text.clear();
  files.present.clear();
  resetDevPreviews();
  resetDevServerStarts();
});

afterEach(() => {
  resetDevServerStarts();
  resetDevPreviews();
  vi.unstubAllGlobals();
});

describe("the project's dev script", () => {
  it("prefers dev, then start, then serve, run with npm by default", () => {
    expect(
      devScriptFrom(
        JSON.stringify({ scripts: { dev: "python3 -m http.server 5180" } }),
      ),
    ).toEqual({
      name: "dev",
      script: "python3 -m http.server 5180",
      run: "npm run dev",
    });
    expect(
      devScriptFrom(
        JSON.stringify({ scripts: { start: "react-scripts start", dev: " " } }),
      )?.run,
    ).toBe("npm run start");
    expect(
      devScriptFrom(JSON.stringify({ scripts: { serve: "vue-cli-service" } }))
        ?.run,
    ).toBe("npm run serve");
  });

  it("runs it with the package manager the lockfiles name", () => {
    const pkg = JSON.stringify({ scripts: { dev: "vite" } });
    expect(devScriptFrom(pkg, ["pnpm-lock.yaml"])?.run).toBe("pnpm dev");
    expect(devScriptFrom(pkg, ["yarn.lock"])?.run).toBe("yarn dev");
    expect(devScriptFrom(pkg, ["bun.lockb"])?.run).toBe("bun run dev");
  });

  it("finds none without a script, or in a package.json it cannot read", () => {
    expect(devScriptFrom(JSON.stringify({ scripts: { test: "vitest" } }))).toBe(
      null,
    );
    expect(devScriptFrom(JSON.stringify({ name: "site" }))).toBe(null);
    expect(devScriptFrom("{ not json")).toBe(null);
  });

  it("reads package.json and the lockfiles beside it", async () => {
    files.text.set(
      `${PROJECT}/package.json`,
      JSON.stringify({ scripts: { dev: "vite" } }),
    );
    files.present.add(`${PROJECT}/yarn.lock`);
    expect(await loadDevScript(PROJECT)).toMatchObject({ run: "yarn dev" });
    expect(await loadDevScript("/Users/me/empty")).toBe(null);
  });

  it("knows a local development address", () => {
    expect(isLocalDevAddress("http://localhost:5180/test.html")).toBe(true);
    expect(isLocalDevAddress("http://127.0.0.1:3000/")).toBe(true);
    expect(isLocalDevAddress("https://example.com/")).toBe(false);
    expect(isLocalDevAddress("")).toBe(false);
  });
});

describe("starting it from a preview tab", () => {
  const url = "http://localhost:5180/test.html";

  it("runs the script in the project's terminal and says when the server answers", () => {
    const run = vi.fn(() => true);
    expect(canStartDevServers()).toBe(false);
    const uninstall = installDevServerStarter(run);
    expect(canStartDevServers()).toBe(true);
    expect(startDevServer(PROJECT, { run: "npm run dev" }, url, 1_000)).toBe(
      true,
    );
    expect(run).toHaveBeenCalledWith(PROJECT, "npm run dev");
    // Another loopback name for the same server finds the same start.
    expect(
      devServerStartFor(devServerStartsSnapshot(), "http://127.0.0.1:5180/"),
    ).toMatchObject({ project: PROJECT, since: 1_000, ready: false });
    expect(
      devServerStartFor(devServerStartsSnapshot(), "http://localhost:3000/"),
    ).toBeUndefined();

    // The terminal announces the server: the start has answered.
    reportDevServer({
      project: PROJECT,
      cwd: PROJECT,
      address: localDevAddress("http://0.0.0.0:5180/", "strong")!,
      source: "terminal",
      sourceId: "terminal:t1",
      placement: "terminal",
    });
    const start = devServerStartFor(devServerStartsSnapshot(), url)!;
    expect(start.ready).toBe(true);
    finishDevServerStart(start.key);
    expect(devServerStartsSnapshot()).toEqual([]);
    uninstall();
    expect(canStartDevServers()).toBe(false);
  });

  it("starts nothing where the window cannot run it", () => {
    expect(startDevServer(PROJECT, { run: "npm run dev" }, url)).toBe(false);
    installDevServerStarter(() => false);
    expect(startDevServer(PROJECT, { run: "npm run dev" }, url)).toBe(false);
    expect(devServerStartsSnapshot()).toEqual([]);
  });
});

// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const files = vi.hoisted(() => ({ text: new Map<string, string>() }));
vi.mock("../lib/fs", () => ({
  readTextFile: vi.fn(async (path: string) => {
    const text = files.text.get(path);
    if (text === undefined) throw new Error("No such file");
    return text;
  }),
  inspectPaths: vi.fn(async () => []),
}));

import { reportDevServer, resetDevPreviews } from "../lib/devPreviews";
import {
  devServerStartsSnapshot,
  installDevServerStarter,
  resetDevServerStarts,
} from "../lib/devServerStart";
import { localDevAddress } from "../lib/devServerUrls";
import { useDevServerStart, type DevServerOffer } from "./useDevServerStart";

const PROJECT = "/Users/me/site";
const URL = "http://localhost:5180/test.html";

let root: Root;
let container: HTMLDivElement;
let offer: DevServerOffer;
const reload = vi.fn();

function Tab({
  error,
  loading = false,
}: {
  error: string | null;
  loading?: boolean;
}) {
  offer = useDevServerStart({
    project: PROJECT,
    url: URL,
    error,
    loading,
    reload,
  });
  return null;
}

async function show(error: string | null, loading = false) {
  await act(async () => root.render(createElement(Tab, { error, loading })));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
  files.text.clear();
  reload.mockReset();
  resetDevPreviews();
  resetDevServerStarts();
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  resetDevServerStarts();
  resetDevPreviews();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a preview tab whose local server is not running", () => {
  it("offers to start the dev script and reloads once the server answers", async () => {
    files.text.set(
      `${PROJECT}/package.json`,
      JSON.stringify({ scripts: { dev: "python3 -m http.server 5180" } }),
    );
    const run = vi.fn(() => true);
    installDevServerStarter(run);
    await show("Could not connect to this server.");
    expect(offer.canStart).toBe(true);
    expect(offer.hint).toBeUndefined();

    await act(async () => offer.start());
    expect(run).toHaveBeenCalledWith(PROJECT, "npm run dev");
    expect(offer.starting?.run).toBe("npm run dev");
    expect(offer.canStart).toBe(false);
    expect(reload).not.toHaveBeenCalled();

    await act(
      async () =>
        void reportDevServer({
          project: PROJECT,
          cwd: PROJECT,
          address: localDevAddress("http://0.0.0.0:5180/", "strong")!,
          source: "terminal",
          sourceId: "terminal:t1",
          placement: "terminal",
        }),
    );
    expect(reload).toHaveBeenCalledTimes(1);
    expect(devServerStartsSnapshot()).toEqual([]);
  });

  it("tries again a few times when the server never announces itself", async () => {
    vi.useFakeTimers();
    files.text.set(
      `${PROJECT}/package.json`,
      JSON.stringify({ scripts: { dev: "my-server" } }),
    );
    installDevServerStarter(() => true);
    await show("Could not connect to this server.");
    await act(async () => offer.start());
    await act(async () => void vi.advanceTimersByTime(7_000));
    expect(reload).not.toHaveBeenCalled();
    await act(async () => void vi.advanceTimersByTime(2_000));
    expect(reload).toHaveBeenCalledTimes(1);
    // That try loaded the page: nothing is waited for any more.
    await show(null, false);
    expect(devServerStartsSnapshot()).toEqual([]);
    await act(async () => void vi.advanceTimersByTime(60_000));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("says what to do instead where it cannot start it", async () => {
    files.text.set(
      `${PROJECT}/package.json`,
      JSON.stringify({ scripts: { dev: "vite" } }),
    );
    await show("Could not connect to this server.");
    expect(offer.canStart).toBe(false);
    expect(offer.hint).toBe(
      "Run “npm run dev” in the project's terminal, then press Retry.",
    );
  });

  it("keeps the message, with a plain hint, without a dev script", async () => {
    installDevServerStarter(() => true);
    await show("Could not connect to this server.");
    expect(offer.canStart).toBe(false);
    expect(offer.hint).toBe(
      "Start the project's development server in a terminal, then press Retry.",
    );
  });
});

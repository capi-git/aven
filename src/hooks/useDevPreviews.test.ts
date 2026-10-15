// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  installDevPreviewOpener,
  reportDevServer,
  resetDevPreviews,
  stopDevServers,
  type DevPreviewOpener,
} from "../lib/devPreviews";
import { localDevAddress } from "../lib/devServerUrls";
import { useDevPreviewAutoOpen } from "./useDevPreviews";

const SITE = "/Users/me/site";
const API = "/Users/me/api";
let values: Map<string, string>;
let root: Root;
let open: ReturnType<typeof vi.fn<DevPreviewOpener>>;

beforeEach(() => {
  values = new Map([["aven.devPreviewAutoOpen", "1"]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetDevPreviews();
  open = vi.fn<DevPreviewOpener>(() => true);
  installDevPreviewOpener(open);
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => root.unmount());
  resetDevPreviews();
  vi.unstubAllGlobals();
});

function Probe({ project }: { project: string }) {
  useDevPreviewAutoOpen(project);
  return null;
}

async function show(project: string) {
  await act(async () => root.render(createElement(Probe, { project })));
}

async function announce(
  project: string,
  url: string,
  strength: "strong" | "weak" = "strong",
) {
  await act(async () => {
    reportDevServer({
      project,
      cwd: project,
      address: localDevAddress(url, strength)!,
      source: "terminal",
      sourceId: `terminal:${project}`,
      placement: "chat",
    });
  });
}

it("opens each server start of the project on screen once", async () => {
  await show(SITE);
  await announce(SITE, "http://localhost:5173/");
  expect(open).toHaveBeenCalledTimes(1);
  await announce(SITE, "http://localhost:5173/");
  expect(open).toHaveBeenCalledTimes(1);
  await act(async () => stopDevServers(`terminal:${SITE}`));
  await announce(SITE, "http://localhost:5173/");
  expect(open).toHaveBeenCalledTimes(2);
});

it("waits until a background project is on screen", async () => {
  await show(SITE);
  await announce(API, "http://localhost:4321/");
  expect(open).not.toHaveBeenCalled();
  await show(API);
  expect(open).toHaveBeenCalledWith(
    expect.objectContaining({ project: API, port: 4321 }),
    undefined,
  );
});

it("leaves port-only servers and the setting's off state to the chip", async () => {
  await show(SITE);
  await announce(SITE, "http://localhost:3000/", "weak");
  values.set("aven.devPreviewAutoOpen", "0");
  await announce(SITE, "http://localhost:5173/");
  expect(open).not.toHaveBeenCalled();
});

it("retries when the workspace could not open it yet", async () => {
  open.mockReturnValueOnce(false);
  await show(SITE);
  await announce(SITE, "http://localhost:5173/");
  expect(open).toHaveBeenCalledTimes(1);
  await announce(SITE, "http://localhost:8080/", "weak");
  expect(open).toHaveBeenCalledTimes(2);
  expect(open).toHaveBeenLastCalledWith(
    expect.objectContaining({ port: 5173 }),
    undefined,
  );
});

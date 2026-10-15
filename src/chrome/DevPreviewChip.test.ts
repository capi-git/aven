// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  installDevPreviewOpener,
  reportDevServer,
  resetDevPreviews,
  stopDevServers,
} from "../lib/devPreviews";
import { localDevAddress } from "../lib/devServerUrls";
import { DevPreviewChip } from "./DevPreviewChip";

const PROJECT = "/Users/me/site";
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetDevPreviews();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  resetDevPreviews();
  vi.unstubAllGlobals();
});

function announce(
  url: string,
  placement: "chat" | "terminal" = "chat",
  sourceId = "terminal:t1",
) {
  return reportDevServer({
    project: PROJECT,
    cwd: PROJECT,
    address: localDevAddress(url)!,
    source: "terminal",
    sourceId,
    placement,
  });
}

async function render(
  placement: "chat" | "terminal" = "chat",
  requesterSessionId?: string,
) {
  await act(async () =>
    root.render(
      createElement(DevPreviewChip, {
        project: PROJECT,
        placement,
        requesterSessionId,
      }),
    ),
  );
}

function chip() {
  return host.querySelector<HTMLElement>(".dev-preview-chip");
}

it("renders nothing until the project's dev server starts", async () => {
  await render();
  expect(chip()).toBeNull();
  await act(async () => {
    announce("http://localhost:5173/");
  });
  expect(chip()?.textContent).toBe(
    "Preview ready·localhost:5173Open beside chat",
  );
  expect(chip()?.dataset.state).toBe("live");
});

it("opens beside the requesting chat and then steps aside", async () => {
  const open = vi.fn(() => true);
  installDevPreviewOpener(open);
  announce("http://localhost:5173/");
  await render("chat", "session-1");
  const button = host.querySelector<HTMLButtonElement>(".dev-preview-open")!;
  await act(async () => button.click());
  expect(open).toHaveBeenCalledWith(
    expect.objectContaining({ url: "http://localhost:5173/" }),
    { requesterSessionId: "session-1" },
  );
  expect(chip()).toBeNull();
});

it("stays when the workspace could not open it", async () => {
  installDevPreviewOpener(() => false);
  announce("http://localhost:5173/");
  await render();
  await act(async () =>
    host.querySelector<HTMLButtonElement>(".dev-preview-open")!.click(),
  );
  expect(chip()).not.toBeNull();
});

it("can be dismissed, and returns for the next server start", async () => {
  announce("http://localhost:5173/");
  await render();
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>(
        '[aria-label="Dismiss preview for localhost:5173"]',
      )!
      .click(),
  );
  expect(chip()).toBeNull();
  await act(async () => {
    stopDevServers("terminal:t1");
    announce("http://localhost:5173/");
  });
  expect(chip()?.dataset.state).toBe("live");
});

it("quietly shows a stopped server without an open button", async () => {
  announce("http://localhost:5173/");
  await render();
  await act(async () => stopDevServers("terminal:t1"));
  expect(chip()?.dataset.state).toBe("stale");
  expect(chip()?.textContent).toContain("Preview stopped");
  expect(host.querySelector(".dev-preview-open")).toBeNull();
});

it("shows terminal servers only in the terminal panel", async () => {
  announce("http://localhost:8000/", "terminal");
  await render("chat");
  expect(chip()).toBeNull();
  await render("terminal");
  expect(chip()?.dataset.placement).toBe("terminal");
  expect(chip()?.textContent).toContain("localhost:8000");
});

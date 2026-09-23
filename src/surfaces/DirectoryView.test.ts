// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listDir, type FsEntry } from "../lib/fs";
import { DirectoryView } from "./DirectoryView";

vi.mock("../lib/fs", async (original) => ({
  ...(await original<typeof import("../lib/fs")>()),
  listDir: vi.fn(),
}));

let root: Root;
let host: HTMLDivElement;
const onOpenFile = vi.fn();
const entry = (path: string, isDir = false): FsEntry => ({
  path,
  name: path.slice(path.lastIndexOf("/") + 1),
  isDir,
  ignored: false,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(listDir).mockReset().mockResolvedValue([]);
  onOpenFile.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
function render(path = "/home/.agents/skills") {
  return act(async () =>
    root.render(createElement(DirectoryView, { path, onOpenFile })),
  );
}
function button(label: string) {
  const found = host.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  expect(found, label).not.toBeNull();
  return found!;
}

describe("linked directory browsing", () => {
  it("opens folders in place and files through the existing editor callback", async () => {
    vi.mocked(listDir).mockImplementation(async (path) =>
      path.endsWith("/design")
        ? [entry(`${path}/SKILL.md`)]
        : [entry(`${path}/README.md`), entry(`${path}/design`, true)],
    );
    await render();
    expect(button("Go up one folder").disabled).toBe(true);
    expect(host.querySelector(".directory-view-entry")?.textContent).toContain(
      "design",
    );
    await act(async () => button("Open folder design").click());
    expect(host.querySelector("h2")?.textContent).toBe("design");
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button("Open file SKILL.md"));
    await act(async () => button("Open file SKILL.md").click());
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith(
      "/home/.agents/skills/design/SKILL.md",
    );
    await act(async () => button("Go up one folder").click());
    expect(host.querySelector("h2")?.textContent).toBe("skills");
    expect(button("Go up one folder").disabled).toBe(true);
    expect(listDir).not.toHaveBeenCalledWith("/home/.agents");
  });

  it("supports breadcrumb navigation and keyboard focus within entries", async () => {
    vi.mocked(listDir).mockResolvedValue([
      entry("/root/first", true),
      entry("/root/file.md"),
      entry("/root/z.txt"),
    ]);
    await render("/root");
    const first = button("Open folder first");
    first.focus();
    first.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(document.activeElement).toBe(button("Open file file.md"));
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "End", bubbles: true }),
    );
    expect(document.activeElement).toBe(button("Open file z.txt"));
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
    );
    expect(document.activeElement).toBe(first);
    vi.mocked(listDir).mockResolvedValue([]);
    await act(async () => first.click());
    expect(document.activeElement).toBe(host.querySelector("h2"));
    const breadcrumb = host.querySelector<HTMLButtonElement>(
      'nav button[title="/root"]',
    )!;
    await act(async () => breadcrumb.click());
    expect(host.querySelector("h2")?.textContent).toBe("root");
    expect(button("Go up one folder").disabled).toBe(true);
  });

  it("shows loading, errors and empty results, with retry and refresh", async () => {
    const waiting = deferred<FsEntry[]>();
    vi.mocked(listDir).mockReturnValueOnce(waiting.promise);
    await render();
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "Loading folder…",
    );
    await act(async () => waiting.resolve([]));
    expect(host.textContent).toContain("This folder is empty.");
    vi.mocked(listDir).mockRejectedValueOnce(new Error("Permission denied"));
    await act(async () => button("Refresh folder").click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Permission denied",
    );
    vi.mocked(listDir).mockResolvedValueOnce([
      entry("/home/.agents/skills/README.md"),
    ]);
    const retry = [...host.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Try again",
    )!;
    await act(async () => retry.click());
    expect(button("Open file README.md")).toBeTruthy();
    expect(host.querySelector("footer")?.textContent).toBe("1 item");
  });

  it("ignores stale folder results after the root changes", async () => {
    const old = deferred<FsEntry[]>();
    vi.mocked(listDir).mockImplementation((path) =>
      path === "/old"
        ? old.promise
        : Promise.resolve([entry("/new/current.md")]),
    );
    await render("/old");
    await render("/new");
    expect(button("Open file current.md")).toBeTruthy();
    await act(async () => old.resolve([entry("/old/stale.md")]));
    expect(host.textContent).not.toContain("stale.md");
    expect(host.querySelector("h2")?.textContent).toBe("new");
    expect(button("Go up one folder").disabled).toBe(true);
  });
});

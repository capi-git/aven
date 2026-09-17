// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceActionDialog } from "./WorkspaceActionDialog";
const native = vi.hoisted(() => ({
  clone: vi.fn(),
  create: vi.fn(),
  pick: vi.fn(),
  read: vi.fn(),
  invoke: vi.fn(),
  open: vi.fn(),
}));
vi.mock("../lib/fs", () => ({
  cloneRepo: native.clone,
  createPath: native.create,
  pickFolder: native.pick,
  readTextFile: native.read,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("../lib/inAppLinks", () => ({ openInAppUrl: native.open }));
let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof WorkspaceActionDialog>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  native.read.mockRejectedValue(new Error("No package"));
  native.pick.mockResolvedValue("/parent");
  native.clone.mockResolvedValue("/parent/repo");
  native.create.mockResolvedValue("/parent/new");
  native.open.mockResolvedValue(undefined);
  native.invoke.mockResolvedValue({
    root: "/one",
    branch: "feature/a",
    remoteUrl: "git@github-personal:owner/repo.git",
    defaultBranch: "main",
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  props = {
    kind: "run",
    cwd: "/one",
    profileId: "personal",
    profileName: "Personal",
    scripts: [],
    onScriptsChange: vi.fn(),
    onCreated: vi.fn(),
    onClose: vi.fn(),
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(patch: Partial<typeof props> = {}) {
  props = { ...props, ...patch };
  await act(async () =>
    root.render(createElement(WorkspaceActionDialog, props)),
  );
}
function button(text: string) {
  const node = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (el) => el.textContent === text || el.getAttribute("aria-label") === text,
  );
  if (!node) throw new Error(`Missing button: ${text}`);
  return node;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
async function field(label: string, value: string) {
  const wrapper = [...document.querySelectorAll("label")].find((node) =>
    node.textContent?.startsWith(label),
  );
  const input = wrapper?.querySelector<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >("input,textarea,select");
  if (!input) throw new Error(`Missing input: ${label}`);
  const prototype =
    input instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(
      new Event(input instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      }),
    );
  });
}
async function submit() {
  await act(async () =>
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("workspace action dialogs", () => {
  it("saves a manually entered command without invoking native execution", async () => {
    await render();
    await field("Name", "Development");
    await field("Command", "npm run dev");
    await submit();
    expect(props.onScriptsChange).toHaveBeenCalledExactlyOnceWith([
      { id: expect.any(String), name: "Development", command: "npm run dev" },
    ]);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(native.invoke).not.toHaveBeenCalled();
    expect(native.open).not.toHaveBeenCalled();
    expect(native.clone).not.toHaveBeenCalled();
  });

  it("filters malformed package suggestions and still requires an explicit save", async () => {
    native.read.mockResolvedValue(
      JSON.stringify({
        scripts: {
          dev: "vite",
          "test:unit": "vitest",
          "--if-present": "danger",
          "bad name": "x",
          invalid: 123,
        },
      }),
    );
    await render();
    expect(
      [
        ...document.querySelectorAll(".workspace-script-suggestions button"),
      ].map((node) => node.textContent),
    ).toEqual(["dev", "test:unit"]);
    await click("test:unit");
    expect(props.onScriptsChange).not.toHaveBeenCalled();
    expect(native.invoke).not.toHaveBeenCalled();
    await submit();
    expect(props.onScriptsChange).toHaveBeenCalledWith([
      expect.objectContaining({
        name: "test:unit",
        command: "npm run test:unit",
      }),
    ]);
  });

  it("preserves the supplied clone URL and blocks duplicate submissions", async () => {
    const pending = deferred<string>();
    native.clone.mockReturnValue(pending.promise);
    await render({ kind: "clone", profileId: "work", profileName: "Work" });
    await field("Repository URL", "https://github.com/owner/repo");
    await click("Choose a folder…");
    await submit();
    await submit();
    expect(native.clone).toHaveBeenCalledExactlyOnceWith(
      "https://github.com/owner/repo",
      "/parent",
    );
    expect(button("Close dialog").disabled).toBe(true);
    await act(async () => pending.resolve("/parent/repo"));
    expect(props.onCreated).toHaveBeenCalledExactlyOnceWith(
      "/parent/repo",
      "work",
    );
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("retains the originating profile when a clone finishes after its dialog unmounts", async () => {
    const pending = deferred<string>();
    native.clone.mockReturnValue(pending.promise);
    await render({ kind: "clone", profileId: "work", profileName: "Work" });
    await field("Repository URL", "git@github.com:owner/repo");
    await click("Choose a folder…");
    await submit();
    await act(async () => root.render(null));
    await act(async () => pending.resolve("/parent/repo"));
    expect(props.onCreated).toHaveBeenCalledExactlyOnceWith(
      "/parent/repo",
      "work",
    );
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("rejects invalid folder names without a native create or close", async () => {
    await render({ kind: "create" });
    await click("Choose a folder…");
    await field("Project name", "../outside");
    await submit();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "single folder name",
    );
    expect(native.create).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("opens a comparison draft inside the app only after the user continues", async () => {
    await render({ kind: "pr" });
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith(
      "personal_project_info",
      { cwd: "/one" },
    );
    expect(native.open).not.toHaveBeenCalled();
    await field("Title", "Fix & review");
    await submit();
    expect(native.open).toHaveBeenCalledExactlyOnceWith(
      "https://github.com/owner/repo/compare/main...feature%2Fa?expand=1&title=Fix+%26+review",
    );
  });

  it("ignores an old project's delayed metadata after the project changes", async () => {
    const old = deferred<unknown>();
    native.invoke
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({
        root: "/two",
        branch: "new-branch",
        remoteUrl: "https://github.com/new/repo",
        defaultBranch: "develop",
      });
    await render({ kind: "pr" });
    await render({ cwd: "/two" });
    await act(async () =>
      old.resolve({
        root: "/one",
        branch: "old",
        remoteUrl: "https://github.com/old/repo",
        defaultBranch: "main",
      }),
    );
    expect(
      document.querySelector(".workspace-pr-context")?.textContent,
    ).toContain("new/repo");
    expect(
      document.querySelector(".workspace-pr-context")?.textContent,
    ).not.toContain("old");
    await submit();
    expect(native.open).toHaveBeenCalledExactlyOnceWith(
      "https://github.com/new/repo/compare/develop...new-branch?expand=1",
    );
  });
});

// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PathInfo } from "../lib/fs";
import type { Block } from "../lib/session";

const native = vi.hoisted(() => ({ tauri: false }));
const fs = vi.hoisted(() => ({
  inspectPaths: vi.fn(),
  listProjectFiles: vi.fn(),
  revealPath: vi.fn(),
}));
const dialog = vi.hoisted(() => ({ message: vi.fn() }));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => native.tauri,
}));
vi.mock("@tauri-apps/plugin-dialog", async (original) => ({
  ...(await original<typeof import("@tauri-apps/plugin-dialog")>()),
  message: dialog.message,
}));
vi.mock("../lib/fs", async (original) => ({
  ...(await original<typeof import("../lib/fs")>()),
  inspectPaths: fs.inspectPaths,
  listProjectFiles: fs.listProjectFiles,
  revealPath: fs.revealPath,
}));

const { AgentMarkdown } = await import("./AgentMarkdown");
const { ChatFileReferencesContext } =
  await import("../hooks/useFileReferences");
const { chatFileReferences, touchedFilePaths } =
  await import("../lib/fileReferences");
const { fileLinkHref } = await import("../lib/inAppLinks");
const { invalidateProjectFiles } = await import("../lib/fileIndex");
const { REVEAL_LABEL } = await import("../lib/platform");

const CWD = "/Users/me/Developer/ClippedIn Website";
const LLMS = `${CWD}/ClippedIn Website/design-review/ai-discoverability/llms.txt`;
const WROTE_LLMS: Block = {
  id: "write",
  role: "tool",
  text: "Write",
  tool: {
    kind: "edit",
    status: "completed",
    preview: { kind: "write", path: LLMS },
  },
};

let root: Root;
let host: HTMLDivElement;
let disk: Set<string>;
const onOpenFile = vi.fn();

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  native.tauri = false;
  disk = new Set();
  fs.inspectPaths.mockReset().mockImplementation(async (paths: string[]) =>
    paths
      .filter((path) => disk.has(path))
      .map((path): PathInfo => ({
        path,
        name: "llms.txt",
        size: 1,
        isDir: false,
      })),
  );
  fs.listProjectFiles.mockReset().mockResolvedValue([]);
  fs.revealPath.mockReset().mockResolvedValue(undefined);
  dialog.message.mockReset().mockResolvedValue(undefined);
  onOpenFile.mockReset();
  invalidateProjectFiles();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

/** A reply rendered in the chat whose agent wrote `llms.txt`, or outside any chat. */
const render = (text: string, inChat = true) => {
  const markdown = createElement(AgentMarkdown, { text, cwd: CWD, onOpenFile });
  return act(async () =>
    root.render(
      inChat
        ? createElement(
            ChatFileReferencesContext.Provider,
            {
              value: chatFileReferences(CWD, [
                touchedFilePaths([WROTE_LLMS], CWD),
              ]).forTurn(0),
            },
            markdown,
          )
        : markdown,
    ),
  );
};

describe("file names in a chat reply", () => {
  it("open the file the chat's agent wrote, from an inline name, a link or a code label", async () => {
    await render(
      "Wrote `llms.txt`, see [the file](llms.txt).\n\n```1:2:llms.txt\n# ClippedIn\n```",
    );

    await act(async () =>
      host.querySelector<HTMLElement>('code[role="link"]')!.click(),
    );
    expect(onOpenFile).toHaveBeenLastCalledWith(LLMS, undefined);

    const link = host.querySelector("a")!;
    expect(link.getAttribute("href")).toBe(fileLinkHref(LLMS));
    await act(async () => link.click());
    expect(onOpenFile).toHaveBeenLastCalledWith(LLMS, undefined);

    const label = host.querySelector<HTMLButtonElement>(
      "button.markdown-code-path",
    )!;
    expect(label.title).toBe(LLMS);
    await act(async () => label.click());
    expect(onOpenFile).toHaveBeenLastCalledWith(LLMS, undefined);
    expect(onOpenFile).toHaveBeenCalledTimes(3);
  });

  it("reveal the file the chat's agent wrote", async () => {
    native.tauri = true;
    disk.add(LLMS);
    await render("Wrote `llms.txt`.");
    await act(async () =>
      host.querySelector("code")!.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 10,
        }),
      ),
    );
    const reveal = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ].find((item) => item.textContent === REVEAL_LABEL)!;
    await act(async () => reveal.click());
    await vi.waitFor(() =>
      expect(fs.revealPath).toHaveBeenCalledExactlyOnceWith(LLMS),
    );
  });

  it("say so instead of opening a tab when the file is nowhere", async () => {
    native.tauri = true;
    await render("Wrote `llms.txt`.", false);
    await act(async () =>
      host.querySelector<HTMLElement>('code[role="link"]')!.click(),
    );
    await vi.waitFor(() =>
      expect(dialog.message).toHaveBeenCalledExactlyOnceWith(
        "Couldn't find llms.txt in this project.",
        expect.objectContaining({ kind: "info" }),
      ),
    );
    expect(onOpenFile).not.toHaveBeenCalled();
  });
});

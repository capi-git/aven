// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fs = vi.hoisted(() => ({ revealPath: vi.fn() }));
const dialog = vi.hoisted(() => ({ message: vi.fn() }));
const clipboard = vi.hoisted(() => ({ copyText: vi.fn() }));
vi.mock("../lib/fs", async (original) => ({
  ...(await original<typeof import("../lib/fs")>()),
  revealPath: fs.revealPath,
}));
vi.mock("@tauri-apps/plugin-dialog", async (original) => ({
  ...(await original<typeof import("@tauri-apps/plugin-dialog")>()),
  message: dialog.message,
}));
vi.mock("../lib/clipboard", () => ({ copyText: clipboard.copyText }));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => false,
}));

const { AgentMarkdown } = await import("./AgentMarkdown");
const { REVEAL_LABEL } = await import("../lib/platform");

const CWD = "/Users/me/Developer/epcr-holo";

describe("AgentMarkdown file link menu", () => {
  let root: Root;
  let host: HTMLDivElement;
  const onOpenFile = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    fs.revealPath.mockResolvedValue(undefined);
    dialog.message.mockResolvedValue(undefined);
    clipboard.copyText.mockResolvedValue(undefined);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const render = (text: string, allowRemoteMedia = false) =>
    act(async () =>
      root.render(
        createElement(AgentMarkdown, {
          text,
          cwd: CWD,
          onOpenFile,
          allowRemoteMedia,
        }),
      ),
    );

  const rightClick = async (target: Element) => {
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 30,
      clientY: 40,
    });
    await act(async () => {
      target.dispatchEvent(event);
    });
    return event;
  };

  const menu = () => document.querySelector('[role="menu"]');
  const menuItem = (label: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (item) => item.textContent === label,
    );
  const pick = async (label: string) => {
    const item = menuItem(label);
    expect(item, `menu item "${label}"`).toBeDefined();
    await act(async () => item!.click());
  };

  it("reveals a relative file link against the session's folder", async () => {
    await render("Saved [epcr-holo-requests.md](docs/epcr-holo-requests.md).");
    const event = await rightClick(host.querySelector("a")!);

    expect(event.defaultPrevented).toBe(true);
    expect(menu()).not.toBeNull();
    await pick(REVEAL_LABEL);

    expect(fs.revealPath).toHaveBeenCalledWith(
      `${CWD}/docs/epcr-holo-requests.md`,
    );
    expect(menu()).toBeNull();
  });

  it("reveals an absolute path without its line number", async () => {
    await render("See [plan](/Users/me/notes/plan.md:12).");
    await rightClick(host.querySelector("a")!);
    await pick(REVEAL_LABEL);

    expect(fs.revealPath).toHaveBeenCalledWith("/Users/me/notes/plan.md");
  });

  it("offers the same menu on an inline file reference", async () => {
    await render("Edit `src/App.tsx` next.");
    await rightClick(host.querySelector("code")!);
    await pick(REVEAL_LABEL);

    expect(fs.revealPath).toHaveBeenCalledWith(`${CWD}/src/App.tsx`);
  });

  it("still opens and copies the file from the menu", async () => {
    await render("[plan](notes/plan.md:7)");
    await rightClick(host.querySelector("a")!);
    await pick("Open");
    expect(onOpenFile).toHaveBeenCalledWith(`${CWD}/notes/plan.md`, {
      line: 7,
    });

    await rightClick(host.querySelector("a")!);
    await pick("Copy Path");
    expect(clipboard.copyText).toHaveBeenCalledWith(`${CWD}/notes/plan.md`);
  });

  it("leaves web links with the system menu", async () => {
    await render("[Docs](https://example.com/docs)");
    const event = await rightClick(host.querySelector("a")!);

    expect(event.defaultPrevented).toBe(false);
    expect(menu()).toBeNull();
  });

  it("never offers to reveal paths from remote Inbox content", async () => {
    await render("[secrets](/etc/hosts)", true);
    const event = await rightClick(host.querySelector("a")!);

    expect(event.defaultPrevented).toBe(false);
    expect(menu()).toBeNull();
  });

  it("explains a missing file instead of failing silently", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fs.revealPath.mockRejectedValue(
      `${CWD}/gone.md: No such file or directory`,
    );
    await render("[gone.md](gone.md)");
    await rightClick(host.querySelector("a")!);
    await pick(REVEAL_LABEL);

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("No such file or directory"),
    );
    expect(dialog.message).toHaveBeenCalledWith(
      expect.stringContaining("gone.md"),
      expect.objectContaining({ kind: "error" }),
    );
  });
});

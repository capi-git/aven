// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({ invoke: vi.fn() }));
const fs = vi.hoisted(() => ({ revealPath: vi.fn() }));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke: core.invoke,
  isTauri: () => false,
}));
vi.mock("../lib/fs", async (original) => ({
  ...(await original<typeof import("../lib/fs")>()),
  revealPath: fs.revealPath,
}));

const { AgentMarkdown } = await import("./AgentMarkdown");
const { SHOW_DOWNLOAD_LABEL } = await import("./ChatDownloadLink");
const { resetChatDownloadsForTests } = await import("../lib/chatDownloads");

const CWD = "/Users/me/Developer/epcr-holo";
const PDF = `${CWD}/.aven/files/Sign-in and admin levels.pdf`;
const SAVED = "/Users/me/Downloads/Sign-in and admin levels.pdf";

describe("AgentMarkdown download links", () => {
  let root: Root;
  let host: HTMLDivElement;
  const onOpenFile = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    resetChatDownloadsForTests();
    fs.revealPath.mockResolvedValue(undefined);
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
  });

  const render = (text: string) =>
    act(async () =>
      root.render(createElement(AgentMarkdown, { text, cwd: CWD, onOpenFile })),
    );
  const link = () => host.querySelector<HTMLAnchorElement>("a")!;
  // The popup is portalled to the page, outside the message.
  const popup = () => document.querySelector(".chat-download-popup");
  const popupText = (part: "name" | "status") =>
    popup()?.querySelector(`.chat-download-${part}`)?.textContent;
  const button = (label: string) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent === label,
    );
  const click = (target: HTMLElement) =>
    act(async () => {
      target.click();
    });
  const saves = (copy: { path: string; name: string; openable: boolean }) =>
    core.invoke.mockImplementation(async (command: string) => {
      if (command === "agent_file_download") return copy;
      if (command === "agent_download_open") return undefined;
      throw new Error(`unexpected ${command}`);
    });

  it("shows a made file as a blue link that downloads, then offers Open and Show in Finder", async () => {
    saves({
      path: SAVED,
      name: "Sign-in and admin levels.pdf",
      openable: true,
    });
    await render(
      `Here it is: [Sign-in and admin levels.pdf](<${PDF}>). Two pages.`,
    );

    expect(link().classList).toContain("chat-reference");
    expect(link().classList).toContain("chat-download-link");
    expect(link().textContent).toBe("Sign-in and admin levels.pdf");
    expect(popup()).toBeNull();

    await click(link());

    expect(core.invoke).toHaveBeenCalledWith("agent_file_download", {
      path: PDF,
    });
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(popupText("name")).toBe("Sign-in and admin levels.pdf");
    expect(popupText("status")).toBe("Downloaded");
    // The message itself is unchanged, apart from the link's check.
    expect(host.textContent).toBe(
      "Here it is: Sign-in and admin levels.pdf. Two pages.",
    );
    expect(link().dataset.state).toBe("saved");

    await click(button("Open")!);
    expect(core.invoke).toHaveBeenCalledWith("agent_download_open", {
      path: SAVED,
    });
    expect(popup()).toBeNull();

    await click(link());
    await click(button(SHOW_DOWNLOAD_LABEL)!);
    expect(fs.revealPath).toHaveBeenCalledWith(SAVED);
    expect(popup()).toBeNull();
  });

  it("closes the popup on Escape and gives the link the keyboard back", async () => {
    saves({
      path: SAVED,
      name: "Sign-in and admin levels.pdf",
      openable: true,
    });
    await render(`[Sign-in and admin levels.pdf](<${PDF}>)`);
    await click(link());
    expect(popup()).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(popup()).toBeNull();
    expect(document.activeElement).toBe(link());
  });

  it("names the copy when Downloads already had one, and downloads again on another click", async () => {
    saves({
      path: "/Users/me/Downloads/Sign-in and admin levels (1).pdf",
      name: "Sign-in and admin levels (1).pdf",
      openable: true,
    });
    await render(`[Sign-in and admin levels.pdf](<${PDF}>)`);
    await click(link());
    await click(link());

    expect(
      core.invoke.mock.calls.filter(
        ([command]) => command === "agent_file_download",
      ),
    ).toHaveLength(2);
    expect(popupText("name")).toBe("Sign-in and admin levels (1).pdf");
    expect(popupText("status")).toBe("Downloaded");
  });

  it("only shows a program or script in Finder", async () => {
    saves({
      path: "/Users/me/Downloads/setup.command",
      name: "setup.command",
      openable: false,
    });
    await render(`[setup.command](${CWD}/.aven/files/setup.command)`);
    await click(link());

    expect(button("Open")).toBeUndefined();
    expect(button(SHOW_DOWNLOAD_LABEL)).toBeDefined();
  });

  it("says why a download failed", async () => {
    core.invoke.mockRejectedValue(
      "report.csv isn't there any more. Ask the agent to make it again.",
    );
    await render(`[report.csv](.aven/files/report.csv)`);
    await click(link());

    expect(core.invoke).toHaveBeenCalledWith("agent_file_download", {
      path: `${CWD}/.aven/files/report.csv`,
    });
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe(
      "report.csv isn't there any more. Ask the agent to make it again.",
    );
    expect(button("Open")).toBeUndefined();
  });

  it("offers Download, then Open and Show in Finder, on right-click", async () => {
    saves({
      path: SAVED,
      name: "Sign-in and admin levels.pdf",
      openable: true,
    });
    await render(`[the PDF](<${PDF}>)`);
    const labels = () =>
      [...document.querySelectorAll('[role="menuitem"]')].map(
        (item) => item.textContent,
      );
    const rightClick = () =>
      act(async () => {
        link().dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
        );
      });

    await rightClick();
    expect(labels()).toEqual(["Download"]);
    const download = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ][0]!;
    await act(async () => download.click());
    expect(core.invoke).toHaveBeenCalledWith("agent_file_download", {
      path: PDF,
    });

    await rightClick();
    expect(labels()).toEqual(["Download", "Open", SHOW_DOWNLOAD_LABEL]);
  });

  it("keeps opening project files the way it did", async () => {
    await render("See [the plan](docs/plan.md) and `src/App.tsx`.");

    expect(host.querySelector(".chat-download")).toBeNull();
    await click(link());
    expect(onOpenFile).toHaveBeenCalledWith(`${CWD}/docs/plan.md`, undefined);
    expect(core.invoke).not.toHaveBeenCalledWith(
      "agent_file_download",
      expect.anything(),
    );
  });
});

// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const gitSetup = vi.hoisted(() => ({ setUpProjectGit: vi.fn() }));
vi.mock("../lib/projectGitSetup", async (original) => ({
  ...(await original<typeof import("../lib/projectGitSetup")>()),
  setUpProjectGit: gitSetup.setUpProjectGit,
}));

const { BotGitSetupSheet, BotPicker } = await import("./BotPicker");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  gitSetup.setUpProjectGit.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) =>
      item.textContent === label || item.getAttribute("aria-label") === label,
  );

function pending() {
  let finish: (value: unknown) => void = () => {};
  let fail: (error: unknown) => void = () => {};
  gitSetup.setUpProjectGit.mockReturnValue(
    new Promise((resolve, reject) => {
      finish = resolve;
      fail = reject;
    }),
  );
  return {
    finish: (value: unknown) => finish(value),
    fail: (e: unknown) => fail(e),
  };
}

it("Add a bot on a project without Git shows its row, sets Git up and then adds the bot", async () => {
  const onAdd = vi.fn();
  const onClose = vi.fn();
  const setup = pending();
  await act(async () =>
    root.render(
      createElement(BotGitSetupSheet, {
        project: { path: "/work/notes", label: "notes", state: "no-git" },
        onAdd,
        onClose,
      }),
    ),
  );
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Add a bot");
  const row = dialog.querySelector<HTMLElement>("[data-bot-setup]")!;
  expect(row.textContent).toBe("notesNot using Git yetSet up Git");
  expect(dialog.querySelector(".bot-picker-note")?.textContent).toContain(
    "Nothing is uploaded.",
  );

  await act(async () => button("Set up Git for notes")!.click());
  expect(gitSetup.setUpProjectGit).toHaveBeenCalledExactlyOnceWith(
    "/work/notes",
  );
  expect(row.querySelector('[role="status"]')?.textContent).toBe(
    "Setting up Git…",
  );
  // Setting up can't stop halfway: Escape leaves the sheet open meanwhile.
  await act(async () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  expect(onClose).not.toHaveBeenCalled();

  await act(async () =>
    setup.finish({ started: true, wroteIgnore: true, files: 2 }),
  );
  expect(onAdd).toHaveBeenCalledExactlyOnceWith("/work/notes");
});

it("offers a first save to a repository with nothing saved, and shows a refusal on the row", async () => {
  const onAdd = vi.fn();
  const setup = pending();
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  await act(async () =>
    root.render(
      createElement(BotGitSetupSheet, {
        project: { path: "/work/web", label: "web", state: "no-commit" },
        onAdd,
        onClose: vi.fn(),
      }),
    ),
  );
  const row = document.querySelector<HTMLElement>("[data-bot-setup]")!;
  expect(row.textContent).toBe("webNothing saved in Git yetMake a first save");
  await act(async () => button("Make a first save for web")!.click());
  expect(row.querySelector('[role="status"]')?.textContent).toBe(
    "Making a first save…",
  );
  await act(async () =>
    setup.fail(
      "This folder is inside another Git project, “site”. Add that project to Aven and add the bot there instead.\nmore detail",
    ),
  );
  expect(row.querySelector('[role="alert"]')?.textContent).toBe(
    "This folder is inside another Git project, “site”. Add that project to Aven and add the bot there instead.",
  );
  expect(row.textContent).toContain("Nothing saved in Git yet");
  expect(onAdd).not.toHaveBeenCalled();
  quiet.mockRestore();
});

it("a picker closed while Git is being set up adds no bot afterwards", async () => {
  const onAdd = vi.fn();
  const setup = pending();
  await act(async () =>
    root.render(
      createElement(BotPicker, {
        x: 10,
        y: 10,
        projects: [
          { path: "/work/app", label: "app", state: "ready" },
          { path: "/work/notes", label: "notes", state: "no-git" },
        ],
        empty: "",
        onAdd,
        onClose: vi.fn(),
      }),
    ),
  );
  await act(async () => button("Set up Git for notes")!.click());
  await act(async () => root.render(null));
  await act(async () =>
    setup.finish({ started: true, wroteIgnore: false, files: 1 }),
  );
  expect(onAdd).not.toHaveBeenCalled();
});

it("says why nothing is listed", async () => {
  await act(async () =>
    root.render(
      createElement(BotPicker, {
        x: 10,
        y: 10,
        projects: [],
        empty: "Every project has a bot",
        onAdd: vi.fn(),
        onClose: vi.fn(),
      }),
    ),
  );
  const picker = document.querySelector<HTMLElement>(
    '[role="dialog"][aria-label="Add a bot to"]',
  )!;
  expect(picker.textContent).toBe("Every project has a bot");
  expect(picker.querySelector(".bot-picker-note")).toBeNull();
});

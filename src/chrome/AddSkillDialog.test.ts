// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillsCliOutcome, SkillsCliRequest } from "../lib/skillInstall";

type Pending = {
  request: SkillsCliRequest;
  onLine: (line: string) => void;
  resolve: (outcome: SkillsCliOutcome) => void;
  reject: (reason: unknown) => void;
};

const cli = vi.hoisted(() => ({
  runs: [] as Pending[],
  cancel: vi.fn(async () => {}),
  forget: vi.fn(),
}));
vi.mock("../lib/skillInstall", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/skillInstall")>()),
  runSkillsCli: (request: SkillsCliRequest, onLine: (line: string) => void) =>
    new Promise<SkillsCliOutcome>((resolve, reject) =>
      cli.runs.push({ request, onLine, resolve, reject }),
    ),
  cancelSkillsCli: cli.cancel,
  forgetSkillListsAfterInstall: cli.forget,
}));

import { AddSkillDialog, SKILL_RISK_LINE } from "./AddSkillDialog";
import { NODE_MISSING } from "../lib/skillInstall";

const LIST_TWO =
  "◇  Available Skills\n│\n│    hallmark\n│\n│      Make pages look designed.\n│\n│    polish\n│\n│      Polish an interface.\n\n└  Use --skill <name> to install specific skills\n";
const LIST_ONE =
  "◇  Available Skills\n│\n│    hallmark\n│\n│      Make pages look designed.\n└  Use --skill <name>\n";

const finished = (patch: Partial<SkillsCliOutcome> = {}): SkillsCliOutcome => ({
  status: "finished",
  code: 0,
  stdout: "",
  stderr: "",
  installed: [],
  ...patch,
});

let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof AddSkillDialog>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  cli.runs = [];
  cli.cancel.mockClear();
  cli.forget.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  props = { cwd: "/work/site", onClose: vi.fn(), onInstalled: vi.fn() };
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(createElement(AddSkillDialog, props)));
}
const dialog = () =>
  document.body.querySelector<HTMLElement>("[data-add-skill]")!;
const field = () =>
  dialog().querySelector<HTMLInputElement>(
    '[aria-label="owner/repo or a GitHub link"]',
  )!;
const button = (label: string) =>
  [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === label,
  );
const primary = () =>
  dialog().querySelector<HTMLButtonElement>('button[type="submit"]')!;
const alertText = () =>
  dialog().querySelector('[role="alert"]')?.textContent ?? null;
const statusText = () =>
  [...dialog().querySelectorAll('[role="status"]')]
    .map((item) => item.textContent)
    .join(" ");
const boxes = () => [
  ...dialog().querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
];

async function typeSource(value: string) {
  await act(async () => {
    const input = field();
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    dialog().dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}
async function settle(index: number, outcome: SkillsCliOutcome) {
  await act(async () => cli.runs[index].resolve(outcome));
}
async function line(index: number, text: string) {
  await act(async () => cli.runs[index].onLine(text));
}

describe("Add a skill dialog", () => {
  it("asks for a source, offers both scopes, and states the risk", async () => {
    await render();
    expect(field().placeholder).toBe("nutlope/hallmark");
    expect(document.activeElement).toBe(field());
    expect(dialog().textContent).toContain(SKILL_RISK_LINE);
    const all = button("All projects~/.agents/skills")!;
    const here = button("This project.agents/skills")!;
    expect(all.className).toContain("bg-content/20");
    expect(here.disabled).toBe(false);
    expect(primary().textContent).toBe("Show skills");
    expect(primary().disabled).toBe(true);
  });

  it("offers only All projects outside a project", async () => {
    props.cwd = "~";
    await render();
    expect(button("This project.agents/skills")!.disabled).toBe(true);
  });

  it("explains a source it won't run", async () => {
    await render();
    await typeSource("owner/repo; rm -rf ~");
    expect(dialog().textContent).toContain(
      "Use owner/repo, a GitHub link, or a skill name.",
    );
    expect(primary().disabled).toBe(true);
    await submit();
    expect(cli.runs).toHaveLength(0);
  });

  it("lists, then installs the chosen skills for all projects", async () => {
    await render();
    await typeSource("nutlope/hallmark");
    await submit();
    expect(cli.runs[0].request).toMatchObject({
      action: "list",
      source: "nutlope/hallmark",
    });
    expect(statusText()).toContain("Looking in nutlope/hallmark…");
    expect(field().disabled).toBe(true);
    await line(0, "$ npx --yes skills@1 add nutlope/hallmark --list");
    expect(
      dialog().querySelector('[aria-label="Installer output"]')?.textContent,
    ).toContain("npx --yes skills@1 add nutlope/hallmark --list");
    expect(button("Stop")).toBeDefined();

    await settle(0, finished({ stdout: LIST_TWO }));
    expect(dialog().textContent).toContain("2 skills in nutlope/hallmark");
    expect(dialog().textContent).toContain("Polish an interface.");
    expect(boxes().map((box) => box.checked)).toEqual([true, true]);
    expect(primary().textContent).toBe("Install 2 skills");
    await act(async () => boxes()[1].click());
    expect(primary().textContent).toBe("Install");

    await submit();
    expect(cli.runs[1].request).toMatchObject({
      action: "add",
      source: "nutlope/hallmark",
      global: true,
      skills: ["hallmark"],
      allSkills: false,
    });
    expect(statusText()).toContain("Adding hallmark…");
    expect(primary().disabled).toBe(true);
    await settle(
      1,
      finished({
        stdout: JSON.stringify([{ name: "hallmark", status: "installed" }]),
        installed: ["hallmark"],
      }),
    );
    expect(statusText()).toContain("Added hallmark for all projects");
    expect(alertText()).toBeNull();
    expect(cli.forget).toHaveBeenCalledWith("global", "/work/site");
    expect(props.onInstalled).toHaveBeenCalledWith({
      names: ["hallmark"],
      scope: "global",
    });
    expect(primary().textContent).toBe("Done");
    await submit();
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("installs into this project when chosen", async () => {
    await render();
    await act(async () => button("This project.agents/skills")!.click());
    await typeSource("https://github.com/nutlope/hallmark");
    await submit();
    expect(cli.runs[0].request.source).toBe(
      "https://github.com/nutlope/hallmark",
    );
    await settle(0, finished({ stdout: LIST_ONE }));
    // One skill: nothing to tick.
    expect(boxes()).toHaveLength(0);
    expect(dialog().textContent).toContain("In nutlope/hallmark");
    await submit();
    expect(cli.runs[1].request).toMatchObject({
      action: "add",
      global: false,
      cwd: "/work/site",
      skills: ["hallmark"],
      allSkills: true,
    });
    await settle(1, finished({ installed: ["hallmark"] }));
    expect(statusText()).toContain("Added hallmark to this project");
    expect(cli.forget).toHaveBeenCalledWith("project", "/work/site");
  });

  it("looks a bare name up on skills.sh and ticks that skill", async () => {
    await render();
    await typeSource("polish");
    await submit();
    expect(cli.runs[0].request).toMatchObject({
      action: "find",
      source: "polish",
    });
    expect(statusText()).toContain("Searching skills.sh for polish…");
    await settle(
      0,
      finished({ stdout: "nutlope/hallmark@polish 2K installs\n" }),
    );
    expect(cli.runs[1].request).toMatchObject({
      action: "list",
      source: "nutlope/hallmark",
    });
    await settle(1, finished({ stdout: LIST_TWO }));
    expect(boxes().map((box) => box.checked)).toEqual([false, true]);
  });

  it("says when skills.sh has no such skill", async () => {
    await render();
    await typeSource("nothing-here");
    await submit();
    await settle(0, finished({ stdout: 'No skills found for "nothing-here"' }));
    expect(alertText()).toContain("No skill called “nothing-here”");
    expect(cli.runs).toHaveLength(1);
    expect(primary().textContent).toBe("Show skills");
  });

  it("explains a missing Node.js", async () => {
    await render();
    await typeSource("nutlope/hallmark");
    await submit();
    await settle(0, finished({ status: "missingNode", code: null }));
    expect(alertText()).toBe(NODE_MISSING);
    expect(field().disabled).toBe(false);
  });

  it("explains a source that can't be read and keeps the output", async () => {
    await render();
    await typeSource("nutlope/nope");
    await submit();
    await line(0, "■  Failed to clone repository");
    await settle(
      0,
      finished({ code: 1, stdout: "■  Failed to clone repository" }),
    );
    expect(alertText()).toContain("Couldn't find nutlope/nope on GitHub");
    const output = dialog().querySelector("details");
    expect(output?.textContent).toContain("Show output");
    expect(output?.textContent).toContain("Failed to clone repository");
  });

  it("explains a failed install and lets you try again", async () => {
    await render();
    await typeSource("nutlope/hallmark");
    await submit();
    await settle(0, finished({ stdout: LIST_ONE }));
    await submit();
    await settle(
      1,
      finished({
        code: 1,
        stdout: JSON.stringify([
          { status: "failed", error: "Failed to clone repository" },
        ]),
      }),
    );
    expect(alertText()).toContain("Couldn't add hallmark");
    expect(props.onInstalled).not.toHaveBeenCalled();
    expect(primary().textContent).toBe("Install");
    expect(primary().disabled).toBe(false);
  });

  it("stops a run on request and when the dialog closes", async () => {
    await render();
    await typeSource("nutlope/hallmark");
    await submit();
    await act(async () => button("Stop")!.click());
    expect(cli.cancel).toHaveBeenCalledWith(cli.runs[0].request.runId);
    await settle(0, finished({ status: "cancelled", code: null }));
    expect(primary().textContent).toBe("Show skills");
    expect(alertText()).toBeNull();

    await submit();
    await settle(1, finished({ stdout: LIST_ONE }));
    await submit();
    await settle(2, finished({ status: "cancelled", code: null }));
    expect(alertText()).toBe("Stopped before it finished.");

    await submit();
    cli.cancel.mockClear();
    await act(async () => root.unmount());
    expect(cli.cancel).toHaveBeenCalledWith(cli.runs[3].request.runId);
    root = createRoot(container);
  });

  it("starts over when the source changes", async () => {
    await render();
    await typeSource("nutlope/hallmark");
    await submit();
    await settle(0, finished({ stdout: LIST_TWO }));
    expect(boxes()).toHaveLength(2);
    await typeSource("nutlope/other");
    expect(boxes()).toHaveLength(0);
    expect(primary().textContent).toBe("Show skills");
  });
});

// @vitest-environment happy-dom
import {
  act,
  createElement,
  Profiler,
  type ComponentProps,
  type ProfilerOnRenderCallback,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerHarness } from "../lib/harness/registry";
import { codexAdapter } from "../lib/harness/codexAdapter";
import { invalidateProjectFiles } from "../lib/fileIndex";
import { rememberRecentSkills } from "../lib/recentSkills";
import type { Skill } from "../lib/skills";
import { Composer } from "./Composer";

const catalog = vi.hoisted(() => ({ skills: [] as Skill[] }));
vi.mock("./useComposerSkills", () => ({
  useComposerSkills: () => ({
    skills: catalog.skills,
    refresh: async () => true,
  }),
}));
vi.mock("../lib/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/fs")>()),
  listProjectFiles: vi.fn(async () => [
    {
      name: "App.tsx",
      path: "/work/site/src/App.tsx",
      relative: "src/App.tsx",
    },
  ]),
}));
vi.mock("../lib/notes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/notes")>()),
  loadNotes: vi.fn(async () => []),
}));
vi.mock("../hooks/useTabGroupLogos", () => ({ useTabGroupLogos: () => ({}) }));
// Count commits inside the helm (the critter and its dialog). It keeps its
// own memo, so a parent render with the same props commits nothing.
const commitsIn = vi.hoisted(() => ({ helm: 0 }));
vi.mock("./ComposerHelm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ComposerHelm")>();
  const react = await import("react");
  return {
    ...actual,
    ComposerHelm: react.memo(
      (props: ComponentProps<typeof actual.ComposerHelm>) =>
        react.createElement(
          react.Profiler,
          { id: "helm", onRender: () => (commitsIn.helm += 1) },
          react.createElement(actual.ComposerHelm, props),
        ),
    ),
  };
});
vi.mock("./ComposerRunner", () => ({ ComposerRunner: () => null }));

const skill = (name: string): Skill => ({
  kind: "file",
  name,
  description: `The ${name} skill.`,
  invocation: name,
  path: `/work/site/.agents/skills/${name}/SKILL.md`,
  scope: "project",
  source: "agents",
});

let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof Composer>;
let storage: Map<string, string>;
let commits = 0;
const onRender: ProfilerOnRenderCallback = () => {
  commits += 1;
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  registerHarness(codexAdapter);
  invalidateProjectFiles();
  catalog.skills = [];
  commits = 0;
  commitsIn.helm = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  props = {
    enabled: true,
    focused: false,
    harness: "codex",
    model: "gpt-5",
    runtimeMode: "full-access",
    cwd: "/work/site",
    executionCwd: "/work/site",
    hideTopBar: true,
    onFocus: vi.fn(),
    onCwdChange: vi.fn(),
    onModelChange: vi.fn(),
    onRuntimeModeChange: vi.fn(),
    onSubmit: vi.fn(),
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () =>
    root.render(
      createElement(
        Profiler,
        { id: "composer", onRender },
        createElement(Composer, props),
      ),
    ),
  );
}
const field = () => container.querySelector("textarea")!;
// Recent skills wait on the Skills page of the critter's dialog, offered
// while the message is empty and nothing runs.
async function openSkills(): Promise<boolean> {
  const critter = container.querySelector<HTMLButtonElement>(
    "[data-helm-critter]",
  )!;
  if (!container.querySelector("[data-helm-dialog]"))
    await act(async () => critter.click());
  const row = container.querySelector<HTMLButtonElement>(
    '[data-helm-row="skills"]',
  );
  if (row) await act(async () => row.click());
  return !!row;
}
async function closeHelm() {
  if (container.querySelector("[data-helm-dialog]"))
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("[data-helm-critter]")!
        .click(),
    );
}
async function chips(): Promise<(string | null)[]> {
  const shown = (await openSkills())
    ? [
        ...container.querySelectorAll<HTMLElement>(
          '[aria-label="Recent skills"] [data-helm-item-index] .helm-value',
        ),
      ].map((item) => item.textContent)
    : [];
  await closeHelm();
  return shown;
}
async function chip(label: string): Promise<HTMLButtonElement> {
  await openSkills();
  return [
    ...container.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Recent skills"] [data-helm-item-index]',
    ),
  ].find((item) => item.querySelector(".helm-value")?.textContent === label)!;
}
const skillPicker = () => container.querySelector("[data-skill-picker]");
const mentionPicker = () => container.querySelector("[data-mention-picker]");
const highlighted = () =>
  container.querySelector('[role="option"][aria-selected="true"]')
    ?.textContent ?? null;

/** Replace the text and put the caret at the end, like typing its last key. */
async function input(text: string) {
  await act(async () => {
    const el = field();
    el.value = text;
    el.setSelectionRange(text.length, text.length);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function keyUp(key: string) {
  await act(async () => {
    field().dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
  });
}
async function type(text: string) {
  await input(text);
  await keyUp(text.slice(-1) || "Backspace");
}
async function press(key: string) {
  await act(async () => {
    field().dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
  await keyUp(key);
}
/** Move the caret with an arrow key the pickers leave alone. */
async function moveCaret(position: number) {
  await act(async () => {
    field().setSelectionRange(position, position);
  });
  await keyUp("ArrowLeft");
}

describe("Escape on the / picker", () => {
  it("stays closed while typing on in that word, and Enter sends", async () => {
    await render();
    await type("/tm");
    expect(skillPicker()).not.toBeNull();
    await press("Escape");
    expect(skillPicker()).toBeNull();
    await type("/tmp");
    expect(skillPicker()).toBeNull();
    await press("Enter");
    expect(props.onSubmit).toHaveBeenCalledExactlyOnceWith(
      "/tmp",
      [],
      expect.anything(),
    );
  });

  it("forgets the dismissal once the caret leaves the word", async () => {
    await render();
    await type("fix /tm");
    await press("Escape");
    expect(skillPicker()).toBeNull();
    await moveCaret(2);
    expect(skillPicker()).toBeNull();
    await moveCaret(7);
    expect(skillPicker()).not.toBeNull();
  });

  it("opens again for a new / word", async () => {
    await render();
    await type("/tm");
    await press("Escape");
    await type("/tm ");
    await type("/tm /p");
    expect(skillPicker()).not.toBeNull();
  });

  it("opens again after the message is sent", async () => {
    await render();
    await type("/tmp");
    await press("Escape");
    await press("Enter");
    expect(field().value).toBe("");
    await type("/");
    expect(skillPicker()).not.toBeNull();
  });
});

describe("Escape on the @ picker", () => {
  it("stays closed while typing on, and Enter sends", async () => {
    await render();
    await type("Ask @ali");
    expect(mentionPicker()).not.toBeNull();
    await press("Escape");
    expect(mentionPicker()).toBeNull();
    await type("Ask @alice");
    expect(mentionPicker()).toBeNull();
    await press("Enter");
    expect(props.onSubmit).toHaveBeenCalledExactlyOnceWith(
      "Ask @alice",
      [],
      expect.anything(),
    );
  });

  it("opens again when the caret comes back to the word", async () => {
    await render();
    await type("Ask @ali");
    await press("Escape");
    await moveCaret(1);
    await moveCaret(8);
    expect(mentionPicker()).not.toBeNull();
  });
});

describe("/ picker rows", () => {
  it("sends with Enter when no skill matches", async () => {
    await render();
    await type("Deploy to /zzz");
    expect(container.textContent).toContain("No matching commands or skills");
    expect(highlighted()).toBeNull();
    await press("Enter");
    expect(props.onSubmit).toHaveBeenCalledExactlyOnceWith(
      "Deploy to /zzz",
      [],
      expect.anything(),
    );
    expect(container.querySelector('[aria-label="Skill name"]')).toBeNull();
  });

  it("reaches Create skill with the arrow keys", async () => {
    await render();
    await type("/tidy");
    await press("ArrowDown");
    expect(highlighted()).toContain('Create skill "tidy"');
    await press("Enter");
    const name = container.querySelector<HTMLInputElement>(
      '[aria-label="Skill name"]',
    );
    expect(name?.value).toBe("tidy");
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("wraps from the first match to Add a skill, then Create skill", async () => {
    catalog.skills = [skill("polish")];
    await render();
    await type("/pol");
    expect(highlighted()).toContain("/polish");
    await press("ArrowUp");
    expect(highlighted()).toContain("Add a skill…");
    await press("ArrowUp");
    expect(highlighted()).toContain('Create skill "pol"');
    await press("ArrowDown");
    await press("ArrowDown");
    expect(highlighted()).toContain("/polish");
  });

  it("offers recently used skills first", async () => {
    catalog.skills = [skill("alpha"), skill("beta")];
    await render();
    await type("/");
    expect(highlighted()).toContain("/alpha");
    await press("ArrowDown");
    expect(highlighted()).toContain("/beta");
    await press("Enter");
    expect(field().value).toBe("/beta ");
    await press("Enter");
    expect(props.onSubmit).toHaveBeenCalledOnce();

    await type("/");
    expect(highlighted()).toContain("/beta");
    expect(JSON.parse(storage.get("aven.recentSkills.v1")!)).toEqual({
      "/work/site": ["beta"],
    });
  });

  it("puts Aven's own commands after the project's skills", async () => {
    catalog.skills = [skill("zeta")];
    await render();
    await type("/");
    const rows = [
      ...container.querySelectorAll('[role="option"] .font-mono'),
    ].map((row) => row.textContent);
    expect(rows).toEqual(["/zeta", "/plan"]);
  });

  it("does not re-render the composer when a key leaves the token as it was", async () => {
    await render();
    await type("/pl");
    commits = 0;
    await keyUp("l");
    await act(async () => {
      field().dispatchEvent(new Event("select", { bubbles: true }));
    });
    expect(commits).toBe(0);
  });
});

describe("composer hint", () => {
  it("names what / and @ open", async () => {
    await render();
    expect(field().placeholder).toBe(
      "Ask anything · / for skills · @ for files",
    );
    storage.set("monocode.notesEnabled", "false");
    props = { ...props, cwd: "~" };
    await render();
    expect(field().placeholder).toBe("Ask anything · / for skills");
  });
});

describe("typing", () => {
  it("renders the helm once, as the box stops being empty, and never again", async () => {
    catalog.skills = [skill("polish"), skill("deploy")];
    rememberRecentSkills("/work/site", ["polish", "deploy"]);
    await render();
    expect(container.querySelector("[data-helm-critter]")).not.toBeNull();
    expect(await chips()).toEqual(["/polish", "/deploy"]);
    await type("F");
    commitsIn.helm = 0;
    let text = "F";
    for (const character of "ix the login loop") {
      text += character;
      await type(text);
    }
    expect(commits).toBeGreaterThan(0);
    expect(commitsIn.helm).toBe(0);
    expect(await chips()).toEqual([]);
  });
});

describe("recent skills in the dialog", () => {
  it("offers up to four recent skills the chat can still run, most recent first", async () => {
    catalog.skills = ["a", "b", "c", "d", "e"].map(skill);
    rememberRecentSkills("/work/site", ["gone", "e", "d", "c", "b", "a"]);
    await render();
    // `gone` left the catalog, and only four fit.
    expect(await chips()).toEqual(["/e", "/d", "/c", "/b"]);
  });

  it("starts the message with the skill and focuses the field", async () => {
    catalog.skills = [skill("polish")];
    rememberRecentSkills("/work/site", ["polish"]);
    await render();
    const polish = await chip("/polish");
    await act(async () => polish.click());
    expect(field().value).toBe("/polish ");
    expect(field().selectionStart).toBe("/polish ".length);
    expect(document.activeElement).toBe(field());
    expect(await chips()).toEqual([]);
    await type("/polish the header");
    await press("Enter");
    expect(props.onSubmit).toHaveBeenCalledWith(
      "/polish the header",
      [],
      expect.anything(),
    );
  });

  it("switches to Plan mode the way the / picker does", async () => {
    rememberRecentSkills("/work/site", ["plan"]);
    await render();
    const plan = await chip("/plan");
    await act(async () => plan.click());
    expect(field().value).toBe("");
    expect(
      container.querySelector('[aria-label="Turn off Plan mode"]'),
    ).not.toBeNull();
    await type("Outline the migration");
    await press("Enter");
    expect(props.onSubmit).toHaveBeenCalledWith(
      "Outline the migration",
      [],
      expect.objectContaining({ intent: "plan" }),
    );
  });

  it("follows skills used in another pane", async () => {
    catalog.skills = [skill("polish"), skill("deploy")];
    rememberRecentSkills("/work/site", ["polish"]);
    await render();
    expect(await chips()).toEqual(["/polish"]);
    await act(async () => {
      rememberRecentSkills("/work/site", ["deploy"]);
    });
    expect(await chips()).toEqual(["/deploy", "/polish"]);
  });

  it("hides while a turn runs, while typing, and when there are none", async () => {
    catalog.skills = [skill("polish")];
    await render();
    expect(await chips()).toEqual([]);
    rememberRecentSkills("/work/site", ["polish"]);
    props = { ...props, busy: true };
    await render();
    expect(await chips()).toEqual([]);
    props = { ...props, busy: false };
    await render();
    expect(await chips()).toEqual(["/polish"]);
    await type("x");
    expect(await chips()).toEqual([]);
    await type("");
    expect(await chips()).toEqual(["/polish"]);
  });
});

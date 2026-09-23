// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentToolStatus } from "../lib/agentTools";
import type { DiscoveredSkill } from "../lib/fs";

const mocks = vi.hoisted(() => ({
  listSkills: vi.fn(),
  readTextFile: vi.fn(),
  status: vi.fn(),
  permissions: vi.fn(),
  install: vi.fn(),
  openFile: vi.fn(),
  openUrl: vi.fn(),
}));
vi.mock("../lib/fs", () => ({
  listSkills: mocks.listSkills,
  readTextFile: mocks.readTextFile,
  createPath: vi.fn(),
  writeTextFile: vi.fn(),
  homeDir: vi.fn(),
}));
vi.mock("../lib/agentTools", () => ({
  getAgentToolStatus: mocks.status,
  openComputerUseSettings: mocks.permissions,
  installPersonalComputerUseSkill: mocks.install,
}));
vi.mock("../lib/inAppLinks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/inAppLinks")>()),
  openInAppFile: mocks.openFile,
  openInAppUrl: mocks.openUrl,
}));
vi.mock("../lib/harness/registry", () => ({ getHarness: () => undefined }));
import { SkillsSettings } from "./SkillsSettings";

const ready: AgentToolStatus = {
  browserAvailable: true,
  desktop: {
    state: "ready",
    executable: "/opt/homebrew/bin/peekaboo",
    version: "Peekaboo 4.3.0",
    source: "bridge",
    permissions: [
      { name: "Screen Recording", granted: true, required: true },
      { name: "Accessibility", granted: true, required: true },
    ],
  },
};
const file: DiscoveredSkill = {
  name: "review-changes",
  description: "Review local changes",
  path: "/repo/.agents/skills/review-changes/SKILL.md",
  scope: "project",
  source: "agents",
};
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.listSkills.mockResolvedValue([file]);
  mocks.readTextFile.mockResolvedValue(
    "# Review\n\nRead scripts/check.sh relative to this skill.",
  );
  mocks.status.mockResolvedValue(ready);
  mocks.permissions.mockResolvedValue(undefined);
  mocks.openUrl.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function render(cwd = "/repo") {
  await act(async () => root.render(createElement(SkillsSettings, { cwd })));
}
function button(text: string) {
  const found = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((item) => item.textContent?.includes(text));
  if (!found) throw new Error(`No button: ${text}`);
  return found;
}
async function click(text: string) {
  await act(async () => button(text).click());
}

describe("Skills & Tools settings", () => {
  it("shows actual permission state without requesting or changing permissions", async () => {
    await render();
    expect(container.textContent).toContain("Permissions granted");
    expect(container.textContent).toContain("Permission source: bridge");
    expect(container.textContent).toContain("/aven-computer-use");
    expect(mocks.permissions).not.toHaveBeenCalled();
    await click("Accessibility settings");
    expect(mocks.permissions).toHaveBeenCalledExactlyOnceWith("accessibility");
  });

  it("opens built-in instructions in an accessible dialog", async () => {
    await render();
    await click("View instructions");
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Desktop control from Aven");
    expect(dialog.querySelector("h1")?.textContent).toBe(
      "Desktop control from Aven",
    );
    expect(
      [...dialog.querySelectorAll("h2")].some(
        (heading) => heading.textContent === "Observe, act, verify",
      ),
    ).toBe(true);
    expect(dialog.querySelector("ol li")).not.toBeNull();
    expect(dialog.textContent).not.toContain("name: aven-computer-use");
    expect(dialog.textContent).toContain("permissions status --json");
    expect(dialog.textContent).toContain(
      "Do not close, replace, or restart the Aven instance",
    );
    expect(mocks.readTextFile).not.toHaveBeenCalled();
  });

  it("inspects project skill content and opens that exact file in Aven", async () => {
    await render();
    await click("/review-changes");
    expect(mocks.readTextFile).toHaveBeenCalledWith(file.path);
    expect(
      document.querySelector('[aria-label="Skill instructions"]')?.textContent,
    ).toContain("Read scripts/check.sh");
    expect(
      document.querySelector('[aria-label="Skill instructions"] h1')
        ?.textContent,
    ).toBe("Review");
    await click("Open in editor");
    expect(mocks.openFile).toHaveBeenCalledWith(file.path);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("labels and finds legacy app skills as Aven while preserving their file path", async () => {
    const legacySkill = { ...file, source: "monocode" as const };
    mocks.listSkills.mockResolvedValue([
      legacySkill,
      { ...file, name: "other-provider-skill" },
    ]);
    await render();
    expect(button("/review-changes").textContent).toContain("Project · Aven");
    expect(button("/review-changes").textContent).not.toContain("monocode");
    expect(container.textContent).toContain("/other-provider-skill");

    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="Find a skill"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "Aven");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).not.toContain("/other-provider-skill");
    await click("/review-changes");
    await click("Open in editor");
    expect(mocks.openFile).toHaveBeenCalledWith(legacySkill.path);
    expect(legacySkill.source).toBe("monocode");
  });

  it("reports unreadable instructions instead of silently showing an empty file", async () => {
    mocks.readTextFile.mockRejectedValue(new Error("gone"));
    await render();
    await click("/review-changes");
    expect(
      document.querySelector('[role="dialog"] [role="alert"]')?.textContent,
    ).toContain("could not be read");
  });

  it("drops a stale project catalog when project selection changes", async () => {
    let resolveOld!: (files: DiscoveredSkill[]) => void;
    mocks.listSkills.mockImplementation((cwd: string) =>
      cwd === "/old"
        ? new Promise((resolve) => {
            resolveOld = resolve;
          })
        : Promise.resolve([{ ...file, name: "new-project" }]),
    );
    await render("/old");
    await render("/new");
    await act(async () => resolveOld([{ ...file, name: "stale-project" }]));
    expect(container.textContent).toContain("/new-project");
    expect(container.textContent).not.toContain("/stale-project");
  });

  it("clears stale ready status on a failed refresh while keeping the catalog usable", async () => {
    await render();
    mocks.status.mockRejectedValue(new Error("timed out"));
    await click("Check status");
    expect(container.textContent).toContain("Tools could not be checked");
    expect(container.textContent).not.toContain("Permissions granted");
    expect(button("/review-changes").disabled).toBe(false);
  });

  it.each(["missing", "permissionsRequired", "unverified"] as const)(
    "does not present %s as ready",
    async (state) => {
      mocks.status.mockResolvedValue({
        browserAvailable: true,
        desktop: { ...ready.desktop, state, permissions: [] },
      });
      await render();
      expect(
        container.querySelector('.skills-status[data-state="ready"]')
          ?.textContent,
      ).toBe("Built in");
      expect(container.textContent).not.toContain("Permissions granted");
    },
  );
});

it("chooses the new skill location in an app listbox without dismissing its dialog", async () => {
  await render();
  await click("New skill");
  const dialog = document.querySelector('[role="dialog"]')!;
  const location = dialog.querySelector<HTMLButtonElement>(
    '[role="combobox"][aria-label="Skill location"]',
  )!;
  expect(dialog.querySelector("select")).toBeNull();
  expect(location.textContent).toBe("This project");
  await act(async () => location.click());
  const choices = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="option"]'),
  ];
  expect(choices.map((choice) => choice.textContent)).toEqual([
    "This project",
    "Personal · all projects",
  ]);
  expect(
    Number(
      document.querySelector<HTMLElement>("[data-popover-side]")?.style.zIndex,
    ),
  ).toBeGreaterThan(90);
  await act(async () => choices[1].click());
  expect(location.textContent).toBe("Personal · all projects");
  expect(document.activeElement).toBe(location);
  expect(document.querySelector('[role="dialog"]')).toBe(dialog);
  await act(async () => location.click());
  await act(async () =>
    location.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  expect(document.querySelector('[role="dialog"]')).toBe(dialog);
});

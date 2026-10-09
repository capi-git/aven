// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentToolStatus, DesktopControlStatus } from "../lib/agentTools";
import type { DiscoveredSkill } from "../lib/fs";

const mocks = vi.hoisted(() => ({
  listSkills: vi.fn(),
  readTextFile: vi.fn(),
  status: vi.fn(),
  permissions: vi.fn(),
  setEnabled: vi.fn(),
  requestPermission: vi.fn(),
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
  setDesktopControlEnabled: mocks.setEnabled,
  requestDesktopPermission: mocks.requestPermission,
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
    enabled: true,
    permissions: [
      { name: "Screen Recording", granted: true, required: true },
      { name: "Accessibility", granted: true, required: true },
    ],
  },
};
const off: AgentToolStatus = {
  browserAvailable: true,
  desktop: {
    state: "off",
    enabled: false,
    permissions: ready.desktop.permissions.map((permission) => ({
      ...permission,
      granted: false,
    })),
  },
};
const permissionsRequired: DesktopControlStatus = {
  ...off.desktop,
  state: "permissionsRequired",
  enabled: true,
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
  mocks.setEnabled.mockReset().mockResolvedValue(ready.desktop);
  mocks.requestPermission.mockReset().mockResolvedValue(ready.desktop);
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
  ].find((item) =>
    (item.getAttribute("aria-label") ?? item.textContent)?.includes(text),
  );
  if (!found) throw new Error(`No button: ${text}`);
  return found;
}
function hasButton(text: string) {
  return [...document.querySelectorAll("button")].some((item) =>
    (item.getAttribute("aria-label") ?? item.textContent)?.includes(text),
  );
}
async function click(text: string) {
  await act(async () => button(text).click());
}
function desktopSwitch() {
  return container.querySelector<HTMLButtonElement>(
    '[role="switch"][aria-label="Let agents see and use apps on this Mac"]',
  )!;
}

describe("Skills & Tools settings", () => {
  it("shows actual permission state without requesting or changing permissions", async () => {
    await render();
    expect(container.textContent).toContain("Ready");
    expect(container.textContent).not.toContain("quit and reopen Aven");
    expect(desktopSwitch().getAttribute("aria-checked")).toBe("true");
    expect(hasButton("Open Accessibility settings")).toBe(false);
    expect(container.querySelector("details")).toBeNull();
    expect(mocks.permissions).not.toHaveBeenCalled();
    expect(mocks.setEnabled).not.toHaveBeenCalled();
    expect(mocks.requestPermission).not.toHaveBeenCalled();
  });

  it("keeps desktop control off until the user enables it and displays the returned permission state", async () => {
    mocks.status.mockResolvedValue(off);
    mocks.setEnabled.mockResolvedValue(permissionsRequired);
    await render();
    expect(container.textContent).toContain("Off");
    expect(container.textContent).not.toContain("quit and reopen Aven");
    expect(desktopSwitch().getAttribute("aria-checked")).toBe("false");
    expect(hasButton("Allow Screen Recording")).toBe(false);
    expect(mocks.setEnabled).not.toHaveBeenCalled();
    expect(mocks.requestPermission).not.toHaveBeenCalled();

    await act(async () => desktopSwitch().click());
    expect(mocks.setEnabled).toHaveBeenCalledExactlyOnceWith(true);
    expect(mocks.requestPermission).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Permissions needed");
    expect(desktopSwitch().getAttribute("aria-checked")).toBe("true");
    expect(hasButton("Allow Screen Recording")).toBe(true);
    expect(hasButton("Allow Accessibility")).toBe(true);
    expect(container.textContent).toContain("Aven listed by name");
    expect(container.textContent).toContain(
      "quit and reopen Aven after allowing Screen Recording",
    );
  });

  it("turns desktop control off using the native command", async () => {
    mocks.setEnabled.mockResolvedValue(off.desktop);
    await render();
    await act(async () => desktopSwitch().click());
    expect(mocks.setEnabled).toHaveBeenCalledExactlyOnceWith(false);
    expect(desktopSwitch().getAttribute("aria-checked")).toBe("false");
    expect(container.textContent).toContain("Off");
    expect(container.textContent).not.toContain("quit and reopen Aven");
    expect(mocks.requestPermission).not.toHaveBeenCalled();
  });

  it("requests each missing permission explicitly and uses the returned status", async () => {
    mocks.status.mockResolvedValue({ ...ready, desktop: permissionsRequired });
    mocks.requestPermission
      .mockResolvedValueOnce({
        ...permissionsRequired,
        permissions: [
          { name: "Screen Recording", granted: true, required: true },
          { name: "Accessibility", granted: false, required: true },
        ],
      })
      .mockResolvedValueOnce(ready.desktop);
    await render();
    expect(mocks.requestPermission).not.toHaveBeenCalled();
    await click("Allow Screen Recording");
    expect(mocks.requestPermission).toHaveBeenNthCalledWith(
      1,
      "screenRecording",
    );
    expect(hasButton("Allow Screen Recording")).toBe(false);
    expect(hasButton("Open Screen Recording settings")).toBe(false);
    expect(container.textContent).not.toContain("quit and reopen Aven");
    expect(hasButton("Allow Accessibility")).toBe(true);
    expect(container.textContent).toContain("Permissions needed");
    await click("Allow Accessibility");
    expect(mocks.requestPermission).toHaveBeenNthCalledWith(2, "accessibility");
    expect(hasButton("Allow Accessibility")).toBe(false);
    expect(container.textContent).toContain("Ready");
    expect(container.textContent).not.toContain("quit and reopen Aven");
  });

  it("prevents overlapping status and permission requests while enabling", async () => {
    mocks.status.mockResolvedValue(off);
    let resolve!: (status: DesktopControlStatus) => void;
    mocks.setEnabled.mockReturnValue(
      new Promise<DesktopControlStatus>((done) => {
        resolve = done;
      }),
    );
    await render();
    await act(async () => desktopSwitch().click());
    expect(desktopSwitch().disabled).toBe(true);
    expect(button("Check again").disabled).toBe(true);
    expect(desktopSwitch().getAttribute("aria-checked")).toBe("false");
    await act(async () => desktopSwitch().click());
    expect(mocks.setEnabled).toHaveBeenCalledOnce();
    await act(async () => resolve(permissionsRequired));
    expect(desktopSwitch().disabled).toBe(false);
    expect(desktopSwitch().getAttribute("aria-checked")).toBe("true");
  });

  it("retains the confirmed switch state and reports an enable failure", async () => {
    mocks.status.mockResolvedValue(off);
    mocks.setEnabled.mockRejectedValue(
      new Error("Desktop control could not be enabled"),
    );
    await render();
    await act(async () => desktopSwitch().click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "could not be enabled",
    );
    expect(desktopSwitch().getAttribute("aria-checked")).toBe("false");
    expect(desktopSwitch().disabled).toBe(false);
  });

  it("keeps a missing permission visible after a request fails", async () => {
    mocks.status.mockResolvedValue({ ...ready, desktop: permissionsRequired });
    mocks.requestPermission.mockRejectedValue(
      new Error("Could not request access"),
    );
    await render();
    await click("Allow Accessibility");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not request access",
    );
    expect(button("Allow Accessibility").disabled).toBe(false);
    expect(container.textContent).toContain("Permissions needed");
  });

  it("checks permissions again without requesting them", async () => {
    mocks.status.mockResolvedValueOnce({
      ...ready,
      desktop: permissionsRequired,
    });
    await render();
    await click("Check again");
    expect(mocks.status).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Ready");
    expect(container.textContent).not.toContain("quit and reopen Aven");
    expect(mocks.setEnabled).not.toHaveBeenCalled();
    expect(mocks.requestPermission).not.toHaveBeenCalled();
    expect(mocks.permissions).not.toHaveBeenCalled();
  });

  it("refreshes read-only permission status on returning from macOS Settings", async () => {
    mocks.status.mockResolvedValueOnce({
      ...ready,
      desktop: permissionsRequired,
    });
    await render();
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(mocks.status).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Ready");
    expect(hasButton("Allow Accessibility")).toBe(false);
    expect(mocks.requestPermission).not.toHaveBeenCalled();
    expect(mocks.setEnabled).not.toHaveBeenCalled();
    expect(mocks.permissions).not.toHaveBeenCalled();
  });

  it("ignores hidden visibility changes and refreshes when visible again", async () => {
    await render();
    const visibility = vi.spyOn(document, "visibilityState", "get");
    try {
      visibility.mockReturnValue("hidden");
      await act(async () =>
        document.dispatchEvent(new Event("visibilitychange")),
      );
      expect(mocks.status).toHaveBeenCalledTimes(1);
      visibility.mockReturnValue("visible");
      mocks.status.mockResolvedValue({
        ...ready,
        desktop: permissionsRequired,
      });
      await act(async () =>
        document.dispatchEvent(new Event("visibilitychange")),
      );
      expect(mocks.status).toHaveBeenCalledTimes(2);
      expect(container.textContent).toContain("Permissions needed");
    } finally {
      visibility.mockRestore();
    }
  });

  it("discards an older permission read that finishes after a newer one", async () => {
    await render();
    let resolveOld!: (status: AgentToolStatus) => void;
    mocks.status.mockImplementationOnce(
      () =>
        new Promise<AgentToolStatus>((resolve) => {
          resolveOld = resolve;
        }),
    );
    await act(async () => window.dispatchEvent(new Event("focus")));
    await act(async () => window.dispatchEvent(new Event("focus")));
    await act(async () => resolveOld(off));
    expect(container.textContent).toContain("Ready");
    expect(desktopSwitch().getAttribute("aria-checked")).toBe("true");
  });

  it("defers focus refresh until an in-flight permission action finishes", async () => {
    mocks.status.mockResolvedValueOnce(off);
    let resolve!: (status: DesktopControlStatus) => void;
    mocks.setEnabled.mockReturnValue(
      new Promise<DesktopControlStatus>((done) => {
        resolve = done;
      }),
    );
    await render();
    await act(async () => desktopSwitch().click());
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(mocks.status).toHaveBeenCalledTimes(1);
    expect(desktopSwitch().disabled).toBe(true);
    await act(async () => resolve(ready.desktop));
    expect(mocks.status).toHaveBeenCalledTimes(2);
    expect(desktopSwitch().disabled).toBe(false);
    expect(desktopSwitch().getAttribute("aria-checked")).toBe("true");
    expect(mocks.setEnabled).toHaveBeenCalledExactlyOnceWith(true);
    expect(mocks.requestPermission).not.toHaveBeenCalled();
  });

  it("disables the switch when native desktop control is unsupported", async () => {
    mocks.status.mockResolvedValue({
      browserAvailable: false,
      desktop: { state: "unsupported", enabled: false, permissions: [] },
    });
    await render();
    expect(desktopSwitch().disabled).toBe(true);
    expect(desktopSwitch().getAttribute("aria-checked")).toBe("false");
    expect(container.textContent).toContain("Unsupported");
    expect(container.textContent).toContain("requires the Aven app on macOS");
    await act(async () => desktopSwitch().click());
    expect(mocks.setEnabled).not.toHaveBeenCalled();
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
    expect(dialog.textContent).toContain(
      '--aven-desktop \'{"action":"status"}\'',
    );
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

  it("keeps a skill document's consecutive lines on their own lines", async () => {
    mocks.readTextFile.mockResolvedValue(
      "---\nname: review\n---\nFirst step\nSecond step",
    );
    await render();
    await click("/review-changes");
    expect(
      document.querySelector('[aria-label="Skill instructions"] p')?.innerHTML,
    ).toBe("First step<br>Second step");
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
    await click("Check again");
    expect(container.textContent).toContain("Tools could not be checked");
    expect(container.textContent).not.toContain("Ready");
    expect(desktopSwitch().disabled).toBe(true);
    expect(button("/review-changes").disabled).toBe(false);
  });

  it("offers only the macOS settings that are still missing", async () => {
    mocks.status.mockResolvedValue({
      browserAvailable: true,
      desktop: {
        ...ready.desktop,
        state: "permissionsRequired",
        permissions: [
          { name: "Screen Recording", granted: true, required: true },
          { name: "Accessibility", granted: false, required: true },
        ],
      },
    });
    await render();
    const permissions = container.querySelector(
      '[aria-label="macOS permissions"]',
    )!;
    expect(permissions.querySelector("li")?.textContent).toContain("Granted");
    expect(permissions.textContent).toContain(
      "View windows and take screenshots",
    );
    expect(hasButton("Allow Accessibility")).toBe(true);
    expect(hasButton("Open Screen Recording settings")).toBe(false);
    expect(container.textContent).not.toContain("quit and reopen Aven");
    await click("Open Accessibility settings");
    expect(mocks.permissions).toHaveBeenCalledExactlyOnceWith("accessibility");
  });

  it("filters skills by where they come from", async () => {
    mocks.listSkills.mockResolvedValue([
      file,
      {
        ...file,
        name: "mine",
        scope: "user",
        path: "/home/.agents/skills/mine/SKILL.md",
      },
    ]);
    await render();
    expect(hasButton("/review-changes")).toBe(true);
    await click("Personal 1");
    expect(hasButton("/mine")).toBe(true);
    expect(hasButton("/review-changes")).toBe(false);
    await click("Project 1");
    expect(hasButton("/review-changes")).toBe(true);
    expect(hasButton("/mine")).toBe(false);
  });

  it("renders a large catalog a page at a time and restarts paging on search", async () => {
    mocks.listSkills.mockResolvedValue(
      Array.from({ length: 450 }, (_, index) => ({
        ...file,
        name: `bulk-${String(index).padStart(4, "0")}`,
        path: `/repo/.agents/skills/bulk-${index}/SKILL.md`,
      })),
    );
    await render();
    const rows = () => container.querySelectorAll(".skills-item").length;
    expect(rows()).toBe(200);
    expect(container.textContent).toMatch(/Showing 200 of 45\d skills/);
    await click("Show 200 more");
    expect(rows()).toBe(400);

    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="Find a skill"]',
    )!;
    const search = (value: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    await search("bulk-044");
    expect(rows()).toBe(10);
    expect(hasButton("more")).toBe(false);
    await search("");
    expect(rows()).toBe(200);
    await click("Project 450");
    expect(rows()).toBe(200);
    await click("Show 200 more");
    await click("Show 50 more");
    expect(rows()).toBe(450);
    expect(hasButton("more")).toBe(false);
  });

  it("returns to all skills when a refreshed catalog no longer has the selected source", async () => {
    await render();
    await click("Project 1");
    expect(hasButton("/review-changes")).toBe(true);
    mocks.listSkills.mockResolvedValue([]);
    await click("Refresh skills");
    const selected = container.querySelector(
      '[aria-label="Skill source"] [aria-checked="true"]',
    )!;
    expect(selected.textContent).toMatch(/^All /);
    expect(hasButton("/aven-computer-use")).toBe(true);
    expect(container.textContent).not.toContain("No skills match");
  });

  it("moves source selection and keyboard focus together", async () => {
    await render();
    const group = container.querySelector('[aria-label="Skill source"]')!;
    const radios = [
      ...group.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    ];
    expect(radios.map((radio) => radio.tabIndex)).toEqual([0, -1, -1]);
    await act(async () => {
      radios[0].focus();
      radios[0].dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(radios[1]);
    expect(radios[1].getAttribute("aria-checked")).toBe("true");
    expect(radios.map((radio) => radio.tabIndex)).toEqual([-1, 0, -1]);
    expect(hasButton("/review-changes")).toBe(true);
    expect(hasButton("/aven-computer-use")).toBe(false);
  });

  it.each(["off", "permissionsRequired", "unsupported"] as const)(
    "does not present %s as ready",
    async (state) => {
      mocks.status.mockResolvedValue({
        browserAvailable: true,
        desktop: {
          ...ready.desktop,
          state,
          enabled: state === "permissionsRequired",
          permissions: [],
        },
      });
      await render();
      expect(
        container.querySelector('.skills-status[data-state="ready"]')
          ?.textContent,
      ).toBe("Built in");
      expect(container.textContent).not.toContain("Ready");
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

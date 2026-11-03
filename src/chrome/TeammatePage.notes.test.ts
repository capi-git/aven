// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCrew, resetCrewsCache, updateCrew } from "../lib/crews";
import { memoryStorage } from "../lib/devSmoke";
import { resetProjectBotsCache } from "../lib/projectBots";
import { CrewSettingsSheet } from "./CrewSettingsSheet";

const installed = vi.hoisted(() => ({ ids: new Set(["codex", "cursor"]) }));
vi.mock("../lib/harness/availability", async (original) => ({
  ...(await original<typeof import("../lib/harness/availability")>()),
  probeHarnessAvailability: vi.fn(async () => undefined),
  isHarnessAvailable: (id: string) => installed.ids.has(id),
}));

const PATH = "/Users/me/aven-site";
let root: Root;
let container: HTMLElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("localStorage", memoryStorage());
  resetProjectBotsCache();
  resetCrewsCache();
  updateCrew(PATH, (crew) => ({ ...crew, on: true, onAt: 1 }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  resetCrewsCache();
});

async function open(member: string) {
  await act(async () =>
    root.render(
      createElement(CrewSettingsSheet, {
        path: PATH,
        onTurnOn: async () => null,
        onClose: () => {},
        initialPage: member,
      }),
    ),
  );
}

const notes = () =>
  document.querySelector<HTMLTextAreaElement>("[data-crew-member-notes]")!;
const page = () => document.querySelector<HTMLElement>(".teammate")!;

describe("a teammate's Notes", () => {
  it("shows one muted line until it has written any", async () => {
    await open("builder");
    expect(notes().value).toBe("");
    expect(notes().placeholder).toBe(
      "Nothing yet. It writes notes as it works.",
    );
    expect(page().textContent).toContain("Notes");
    expect(page().textContent).not.toContain("Updated");
    expect(document.querySelector("[data-crew-member-notes-clear]")).toBeNull();
  });

  it("shows its notes with when they changed, saves your edits, and clears", async () => {
    const twoHoursAgo = Date.now() - 2 * 60 * 60_000;
    updateCrew(PATH, (crew) => ({
      ...crew,
      members: crew.members.map((member) =>
        member.id === "checker"
          ? { ...member, memory: "- Run npm test", memoryAt: twoHoursAgo }
          : member,
      ),
    }));
    await open("checker");
    expect(notes().value).toBe("- Run npm test");
    expect(page().textContent).toContain("Updated 2h ago");
    await act(async () => {
      // Past React's own value tracking, as a keystroke would.
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(notes(), "- Run npm test\n- Lint too");
      notes().dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      notes().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(
      getCrew(PATH)!.members.find((m) => m.id === "checker"),
    ).toMatchObject({ memory: "- Run npm test\n- Lint too" });
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>("[data-crew-member-notes-clear]")!
        .click(),
    );
    expect(notes().value).toBe("");
    const checker = getCrew(PATH)!.members.find((m) => m.id === "checker")!;
    expect(checker.memory).toBeUndefined();
    expect(checker.memoryAt).toBeUndefined();
  });
});

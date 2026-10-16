// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_WORKSPACE_PROFILES } from "../lib/workspaceProfiles";
import { ProfileSidebarHeader } from "./ProfileSidebarHeader";

describe("library row", () => {
  it("shows Notes, Inbox and Automations as one row of icon buttons named by their labels", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      createElement(ProfileSidebarHeader, {
        profile: DEFAULT_WORKSPACE_PROFILES[0],
        showNotes: true,
        onOpenNotes: vi.fn(),
        showInbox: true,
        onOpenInbox: vi.fn(),
        showAutomations: true,
        onOpenAutomations: vi.fn(),
        notesActive: true,
      }),
    );
    const buttons = [
      ...host.querySelectorAll<HTMLButtonElement>(
        'nav[aria-label="Library"] > button',
      ),
    ];
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Notes",
      "Inbox",
      "Automations",
    ]);
    for (const button of buttons) {
      // The name is the accessible name and leads the tooltip, but only the
      // icon is drawn.
      const name = button.textContent!;
      expect(button.title.startsWith(`${name}:`)).toBe(true);
      expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
        "true",
      );
      expect(button.querySelector("span")?.className).toBe("sr-only");
    }
    expect(buttons[0].getAttribute("aria-current")).toBe("page");
  });
});

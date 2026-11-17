// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GettingStartedCard } from "../lib/gettingStarted";
import { EmptySession } from "./EmptySession";
import { GettingStartedContext } from "./GettingStarted";

vi.mock("./TerminalGridBackground", () => ({
  TerminalGridBackground: ({ visible }: { visible: boolean }) =>
    createElement("canvas", { "data-visible": String(visible) }),
}));

afterEach(() => vi.unstubAllGlobals());

describe("empty session background", () => {
  it("inherits the workspace surface without branded artwork or an animated canvas", () => {
    const markup = renderToStaticMarkup(
      createElement(EmptySession, { visible: true, cwd: "/work/demo" }),
    );

    expect(markup).not.toContain('class="aven-opening-background"');
    expect(markup).not.toContain("aven-mark.png");
    expect(markup).not.toContain("<canvas");
  });

  it("does not render the arcade over a selected chat background", () => {
    const markup = renderToStaticMarkup(
      createElement(EmptySession, {
        visible: true,
        cwd: "/work/demo",
        hasChatBackground: true,
      }),
    );

    expect(markup).not.toContain("<canvas");
    expect(markup).not.toContain('class="aven-opening-background"');
  });

  it("keeps a standalone heading general and hides its managed folder tooltip", () => {
    const cwd =
      "/Users/test/Library/Application Support/com.capi.monocode.personal/projectless-workspaces/work";
    vi.stubGlobal("localStorage", {
      getItem: (key: string) =>
        key === "monocode.projectlessWorkspaces.v1"
          ? JSON.stringify({ work: cwd })
          : null,
    });
    const markup = renderToStaticMarkup(
      createElement(EmptySession, {
        visible: true,
        cwd,
        hasChatBackground: true,
        composer: createElement("textarea"),
      }),
    );
    expect(markup).toContain("Make room for your next idea.");
    expect(markup).toContain("What would you like to build?");
    expect(markup).not.toContain(cwd);
    expect(markup).not.toContain("in work?");
    expect(markup).not.toContain("title=");
  });

  it("retains the project name and folder tooltip for an ordinary project", () => {
    const markup = renderToStaticMarkup(
      createElement(EmptySession, {
        visible: true,
        cwd: "/projects/demo",
        hasChatBackground: true,
        composer: createElement("textarea"),
      }),
    );
    expect(markup).toContain("Start something in demo.");
    expect(markup).toContain('title="/projects/demo"');
  });

  it("preserves an explicitly enabled arcade and suppresses it for a custom image", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) =>
        key === "monocode.gridArcadeEnabled" ? "1" : null,
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          createElement(EmptySession, { visible: true, cwd: "/projects/demo" }),
        ),
      );
      expect(container.querySelector("canvas")).not.toBeNull();
      expect(container.querySelector(".aven-opening-background")).toBeNull();
      const canvas = container.querySelector("canvas");
      expect(canvas?.dataset.visible).toBe("true");
      await act(async () =>
        root.render(
          createElement(EmptySession, {
            cwd: "/projects/demo",
            visible: false,
          }),
        ),
      );
      expect(container.querySelector("canvas")).toBe(canvas);
      expect(canvas?.dataset.visible).toBe("false");
      await act(async () =>
        root.render(
          createElement(EmptySession, {
            visible: true,
            cwd: "/projects/demo",
            hasChatBackground: true,
          }),
        ),
      );
      expect(container.querySelector("canvas")).toBeNull();
      expect(container.querySelector(".aven-opening-background")).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });
});

describe("the Getting started card", () => {
  const card: GettingStartedCard = {
    steps: [
      { id: "agent", title: "Connect an agent", detail: "Claude", done: true },
      { id: "project", title: "Add a project", detail: "", done: false },
    ],
    next: "project",
    doneCount: 1,
    allDone: false,
  };

  it("shows under a new chat's message box while it is offered", async () => {
    const onStart = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          createElement(
            GettingStartedContext.Provider,
            { value: { card, onStart, onHide: vi.fn() } },
            createElement(EmptySession, {
              visible: true,
              cwd: "/projects/demo",
              hasChatBackground: true,
              composer: createElement("textarea"),
            }),
          ),
        ),
      );
      const section = host.querySelector(
        ".empty-session-composer + .empty-session-getting-started .getting-started",
      );
      expect(section?.textContent).toContain("Getting started");
      await act(async () =>
        host
          .querySelector<HTMLButtonElement>(
            'button[aria-label="Start: Add a project"]',
          )!
          .click(),
      );
      expect(onStart).toHaveBeenCalledWith("project");
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it("stays out of a screen without a message box and when not offered", () => {
    const withCard = (composer: boolean, offered: boolean) =>
      renderToStaticMarkup(
        createElement(
          GettingStartedContext.Provider,
          {
            value: offered ? { card, onStart: vi.fn(), onHide: vi.fn() } : null,
          },
          createElement(EmptySession, {
            visible: true,
            cwd: "/projects/demo",
            hasChatBackground: true,
            composer: composer ? createElement("textarea") : undefined,
          }),
        ),
      );
    expect(withCard(false, true)).not.toContain("getting-started");
    expect(withCard(true, false)).not.toContain("getting-started");
  });
});

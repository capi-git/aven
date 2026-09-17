// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmptySession } from "./EmptySession";

vi.mock("./TerminalGridBackground", () => ({
  TerminalGridBackground: () => createElement("canvas"),
}));

afterEach(() => vi.unstubAllGlobals());

describe("empty session background", () => {
  it("inherits the workspace surface without branded artwork or an animated canvas", () => {
    const markup = renderToStaticMarkup(
      createElement(EmptySession, { cwd: "/work/demo" }),
    );

    expect(markup).not.toContain('class="aven-opening-background"');
    expect(markup).not.toContain("aven-mark.png");
    expect(markup).not.toContain("<canvas");
  });

  it("does not render the arcade over a selected chat background", () => {
    const markup = renderToStaticMarkup(
      createElement(EmptySession, {
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
        root.render(createElement(EmptySession, { cwd: "/projects/demo" })),
      );
      expect(container.querySelector("canvas")).not.toBeNull();
      expect(container.querySelector(".aven-opening-background")).toBeNull();
      await act(async () =>
        root.render(
          createElement(EmptySession, {
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

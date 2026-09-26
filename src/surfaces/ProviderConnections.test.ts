// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
const claude = vi.hoisted(() => vi.fn());
const codex = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke,
}));
vi.mock("../lib/harness/providerConnections", () => ({
  listClaudeConnections: claude,
  listCodexConnections: codex,
}));

import {
  ProviderConnectionSection,
  ProviderConnections,
} from "./ProviderConnections";

const render = (
  inventory: Parameters<typeof ProviderConnectionSection>[0]["inventory"],
) =>
  renderToStaticMarkup(
    createElement(ProviderConnectionSection, {
      label: "Claude",
      manage: "Use /mcp.",
      inventory,
    }),
  );

describe("provider connection section", () => {
  it("lists connections with their state, source, tools and failure reason", () => {
    const html = render({
      status: "loaded",
      connections: [
        { name: "Gmail", key: "claude.ai Gmail", state: "needs-sign-in", source: "claude.ai" },
        { name: "scape", key: "scape", state: "failed", source: "Personal", detail: "ENOENT: no such file" },
        { name: "Vercel", key: "claude.ai Vercel", state: "ready", source: "claude.ai", toolCount: 245 },
        { name: "one", key: "one", state: "ready", toolCount: 1 },
      ],
    });
    expect(html).toContain("<h3>Claude</h3>");
    expect(html).toContain("2 need attention");
    expect(html).toContain("Needs sign-in");
    expect(html).toContain("ENOENT: no such file");
    expect(html).toContain("Connected · 245 tools");
    expect(html).toContain("Connected · 1 tool<");
    expect(html).toContain("· claude.ai");
  });

  it("reports loading, empty, healthy and error states", () => {
    expect(render({ status: "loading" })).toContain("Checking…");
    expect(render({ status: "loaded", connections: [] })).toContain("None set up");
    expect(
      render({ status: "loaded", connections: [{ name: "a", key: "a", state: "ready", toolCount: 3 }] }),
    ).toContain("1 available");
    const error = render({ status: "error", message: "Claude Code stopped" });
    expect(error).toContain("Could not check");
    expect(error).toContain("couldn’t start Claude");
    expect(error).toContain('role="alert"');
  });
});

describe("managing MCP servers", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    invoke.mockReset().mockResolvedValue("");
    claude.mockReset().mockResolvedValue([
      { name: "Gmail", key: "claude.ai Gmail", state: "needs-sign-in", source: "claude.ai", canSignIn: true },
      { name: "scape", key: "scape", state: "failed", source: "Personal", scope: "user", removable: true },
    ]);
    codex.mockReset().mockResolvedValue([
      { name: "ChatGPT apps", key: "codex_apps", state: "ready", toolCount: 2 },
    ]);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const button = (text: string) =>
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (element) =>
        element.textContent === text || element.getAttribute("aria-label") === text,
    )!;
  const click = (element: HTMLElement) => act(async () => element.click());
  const type = async (placeholder: string, value: string) => {
    const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      `[placeholder^="${placeholder}"]`,
    )!;
    await act(async () => {
      const proto =
        field instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const mount = () =>
    act(async () =>
      root.render(createElement(ProviderConnections, { cwd: `/tmp/p-${Math.random()}` })),
    );

  it("signs in and removes through the provider, then checks again", async () => {
    await mount();
    expect(container.textContent).toContain("scape");
    expect(button("Remove ChatGPT apps")).toBeUndefined();

    await click(button("Sign in"));
    expect(invoke).toHaveBeenCalledWith("provider_mcp", {
      request: { action: "login", provider: "claude", name: "claude.ai Gmail" },
      cwd: expect.stringContaining("/tmp/p-"),
    });
    expect(container.textContent).toContain("Signed in to Gmail.");

    await click(button("Remove scape"));
    expect(invoke).toHaveBeenCalledTimes(1);
    await click(button("Remove"));
    expect(invoke).toHaveBeenLastCalledWith("provider_mcp", {
      request: { action: "remove", provider: "claude", name: "scape", scope: "user" },
      cwd: expect.any(String),
    });
    expect(claude.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("adds one server to both providers with each one's settings", async () => {
    await mount();
    await click(button("Add server"));
    await type("github", "acme");
    await type("npx", "npx");
    await type("-y", "-y @acme/mcp");
    await type("GITHUB_TOKEN", "ACME_KEY=secret");
    const form = container.querySelector("form")!;
    await act(async () => form.requestSubmit());
    expect(invoke.mock.calls.map(([, args]) => args.request)).toEqual([
      {
        action: "add",
        provider: "claude",
        name: "acme",
        scope: "user",
        server: { type: "stdio", command: "npx", args: ["-y", "@acme/mcp"], env: { ACME_KEY: "secret" } },
      },
      {
        action: "add",
        provider: "codex",
        name: "acme",
        server: { type: "stdio", command: "npx", args: ["-y", "@acme/mcp"], env: { ACME_KEY: "secret" } },
      },
    ]);
    expect(container.textContent).toContain("Added acme to Claude and Codex.");
    expect(container.querySelector("form")).toBeNull();
  });

  it("explains a failure without closing the form", async () => {
    invoke.mockRejectedValueOnce(new Error("MCP server acme already exists"));
    await mount();
    await click(button("Add server"));
    await type("github", "acme");
    await type("npx", "npx");
    await act(async () => container.querySelector("form")!.requestSubmit());
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Claude couldn’t add it: MCP server acme already exists",
    );
    expect(container.querySelector("form")).not.toBeNull();
  });

  it("checks names before running anything", async () => {
    await mount();
    await click(button("Add server"));
    await type("github", "has space");
    await act(async () => container.querySelector("form")!.requestSubmit());
    expect(invoke).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Use letters, numbers");
  });
});

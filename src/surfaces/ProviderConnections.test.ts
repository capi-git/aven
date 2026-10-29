// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConnection } from "../lib/harness/providerConnections";

const invoke = vi.hoisted(() => vi.fn());
const claude = vi.hoisted(() => vi.fn());
const codex = vi.hoisted(() => vi.fn());
const setClaude = vi.hoisted(() => vi.fn());
const setCodex = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke,
}));
vi.mock("../lib/harness/providerConnections", async (original) => ({
  ...(await original<typeof import("../lib/harness/providerConnections")>()),
  listClaudeConnections: claude,
  listCodexConnections: codex,
  setClaudeServerEnabled: setClaude,
  setCodexServerEnabled: setCodex,
}));

import { ProviderConnections } from "./ProviderConnections";

const SCAPE =
  "ENOENT: no such file or directory, posix_spawn '/x/ScapeMCPServer'";

/** A short version of the user's screenshot, as each agent reports it. */
const CLAUDE_ROWS: ProviderConnection[] = [
  {
    name: "Gmail",
    key: "claude.ai Gmail",
    state: "needs-sign-in",
    source: "claude.ai",
    account: true,
    canSignIn: true,
    canTurnOff: true,
  },
  {
    name: "gmail",
    key: "plugin:design:gmail",
    state: "failed",
    source: "design plugin",
    plugin: "design",
    canTurnOff: true,
    detail: "No URL configured for this server",
  },
  {
    name: "scape",
    key: "scape",
    state: "failed",
    source: "Personal",
    scope: "user",
    removable: true,
    canTurnOff: true,
    detail: SCAPE,
  },
  {
    name: "rea",
    key: "rea",
    state: "ready",
    source: "Personal",
    scope: "user",
    removable: true,
    canTurnOff: true,
    toolCount: 170,
  },
];
const CODEX_ROWS: ProviderConnection[] = [
  {
    name: "ChatGPT apps",
    key: "codex_apps",
    state: "ready",
    source: "ChatGPT",
    account: true,
    toolCount: 2,
  },
  {
    name: "rea",
    key: "rea",
    state: "ready",
    source: "Personal",
    removable: true,
    canTurnOff: true,
    toolCount: 170,
  },
];
const signIns = (count: number): ProviderConnection[] =>
  Array.from({ length: count }, (_, i) => ({
    name: `service${i}`,
    key: `plugin:design:service${i}`,
    state: "needs-sign-in",
    source: "design plugin",
    plugin: "design",
    canSignIn: true,
    canTurnOff: true,
  }));

describe("MCP servers page", () => {
  let container: HTMLDivElement;
  let root: Root;
  let stored: Map<string, string>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    // Some Node versions give tests a working localStorage and some do not.
    stored = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
      removeItem: (key: string) => void stored.delete(key),
    });
    invoke.mockReset().mockResolvedValue("");
    claude.mockReset().mockResolvedValue(structuredClone(CLAUDE_ROWS));
    codex.mockReset().mockResolvedValue(structuredClone(CODEX_ROWS));
    setClaude.mockReset().mockResolvedValue(undefined);
    setCodex.mockReset().mockResolvedValue({});
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
        element.textContent === text ||
        element.getAttribute("aria-label") === text,
    )!;
  const menuItem = (text: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (element) => element.textContent === text,
    )!;
  const click = (element: HTMLElement) => act(async () => element.click());
  const type = async (placeholder: string, value: string) => {
    const field = container.querySelector<
      HTMLInputElement | HTMLTextAreaElement
    >(`[placeholder^="${placeholder}"]`)!;
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
      root.render(
        createElement(ProviderConnections, { cwd: `/tmp/p-${Math.random()}` }),
      ),
    );
  const group = (title: string) =>
    [...container.querySelectorAll<HTMLElement>(".mcp-group")].find((section) =>
      section.querySelector("h2")?.textContent?.startsWith(title),
    );
  const rowNames = (section: HTMLElement | undefined) =>
    [...(section?.querySelectorAll(".mcp-row-name") ?? [])].map(
      (name) => name.textContent,
    );
  const notice = () => container.querySelector(".mcp-notice")?.textContent;

  it("groups servers by what needs doing, naming each one once", async () => {
    await mount();
    expect(rowNames(group("Needs you"))).toEqual(["scape", "Gmail"]);
    expect(rowNames(group("Working"))).toEqual(["ChatGPT apps", "rea"]);
    // No per-agent sections, and the page's own name is not repeated.
    const headings = [...container.querySelectorAll("h2, h3")].map(
      (heading) => heading.textContent,
    );
    expect(headings).toEqual(["Needs you 2", "Working 2"]);
    // One row for rea, with both agents; the plugin's copy folds into Gmail.
    expect(container.textContent).toContain(
      "Personal · Claude · Codex · 170 tools",
    );
    expect(container.textContent).toContain(
      "Claude uses the claude.ai one; the design plugin’s copy has no address.",
    );
    // Plain words up front; the agent's own words only under Details.
    expect(container.textContent).toContain(
      "Scape’s program isn’t on this Mac anymore.",
    );
    expect(container.textContent).not.toContain("ENOENT");
    await click(button("Details"));
    expect(container.querySelector(".mcp-row-details")?.textContent).toBe(
      SCAPE,
    );
    expect(container.textContent).toContain(
      "claude.ai connectors come with your Claude account",
    );
  });

  it("keeps the fix in view on rows that need you, and the rest for the pointer", async () => {
    await mount();
    const row = (name: string) =>
      [...container.querySelectorAll<HTMLElement>(".mcp-row")].find(
        (item) => item.querySelector(".mcp-row-name")?.textContent === name,
      )!;
    expect(row("scape").dataset.pinned).toBe("true");
    expect(row("Gmail").dataset.pinned).toBe("true");
    expect(row("rea").dataset.pinned).toBeUndefined();
    expect(button("Remove scape")).toBeDefined();
    expect(button("Sign in Gmail")).toBeDefined();
    expect(button("Turn off rea")).toBeDefined();
    expect(button("Hide ChatGPT apps")).toBeDefined();
    expect(button("Remove ChatGPT apps")).toBeUndefined();
    expect(button("More for ChatGPT apps")).toBeUndefined();
  });

  it("folds many sign-ins into one line", async () => {
    claude.mockResolvedValue(signIns(5));
    codex.mockResolvedValue([]);
    await mount();
    const fold = container.querySelector<HTMLButtonElement>(".mcp-fold")!;
    expect(fold.textContent).toBe(
      "5 need sign-inservice0, service1, service2 and 2 more",
    );
    expect(container.querySelectorAll(".mcp-row")).toHaveLength(0);
    await click(fold);
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelectorAll(".mcp-row")).toHaveLength(5);
  });

  it("signs in and removes through the provider, then checks again", async () => {
    await mount();
    await click(button("Sign in Gmail"));
    expect(invoke).toHaveBeenCalledWith("provider_mcp", {
      request: { action: "login", provider: "claude", name: "claude.ai Gmail" },
      cwd: expect.stringContaining("/tmp/p-"),
    });
    expect(notice()).toBe("Signed in to Gmail.");

    await click(button("Remove scape"));
    expect(container.textContent).toContain("Remove from Claude (Personal)?");
    expect(invoke).toHaveBeenCalledTimes(1);
    await click(button("Remove"));
    expect(invoke).toHaveBeenLastCalledWith("provider_mcp", {
      request: {
        action: "remove",
        provider: "claude",
        name: "scape",
        scope: "user",
      },
      cwd: expect.any(String),
    });
    expect(notice()).toBe("Removed scape from Claude (Personal).");
    expect(claude.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("turns a server off in every agent that has it, and on again from Turned off", async () => {
    await mount();
    await click(button("Turn off rea"));
    expect(setClaude).toHaveBeenCalledWith(expect.any(String), "rea", false);
    expect(setCodex).toHaveBeenCalledWith(expect.any(String), "rea", false);
    expect(notice()).toBe(
      "Turned off rea in Codex, and for Claude in this project.",
    );

    // The next check reports it off in both.
    const off = (rows: ProviderConnection[]) =>
      rows.map((row) =>
        row.key === "rea"
          ? { ...row, state: "off" as const, toolCount: undefined }
          : row,
      );
    claude.mockResolvedValue(off(structuredClone(CLAUDE_ROWS)));
    codex.mockResolvedValue(off(structuredClone(CODEX_ROWS)));
    await click(button("Check again"));
    expect(rowNames(group("Working"))).toEqual(["ChatGPT apps"]);
    expect(group("Turned off")!.querySelector(".mcp-row")).toBeNull();
    await click(button("Turned off 1"));
    expect(group("Turned off")!.textContent).toContain(
      "Claude turns a server off for one project at a time. Codex turns it off in every project.",
    );
    await click(button("Turn on rea"));
    expect(setClaude).toHaveBeenLastCalledWith(expect.any(String), "rea", true);
    expect(setCodex).toHaveBeenLastCalledWith(expect.any(String), "rea", true);
    expect(notice()).toBe("Turned on rea.");
  });

  it("offers the other actions from the row's menu", async () => {
    await mount();
    await click(button("More for scape"));
    await click(menuItem("Turn off"));
    expect(setClaude).toHaveBeenCalledWith(expect.any(String), "scape", false);
    expect(notice()).toBe("Turned off scape for Claude in this project.");
  });

  it("turns off a plugin's empty copy along with its row", async () => {
    await mount();
    await click(button("More for Gmail"));
    await click(menuItem("Turn off"));
    expect(setClaude.mock.calls.map(([, key, on]) => [key, on])).toEqual([
      ["claude.ai Gmail", false],
      ["plugin:design:gmail", false],
    ]);
    expect(stored.get("aven.mcpHidden")).toBeUndefined();
  });

  it("removes only the broken entry when the same server works in another agent", async () => {
    claude.mockResolvedValue([
      {
        name: "db",
        key: "db",
        state: "failed",
        source: "Personal",
        scope: "user",
        removable: true,
        canTurnOff: true,
        detail: "spawn /old/bin/db-mcp ENOENT",
      },
    ]);
    codex.mockResolvedValue([
      {
        name: "db",
        key: "db",
        state: "ready",
        source: "Personal",
        removable: true,
        canTurnOff: true,
        toolCount: 3,
      },
    ]);
    await mount();
    await click(button("Remove db"));
    expect(container.textContent).toContain("Remove from Claude (Personal)?");
    await click(button("Remove"));
    expect(invoke.mock.calls.map(([, args]) => args.request)).toEqual([
      { action: "remove", provider: "claude", name: "db", scope: "user" },
    ]);
    expect(notice()).toBe("Removed db from Claude (Personal).");
  });

  it("doesn't turn Claude's servers off with no project open, and says why", async () => {
    await act(async () =>
      root.render(createElement(ProviderConnections, { cwd: "" })),
    );
    expect(button("Turn off rea")).toBeDefined();
    await click(button("More for scape"));
    // Claude saves a turn-off per project: with none open it can only hide.
    expect(menuItem("Hide")).toBeDefined();
    expect(menuItem("Turn off")).toBeUndefined();
    await click(menuItem("Hide"));
    expect(setClaude).not.toHaveBeenCalled();
    expect(JSON.parse(stored.get("aven.mcpHidden")!)).toEqual(["claude:scape"]);
    expect(notice()).toBe(
      "Hid scape in Aven. Claude still loads it. Open a project to turn it off for Claude there.",
    );
    // rea also runs in Codex, which turns it off everywhere.
    await click(button("Turn off rea"));
    expect(setCodex).toHaveBeenCalledWith(expect.any(String), "rea", false);
    expect(setClaude).not.toHaveBeenCalled();
    expect(notice()).toBe(
      "Turned off rea in Codex. Claude can’t turn it off here, so Aven hides it there. Open a project to turn it off for Claude there.",
    );
  });

  it("hides what an agent can't turn off, in Aven only, and shows it again", async () => {
    await mount();
    await click(button("Hide ChatGPT apps"));
    expect(JSON.parse(stored.get("aven.mcpHidden")!)).toEqual([
      "codex:codex_apps",
    ]);
    expect(notice()).toBe("Hid ChatGPT apps in Aven. Codex still loads it.");
    expect(rowNames(group("Working"))).toEqual(["rea"]);
    await click(button("Hidden 1"));
    await click(button("Show ChatGPT apps"));
    expect(JSON.parse(stored.get("aven.mcpHidden")!)).toEqual([]);
    expect(rowNames(group("Working"))).toEqual(["ChatGPT apps", "rea"]);
  });

  it("hides a plugin's empty copy in one click", async () => {
    await mount();
    await click(button("Hide copy"));
    expect(JSON.parse(stored.get("aven.mcpHidden")!)).toEqual([
      "claude:plugin:design:gmail",
    ]);
    expect(container.textContent).not.toContain("copy has no address");
    expect(button("Hidden 1")).toBeDefined();
  });

  it("explains an agent it couldn't check, with Details and Check again", async () => {
    claude.mockRejectedValue(
      new Error("Claude Code stopped before it answered"),
    );
    await mount();
    expect(rowNames(group("Needs you"))[0]).toBe("Claude");
    expect(container.textContent).toContain(
      "Aven couldn’t start Claude to check its servers.",
    );
    claude.mockResolvedValue([]);
    await click(button("Check again Claude"));
    expect(claude).toHaveBeenCalledTimes(2);
    expect(codex).toHaveBeenCalledTimes(1);
  });

  it("shows an empty page plainly", async () => {
    claude.mockResolvedValue([]);
    codex.mockResolvedValue([]);
    await mount();
    expect(container.textContent).toContain("No MCP servers yet.");
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
        server: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@acme/mcp"],
          env: { ACME_KEY: "secret" },
        },
      },
      {
        action: "add",
        provider: "codex",
        name: "acme",
        server: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@acme/mcp"],
          env: { ACME_KEY: "secret" },
        },
      },
    ]);
    expect(notice()).toBe("Added acme to Claude and Codex.");
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

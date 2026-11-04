// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProviderNotInstalledError,
  type ProviderConnection,
} from "../lib/harness/providerConnections";

const invoke = vi.hoisted(() => vi.fn());
const claude = vi.hoisted(() => vi.fn());
const codex = vi.hoisted(() => vi.fn());
const setClaude = vi.hoisted(() => vi.fn());
const setCodex = vi.hoisted(() => vi.fn());
const pi = vi.hoisted(() => vi.fn());
const shared = vi.hoisted(() => vi.fn());
const installedApps = vi.hoisted(() => new Set<string>());

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
  listPiConnections: pi,
}));
vi.mock("../lib/mcpShared", async (original) => ({
  ...(await original<typeof import("../lib/mcpShared")>()),
  loadSharedList: shared,
}));
vi.mock("../lib/harness/availability", async (original) => ({
  ...(await original<typeof import("../lib/harness/availability")>()),
  probeHarnessAvailability: async () => undefined,
  isHarnessAvailable: (id: string) => installedApps.has(id),
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
const signedIn = (
  rows: ProviderConnection[],
  key: string,
): ProviderConnection[] =>
  structuredClone(rows).map((row) => {
    if (row.key !== key) return row;
    const { canSignIn: _unused, ...rest } = row;
    return { ...rest, state: "ready", toolCount: 3 };
  });
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
    pi.mockReset().mockRejectedValue(
      new ProviderNotInstalledError("Pi not found."),
    );
    shared.mockReset().mockResolvedValue({ servers: [], own: {} });
    installedApps.clear();
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
  /** The form's own fields, one level below the ready-made servers. */
  const openOwn = async () => {
    await click(button("Add server"));
    await click(button("Add your own"));
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
    expect(button("Sign in to Gmail for Claude")).toBeDefined();
    expect(button("Sign in for Claude")).toBeDefined();
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
    claude.mockResolvedValue(signedIn(CLAUDE_ROWS, "claude.ai Gmail"));
    await click(button("Sign in to Gmail for Claude"));
    expect(invoke).toHaveBeenCalledWith("provider_mcp", {
      request: { action: "login", provider: "claude", name: "claude.ai Gmail" },
      cwd: expect.stringContaining("/tmp/p-"),
    });
    expect(notice()).toBe("Signed in to Gmail for Claude.");
    // The fresh check counts, and the row says what it found.
    expect(rowNames(group("Working"))).toContain("Gmail");

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

  it("names the agent still waiting after one sign-in, and offers it next", async () => {
    const acme: ProviderConnection = {
      name: "acme",
      key: "acme",
      state: "needs-sign-in",
      canSignIn: true,
    };
    claude.mockResolvedValue([acme]);
    codex.mockResolvedValue([acme]);
    await mount();
    claude.mockResolvedValue(signedIn([acme], "acme"));
    await click(button("Sign in to acme for Claude"));
    expect(notice()).toBe(
      "Signed in to acme for Claude. Codex still needs sign-in.",
    );
    expect(rowNames(group("Needs you"))).toEqual(["acme"]);
    expect(container.querySelector(".mcp-row-status")?.textContent).toBe(
      "Needs sign-in",
    );

    codex.mockResolvedValue(signedIn([acme], "acme"));
    await click(button("Sign in to acme for Codex"));
    expect(invoke).toHaveBeenLastCalledWith("provider_mcp", {
      request: { action: "login", provider: "codex", name: "acme" },
      cwd: expect.any(String),
    });
    expect(notice()).toBe("Signed in to acme for Codex.");
    expect(group("Needs you")).toBeUndefined();
  });

  it("doesn't claim a sign-in the provider doesn't agree with", async () => {
    await mount();
    await click(button("Sign in to Gmail for Claude"));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Claude still says Gmail needs sign-in. Try again, or check again in a minute.",
    );
    expect(rowNames(group("Needs you"))).toContain("Gmail");
  });

  it("checks again when a sign-in fails, and keeps secrets out of the notice", async () => {
    invoke.mockRejectedValueOnce("login failed: Bearer abcDEF123456 refused");
    await mount();
    const before = claude.mock.calls.length;
    await click(button("Sign in to Gmail for Claude"));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "login failed: Bearer [hidden] refused",
    );
    expect(claude.mock.calls.length).toBe(before + 1);
  });

  it("gives the next step for a server waiting for approval", async () => {
    claude.mockResolvedValue([
      {
        name: "shared",
        key: "shared",
        state: "failed",
        scope: "project",
        removable: true,
        canTurnOff: true,
        errorCode: "APPROVAL_REQUIRED",
      },
    ]);
    codex.mockResolvedValue([]);
    await mount();
    expect(container.textContent).toContain(
      "In Terminal, run claude in this project, type /mcp and approve it.",
    );
    expect(container.querySelector(".mcp-row-status")?.textContent).toBe(
      "Needs approval",
    );
    expect(button("Check again shared")).toBeDefined();
  });

  it("lists same-named servers with different targets apart", async () => {
    const github = (host: string): ProviderConnection => ({
      name: "github",
      key: "github",
      state: "ready",
      removable: true,
      toolCount: 1,
      target: `https://${host}/mcp`,
      targetLabel: host,
    });
    claude.mockResolvedValue([github("a.example")]);
    codex.mockResolvedValue([github("b.example")]);
    await mount();
    expect(rowNames(group("Working"))).toEqual([
      "github (a.example)",
      "github (b.example)",
    ]);
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

  it("says what changed when one agent turns a server off and the other fails", async () => {
    setCodex.mockRejectedValue(new Error("The file changed. Try again."));
    await mount();
    await click(button("Turn off rea"));
    expect(setClaude).toHaveBeenCalledWith(expect.any(String), "rea", false);
    expect(notice()).toBe(
      "Turned off rea for Claude in this project, but Codex (Personal) failed: The file changed. Try again.",
    );

    // And back on: the same, the other way.
    const off = (rows: ProviderConnection[]) =>
      rows.map((row) =>
        row.key === "rea"
          ? { ...row, state: "off" as const, toolCount: undefined }
          : row,
      );
    claude.mockResolvedValue(off(structuredClone(CLAUDE_ROWS)));
    codex.mockResolvedValue(off(structuredClone(CODEX_ROWS)));
    await click(button("Check again"));
    await click(button("Turned off 1"));
    await click(button("Turn on rea"));
    expect(notice()).toBe(
      "Turned on rea in Claude (Personal), but Codex (Personal) failed: The file changed. Try again.",
    );
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

  it("notes quietly that Codex isn't installed, with no failure to fix", async () => {
    codex.mockRejectedValue(
      new ProviderNotInstalledError("Codex CLI not found."),
    );
    await mount();
    expect(group("Needs you")).not.toBeUndefined();
    expect(rowNames(group("Needs you"))).not.toContain("Codex");
    expect(container.textContent).not.toContain("Aven couldn’t start Codex");
    expect(container.querySelector("[data-mcp-missing]")?.textContent).toBe(
      "Codex isn’t installed.",
    );
    // Claude's servers are listed as before.
    expect(rowNames(group("Working"))).toContain("rea");
  });

  it("adds one server to both providers with each one's settings", async () => {
    await mount();
    await openOwn();
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

  it("offers an agent that isn't installed unticked and greyed out", async () => {
    codex.mockRejectedValue(
      new ProviderNotInstalledError("Codex CLI not found."),
    );
    await mount();
    await openOwn();
    const form = container.querySelector("form")!;
    const target = (label: string) =>
      [...form.querySelectorAll<HTMLLabelElement>(".provider-targets label")]
        .find((item) => item.textContent === label)!
        .querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(target("Claude").checked).toBe(true);
    expect(target("Codex").checked).toBe(false);
    expect(target("Codex").disabled).toBe(true);
    expect(target("Codex").closest("label")!.hasAttribute("data-missing")).toBe(
      true,
    );
    expect(form.querySelector("[data-mcp-missing]")?.textContent).toBe(
      "Codex isn’t installed.",
    );
    // Codex's own settings aren't asked for.
    expect(form.textContent).not.toContain("Codex servers apply");
    await type("github", "acme");
    await type("npx", "npx");
    await act(async () => form.requestSubmit());
    expect(invoke.mock.calls.map(([, args]) => args.request.provider)).toEqual([
      "claude",
    ]);
    expect(notice()).toBe("Added acme to Claude.");
  });

  it("explains a failure without closing the form", async () => {
    invoke.mockRejectedValueOnce(new Error("MCP server acme already exists"));
    await mount();
    await openOwn();
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
    await openOwn();
    await type("github", "has space");
    await act(async () => container.querySelector("form")!.requestSubmit());
    expect(invoke).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Use letters, numbers");
  });

  describe("adding a remote server", () => {
    const openRemote = async () => {
      await mount();
      await openOwn();
      await type("github", "acme");
      await click(button("Remote URL"));
      await type("https://mcp", "https://mcp.example.com/mcp");
    };
    const submit = () =>
      act(async () => container.querySelector("form")!.requestSubmit());

    it("says a browser may open while Codex waits, then finishes on a retry", async () => {
      let finish: (error: string) => void = () => undefined;
      invoke.mockResolvedValueOnce("").mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            finish = reject;
          }),
      );
      await openRemote();
      await submit();
      expect(notice()).toContain("If your browser opens");
      await act(async () => finish("codex took too long and was stopped."));
      const alert = container.querySelector('[role="alert"]')?.textContent;
      expect(alert).toContain("Added to Claude, but Codex failed:");
      expect(alert).toContain("Add server again to finish.");
      // The form is still there, and a retry asks both providers again: the
      // native side skips the Claude entry it already has.
      expect(container.querySelector("form")).not.toBeNull();
      invoke.mockClear();
      invoke.mockResolvedValue("");
      await submit();
      expect(
        invoke.mock.calls.map(([, args]) => args.request.provider),
      ).toEqual(["claude", "codex"]);
      expect(notice()).toBe("Added acme to Claude and Codex.");
      expect(container.querySelector("form")).toBeNull();
    });

    it("doesn't mention a browser when only Claude is adding it", async () => {
      invoke.mockImplementation(() => new Promise(() => undefined));
      await openRemote();
      const codexBox = [
        ...container.querySelectorAll<HTMLLabelElement>(
          ".provider-targets label",
        ),
      ]
        .find((item) => item.textContent === "Codex")!
        .querySelector<HTMLInputElement>("input")!;
      await click(codexBox);
      await submit();
      expect(notice()).toBeUndefined();
    });

    it("hides typed headers until asked, and never hides the placeholder", async () => {
      await openRemote();
      const headers = () =>
        container.querySelector<HTMLTextAreaElement>(
          '[aria-label="Claude headers"]',
        )!;
      expect(headers().dataset.masked).toBeUndefined();
      expect(button("Show Claude headers")).toBeUndefined();
      await type("Optional. Authorization", "Authorization: Bearer fixture");
      expect(headers().dataset.masked).toBe("true");
      await click(button("Show Claude headers"));
      expect(headers().dataset.masked).toBeUndefined();
      await click(button("Hide Claude headers"));
      expect(headers().dataset.masked).toBe("true");
    });

    it("warns about a Codex token variable once one is typed", async () => {
      await openRemote();
      const note = () => container.querySelector("[data-mcp-token-note]");
      expect(note()).toBeNull();
      await type("Optional, e.g.", "ACME_TOKEN");
      expect(note()?.textContent).toContain(
        "this token probably won’t reach Codex",
      );
    });
  });

  describe("ready-made servers", () => {
    it("adds one to every provider in one click, with no keys", async () => {
      await mount();
      await click(button("Add server"));
      await click(button("Notion"));
      expect(invoke.mock.calls.map(([, args]) => args.request)).toEqual([
        {
          action: "add",
          provider: "claude",
          name: "notion",
          scope: "user",
          server: {
            type: "http",
            url: "https://mcp.notion.com/mcp",
            headers: {},
          },
        },
        {
          action: "add",
          provider: "codex",
          name: "notion",
          server: {
            type: "http",
            url: "https://mcp.notion.com/mcp",
            headers: {},
          },
        },
      ]);
      expect(container.querySelector("form")).toBeNull();
    });

    it("lets the same service in again under another account", async () => {
      claude.mockResolvedValue([
        {
          name: "notion",
          key: "notion",
          state: "ready",
          scope: "user",
          removable: true,
          source: "Personal",
        },
      ]);
      codex.mockResolvedValue([]);
      await mount();
      await click(button("Add server"));
      // Already in the list under that name.
      expect(button("Notion")).toBeUndefined();
      await type("Personal or Work", "Work");
      await click(button("Notion"));
      expect(invoke.mock.calls[0]![1].request.name).toBe("notion-work");
      expect(JSON.parse(stored.get("aven.mcpLabels")!)).toEqual({
        "notion-work": "Work",
      });
    });

    it("adds a service only to providers that don't already have it", async () => {
      claude.mockResolvedValue([
        {
          name: "Notion",
          key: "claude.ai Notion",
          state: "ready",
          source: "claude.ai",
          account: true,
          toolCount: 74,
        },
      ]);
      codex.mockResolvedValue([]);
      await mount();
      await click(button("Add server"));
      await click(button("Notion"));
      expect(
        invoke.mock.calls.map(([, args]) => args.request.provider),
      ).toEqual(["codex"]);
    });

    it("opens the form for a service that needs a token", async () => {
      await mount();
      await click(button("Add server"));
      await click(button("GitHub"));
      expect(invoke).not.toHaveBeenCalled();
      expect(container.textContent).toContain("personal access token");
      expect(
        container.querySelector<HTMLInputElement>(
          '[placeholder^="https://mcp"]',
        )!.value,
      ).toBe("https://api.githubcopilot.com/mcp/");
    });

    it("adds to Pi as well when it is installed, without a key", async () => {
      pi.mockResolvedValue([]);
      await mount();
      await click(button("Add server"));
      await click(button("Linear"));
      expect(
        invoke.mock.calls.map(([, args]) => args.request.provider),
      ).toEqual(["claude", "pi", "codex"]);
    });

    it("leaves a typed key off Pi, and says so", async () => {
      pi.mockResolvedValue([]);
      await mount();
      await openOwn();
      await type("github", "acme");
      await type("npx", "npx");
      await type("GITHUB_TOKEN", "ACME_KEY=fixture");
      expect(container.textContent).toContain(
        "Pi won’t get this one: it uses a private key.",
      );
      await act(async () => container.querySelector("form")!.requestSubmit());
      expect(
        invoke.mock.calls.map(([, args]) => args.request.provider),
      ).toEqual(["claude", "codex"]);
    });
  });

  describe("where a row reaches", () => {
    const acme: ProviderConnection = {
      name: "acme",
      key: "acme",
      state: "ready",
      scope: "user",
      removable: true,
      source: "Personal",
    };
    const reach = () =>
      container.querySelector("[data-mcp-reach]")?.textContent ?? null;

    it("says nothing when no other provider is installed", async () => {
      claude.mockResolvedValue([acme]);
      codex.mockResolvedValue([{ ...acme, scope: undefined }]);
      shared.mockResolvedValue({
        servers: [
          { name: "acme", from: "claude", kind: "http", url: "https://a.b/c" },
        ],
        own: {},
      });
      await mount();
      expect(reach()).toBeNull();
    });

    it("names the providers it reaches and the ones it can't", async () => {
      installedApps.add("cursor").add("fx");
      claude.mockResolvedValue([acme]);
      codex.mockResolvedValue([{ ...acme, scope: undefined }]);
      shared.mockResolvedValue({
        servers: [{ name: "acme", from: "claude", withheld: "secret" }],
        own: {},
      });
      await mount();
      expect(reach()).toBe("Not on Cursor and fx: it uses a private key.");
    });

    it("offers to add it to a provider that lacks it, and adds no key", async () => {
      claude.mockResolvedValue([acme]);
      codex.mockResolvedValue([]);
      shared.mockResolvedValue({
        servers: [
          { name: "acme", from: "claude", kind: "http", url: "https://a.b/c" },
        ],
        own: {},
      });
      await mount();
      expect(reach()).toBe("Not on Codex yet.");
      await click(button("More for acme"));
      await click(menuItem("Add to Codex"));
      expect(invoke.mock.calls.at(-1)![1].request).toEqual({
        action: "add",
        provider: "codex",
        name: "acme",
        server: { type: "http", url: "https://a.b/c", headers: {} },
      });
    });

    it("names an account on the row, and keeps it only in Aven", async () => {
      claude.mockResolvedValue([acme]);
      codex.mockResolvedValue([]);
      await mount();
      await click(button("More for acme"));
      await click(menuItem("Name this account"));
      await type("Personal or Work", "Personal");
      await click(button("Save"));
      expect(container.querySelector(".mcp-row-label")?.textContent).toBe(
        "Personal",
      );
      expect(JSON.parse(stored.get("aven.mcpLabels")!)).toEqual({
        acme: "Personal",
      });
      expect(invoke).not.toHaveBeenCalled();
    });
  });

  it("hides typed environment values too", async () => {
    await mount();
    await openOwn();
    await type("GITHUB_TOKEN", "ACME_KEY=fixture");
    expect(
      container.querySelector<HTMLTextAreaElement>(
        '[aria-label="Environment"]',
      )!.dataset.masked,
    ).toBe("true");
  });
});

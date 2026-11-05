// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => false,
}));

import {
  automationConnectionProblem,
  canCheckConnections,
} from "./automationConnections";
import type { ProviderConnection } from "./harness/providerConnections";

const FOLDER = "/work/site";

const server = (
  name: string,
  state: ProviderConnection["state"],
  more: Partial<ProviderConnection> = {},
): ProviderConnection => ({ name, key: name, state, ...more });

const needing = (...connections: string[]) =>
  ({ harness: "claude", connections }) as const;

function check(
  agent: Parameters<typeof automationConnectionProblem>[0],
  connections: ProviderConnection[],
) {
  const list = vi.fn(async () => connections);
  return { list, result: automationConnectionProblem(agent, FOLDER, { list }) };
}

describe("checking an automation's connections before a run", () => {
  it("doesn't ask the provider when the automation names none", async () => {
    for (const agent of [{ harness: "claude" } as const, needing()]) {
      const { list, result } = check(agent, []);
      await expect(result).resolves.toBeNull();
      expect(list).not.toHaveBeenCalled();
    }
  });

  it("asks the automation's own provider, in the folder it runs in", async () => {
    const { list, result } = check(
      { harness: "codex", connections: ["Slack"] },
      [],
    );
    await result;
    expect(list).toHaveBeenCalledWith("codex", FOLDER);
  });

  it("doesn't check a provider it can't list connections for", async () => {
    expect(canCheckConnections("claude")).toBe(true);
    expect(canCheckConnections("codex")).toBe(true);
    expect(canCheckConnections("gemini" as never)).toBe(false);
    const { list, result } = check(
      { harness: "gemini" as never, connections: ["Slack"] },
      [server("Slack", "needs-sign-in")],
    );
    await expect(result).resolves.toBeNull();
    expect(list).not.toHaveBeenCalled();
  });

  it("stops on a connection that is signed out, and says to sign in", async () => {
    const { result } = check(needing("slack"), [
      server("Notion", "ready"),
      server("Slack", "needs-sign-in"),
    ]);
    await expect(result).resolves.toEqual({
      connection: "Slack",
      text: "Slack is signed out. Sign in from Settings, then run this again.",
    });
  });

  it("calls a rejected token signed out, too", async () => {
    const { result } = check(needing("Linear"), [
      server("Linear", "failed", { detail: "HTTP 401 Unauthorized" }),
    ]);
    await expect(result).resolves.toMatchObject({
      text: expect.stringContaining("Linear is signed out."),
    });
  });

  it("stops on a connection that is failing", async () => {
    const { result } = check(needing("local-db"), [
      server("local-db", "failed", { detail: "spawn ENOENT" }),
    ]);
    await expect(result).resolves.toEqual({
      connection: "local-db",
      text: "local-db isn’t working. Fix it in Settings, then run this again.",
    });
  });

  it("finds a connection however its name is written", async () => {
    for (const name of [
      "Google Calendar",
      "google-calendar",
      "googlecalendar",
      "claude.ai Google Calendar",
    ]) {
      const { result } = check(needing(name), [
        server("Google Calendar", "needs-sign-in", {
          key: "claude.ai Google Calendar",
          account: true,
        }),
      ]);
      await expect(result, name).resolves.toMatchObject({
        connection: "Google Calendar",
      });
    }
  });

  it("names the connection as the provider does, not as the list does", async () => {
    const { result } = check(needing("<SLACK>"), [
      server("Slack", "needs-sign-in"),
    ]);
    await expect(result).resolves.toMatchObject({ connection: "Slack" });
  });

  it("is happy with one working copy beside a signed-out one", async () => {
    const { result } = check(needing("Notion"), [
      server("Notion", "ready", { key: "claude.ai Notion", account: true }),
      server("notion", "needs-sign-in", {
        key: "plugin:design:notion",
        plugin: "design",
      }),
    ]);
    await expect(result).resolves.toBeNull();
  });

  it.each([
    ["starting", server("Slack", "starting")],
    ["no tools", server("Slack", "inactive")],
    ["turned off", server("Slack", "off")],
    [
      "slow to answer",
      server("Slack", "failed", { detail: "Connection timed out" }),
    ],
  ])("doesn't stop on a connection that is %s", async (_, connection) => {
    const { result } = check(needing("Slack"), [connection]);
    await expect(result).resolves.toBeNull();
  });

  it("doesn't stop for a connection the provider doesn't list", async () => {
    const { result } = check(needing("Fable"), [server("Slack", "failed")]);
    await expect(result).resolves.toBeNull();
  });

  it("doesn't stop when the provider can't say", async () => {
    const list = vi.fn(async () => {
      throw new Error("no provider");
    });
    await expect(
      automationConnectionProblem(needing("Slack"), FOLDER, { list }),
    ).resolves.toBeNull();
  });

  it("doesn't wait for ever on a provider that doesn't answer", async () => {
    const list = () => new Promise<ProviderConnection[]>(() => {});
    await expect(
      automationConnectionProblem(needing("Slack"), FOLDER, {
        list,
        timeoutMs: 1,
      }),
    ).resolves.toBeNull();
  });
});

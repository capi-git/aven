import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke,
}));

import {
  ProviderNotInstalledError,
  listPiConnections,
  piConnectionsFromList,
} from "./providerConnections";

/** The shape `pi mcp list --json` prints (`list` in Pi's mcp/cli.ts). */
const LIST = JSON.stringify({
  servers: [
    {
      name: "sentry",
      scope: "global",
      source: "/x/mcp.json",
      enabled: true,
      exposure: "codemode",
      transport: "https://mcp.sentry.dev/mcp",
      state: "needs-auth",
      tools: [],
      error: "Sign in",
    },
    {
      name: "files",
      scope: "project",
      enabled: true,
      transport: "npx files",
      state: "connected",
      tools: ["read", "write"],
    },
    { name: "old", scope: "global", enabled: false, state: "disabled" },
  ],
  errors: [],
});

describe("Pi's list of servers", () => {
  it("reads each server's state and who may change it", () => {
    expect(piConnectionsFromList(LIST)).toEqual([
      {
        name: "sentry",
        key: "sentry",
        removable: true,
        source: "Personal",
        canSignIn: true,
        state: "needs-sign-in",
        detail: "Sign in",
      },
      { name: "files", key: "files", state: "ready", toolCount: 2 },
      {
        name: "old",
        key: "old",
        removable: true,
        source: "Personal",
        state: "off",
      },
    ]);
  });

  it("never shows a server's address or command as its name", () => {
    expect(JSON.stringify(piConnectionsFromList(LIST))).not.toContain(
      "mcp.sentry.dev",
    );
  });

  it("treats anything else as no list at all", () => {
    expect(piConnectionsFromList("usage: pi ...")).toBeNull();
    expect(piConnectionsFromList(undefined)).toBeNull();
    expect(piConnectionsFromList("{}")).toBeNull();
  });

  describe("asking Pi", () => {
    beforeEach(() => {
      invoke.mockReset();
    });

    it("uses its list command", async () => {
      invoke.mockResolvedValue(LIST);
      await expect(listPiConnections("/p")).resolves.toHaveLength(3);
      expect(invoke).toHaveBeenCalledWith("provider_mcp", {
        request: { action: "list", provider: "pi" },
        cwd: "/p",
      });
    });

    it("reads a Pi with no such command as not installed", async () => {
      invoke.mockResolvedValue("unknown command");
      await expect(listPiConnections("/q")).rejects.toBeInstanceOf(
        ProviderNotInstalledError,
      );
      invoke.mockRejectedValue(new Error("Pi is not installed."));
      await expect(listPiConnections("/r")).rejects.toBeInstanceOf(
        ProviderNotInstalledError,
      );
    });
  });
});

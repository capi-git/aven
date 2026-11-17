// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FsEntry } from "./fs";
import {
  loadSetupScript,
  plainScriptOutput,
  saveSetupScript,
  scriptShellLine,
  suggestSetupCommand,
} from "./projectScripts";

const entry = (name: string): FsEntry => ({
  name,
  path: `/p/${name}`,
  isDir: false,
  ignored: false,
});

describe("projectScripts", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    });
  });

  it("suggests the install command for the lockfile it finds", () => {
    expect(suggestSetupCommand([entry("package.json")])).toBe("npm install");
    expect(
      suggestSetupCommand([entry("package.json"), entry("pnpm-lock.yaml")]),
    ).toBe("pnpm install");
    expect(suggestSetupCommand([entry("README.md")])).toBe("");
  });

  it("saves one setup command per project and clears it when empty", () => {
    saveSetupScript("/p", "npm install");
    expect(loadSetupScript("/p")).toBe("npm install");
    expect(loadSetupScript("/q")).toBe("");
    saveSetupScript("/p", "  ");
    expect(loadSetupScript("/p")).toBe("");
  });

  it("keeps the last redraw of a progress line and drops colours", () => {
    expect(
      plainScriptOutput("\x1b[32madded\x1b[0m 4\r\n10%\r50%\r100%\r\ndone"),
    ).toBe("added 4\n100%\ndone");
  });

  it("leaves the shell with the command's status", () => {
    expect(scriptShellLine("npm i", false)).toBe("npm i; exit $?\r");
    expect(scriptShellLine("npm i", true)).toBe("npm i; exit $LASTEXITCODE\r");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  spawns: [] as { id: string; args: string[] }[],
  handlers: new Map<string, (line: string) => void>(),
  /** Children whose turns wait until released. */
  held: new Set<string>(),
  release: new Map<string, () => void>(),
}));

function reply(id: string, text: string) {
  const line = transport.handlers.get(id);
  line?.(
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text }] },
    }),
  );
  line?.(JSON.stringify({ type: "result", subtype: "success", result: "" }));
}

vi.mock("./child", () => ({
  resolveClaudeBinary: async () => ({ path: "/fake/claude" }),
  spawnChild: async (id: string, _path: string, args: string[]) => {
    transport.spawns.push({ id, args });
    queueMicrotask(() =>
      transport.handlers.get(id)?.(
        JSON.stringify({ type: "system", subtype: "init" }),
      ),
    );
  },
  killChild: async () => undefined,
  unwatchChild: (id: string) => void transport.handlers.delete(id),
  watchChild: (id: string, line: (line: string) => void) => {
    transport.handlers.set(id, line);
  },
  writeChild: async (id: string) => {
    if (transport.held.has(id)) {
      transport.release.set(id, () => reply(id, "Title"));
      return;
    }
    queueMicrotask(() => reply(id, "## Stack\n- Rust"));
  },
}));

import { runClaudeTextPrompt, stopClaudeTextPrompt } from "./claudeText";

afterEach(async () => {
  await stopClaudeTextPrompt();
  transport.spawns.length = 0;
  transport.handlers.clear();
  transport.held.clear();
  transport.release.clear();
});

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

describe("Claude background text", () => {
  it("runs a text-only call with its own system prompt and no tools", async () => {
    await expect(
      runClaudeTextPrompt({
        cwd: "/home",
        prompt: "Fill the memory",
        profile: { systemPrompt: "Keeper rules", textOnly: true },
      }),
    ).resolves.toBe("## Stack\n- Rust");
    const [{ args }] = transport.spawns;
    expect(option(args, "--system-prompt")).toBe("Keeper rules");
    expect(option(args, "--tools")).toBe("");
    expect(args).toContain("--no-session-persistence");
    expect(args).toContain("--strict-mcp-config");
    expect(args).not.toContain("--permission-prompt-tool");
  });

  it("leaves titles and commit messages on Claude Code's defaults", async () => {
    await runClaudeTextPrompt({ cwd: "/repo", prompt: "Title this" });
    const [{ args }] = transport.spawns;
    expect(args).not.toContain("--system-prompt");
    expect(args).not.toContain("--tools");
  });

  it("never makes a title wait behind a text-only call, or the reverse", async () => {
    transport.held.add("aven-claude-text");
    const title = runClaudeTextPrompt({ cwd: "/repo", prompt: "Title this" });
    await vi.waitFor(() =>
      expect(transport.release.has("aven-claude-text")).toBe(true),
    );
    // The title is still running; the keeper's call finishes anyway.
    await expect(
      runClaudeTextPrompt({
        cwd: "/home",
        prompt: "Fill the memory",
        profile: { systemPrompt: "Keeper rules", textOnly: true },
      }),
    ).resolves.toBe("## Stack\n- Rust");
    transport.release.get("aven-claude-text")!();
    await expect(title).resolves.toBe("Title");
    expect(new Set(transport.spawns.map((spawn) => spawn.id)).size).toBe(2);
  });
});

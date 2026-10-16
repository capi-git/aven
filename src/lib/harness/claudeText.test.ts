import { afterEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  spawns: [] as string[][],
  onLine: undefined as ((line: string) => void) | undefined,
}));

vi.mock("./child", () => ({
  resolveClaudeBinary: async () => ({ path: "/fake/claude" }),
  spawnChild: async (_id: string, _path: string, args: string[]) => {
    transport.spawns.push(args);
    queueMicrotask(() =>
      transport.onLine?.(JSON.stringify({ type: "system", subtype: "init" })),
    );
  },
  killChild: async () => undefined,
  unwatchChild: () => undefined,
  watchChild: (_id: string, line: (line: string) => void) => {
    transport.onLine = line;
  },
  writeChild: async () => {
    queueMicrotask(() => {
      transport.onLine?.(
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "## Stack\n- Rust" }] },
        }),
      );
      transport.onLine?.(
        JSON.stringify({ type: "result", subtype: "success", result: "" }),
      );
    });
  },
}));

import { runClaudeTextPrompt, stopClaudeTextPrompt } from "./claudeText";

afterEach(async () => {
  await stopClaudeTextPrompt();
  transport.spawns.length = 0;
  transport.onLine = undefined;
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
    const [args] = transport.spawns;
    expect(option(args, "--system-prompt")).toBe("Keeper rules");
    expect(option(args, "--tools")).toBe("");
    expect(args).toContain("--no-session-persistence");
    expect(args).toContain("--strict-mcp-config");
    expect(args).not.toContain("--permission-prompt-tool");
  });

  it("leaves titles and commit messages on Claude Code's defaults", async () => {
    await runClaudeTextPrompt({ cwd: "/repo", prompt: "Title this" });
    const [args] = transport.spawns;
    expect(args).not.toContain("--system-prompt");
    expect(args).not.toContain("--tools");
  });
});

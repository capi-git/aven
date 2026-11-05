import { afterEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  spawns: [] as { id: string; args: string[] }[],
  handlers: new Map<string, (line: string) => void>(),
  /** Children whose turns wait until released. */
  held: new Set<string>(),
  release: new Map<string, () => void>(),
  /** Claude Code 2.1 says init only after reading the first message. */
  initOnStart: true,
  /** Children that stream their reply in pieces first. */
  streaming: new Set<string>(),
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
    if (!transport.initOnStart) return;
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
    if (transport.streaming.has(id)) {
      queueMicrotask(() => {
        const line = transport.handlers.get(id);
        for (const text of ["Goal: ", "Add a mic."])
          line?.(
            JSON.stringify({
              type: "stream_event",
              event: { delta: { type: "text_delta", text } },
            }),
          );
        reply(id, "Goal: Add a mic.");
      });
      return;
    }
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
  transport.initOnStart = true;
  transport.streaming.clear();
});

function settingsOf(args: string[]): Record<string, unknown> {
  return JSON.parse(option(args, "--settings") ?? "{}");
}

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

  it("sends the prompt without waiting for an init that only follows it", async () => {
    transport.initOnStart = false;
    vi.useFakeTimers();
    try {
      const title = runClaudeTextPrompt({ cwd: "/repo", prompt: "Title this" });
      // No timer has to run out first.
      await vi.advanceTimersByTimeAsync(0);
      await expect(title).resolves.toBe("## Stack\n- Rust");
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers a quick call without thinking, in a process of its own", async () => {
    transport.held.add("aven-claude-text-only");
    const keeper = runClaudeTextPrompt({
      cwd: "/home",
      prompt: "Fill the memory",
      profile: { systemPrompt: "Keeper rules", textOnly: true },
    });
    await vi.waitFor(() =>
      expect(transport.release.has("aven-claude-text-only")).toBe(true),
    );
    // The keeper is still busy; the brief doesn't wait for it.
    await expect(
      runClaudeTextPrompt({
        cwd: "/home",
        prompt: "Tidy this",
        profile: { systemPrompt: "Brief rules", textOnly: true, quick: true },
      }),
    ).resolves.toBe("## Stack\n- Rust");
    const quick = transport.spawns.find(
      (spawn) => spawn.id === "aven-claude-text-quick",
    )!;
    expect(settingsOf(quick.args)).toMatchObject({
      alwaysThinkingEnabled: false,
      disableAllHooks: true,
    });
    expect(option(quick.args, "--tools")).toBe("");
    const keeperSpawn = transport.spawns.find(
      (spawn) => spawn.id === "aven-claude-text-only",
    )!;
    expect(settingsOf(keeperSpawn.args)).not.toHaveProperty(
      "alwaysThinkingEnabled",
    );
    transport.release.get("aven-claude-text-only")!();
    await keeper;
  });

  it("passes on the text as it streams in", async () => {
    transport.streaming.add("aven-claude-text-quick");
    const seen: string[] = [];
    await expect(
      runClaudeTextPrompt({
        cwd: "/home",
        prompt: "Tidy this",
        profile: { textOnly: true, quick: true },
        onText: (text) => seen.push(text),
      }),
    ).resolves.toBe("Goal: Add a mic.");
    expect(seen).toEqual(["Goal: ", "Goal: Add a mic."]);
  });
});

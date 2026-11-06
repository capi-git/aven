import { homeDir } from "./fs";
import { runClaudeTextPrompt } from "./harness/claudeText";
import { runCodexTextPrompt } from "./harness/codexText";
import type { KeeperModel } from "./memoryKeeperModel";

const TEXT_ONLY_TIMEOUT_MS = 120_000;

/**
 * Instructions ahead of the material, for a provider (Codex) whose helper
 * turns take no separate system prompt.
 */
export function rulesFirst(rules: string, prompt: string): string {
  return `${rules}\n\n---\n\n${prompt}`;
}

export type TextOnlyOptions = {
  /**
   * Someone is waiting for this (Claude only): no extended thinking, and no
   * queueing behind the memory keeper.
   */
  quick?: boolean;
  /** Everything written so far, as it streams in (Claude only). */
  onText?: (text: string) => void;
};

/**
 * One call to the cheapest model Aven can run (`pickKeeperModel`), as text
 * only: no tools, no project folder (it runs from the home folder, so no
 * project instructions load), and for Claude its own system prompt in place
 * of Claude Code's. The memory keeper, a discussion's wrap-up and "Tidy into
 * a brief" use it.
 */
export async function generateTextOnly(
  model: KeeperModel,
  input: { system: string; prompt: string },
  options: TextOnlyOptions = {},
): Promise<string> {
  const cwd = await homeDir();
  if (model.harness === "claude")
    return runClaudeTextPrompt({
      cwd,
      prompt: input.prompt,
      timeoutMs: TEXT_ONLY_TIMEOUT_MS,
      profile: {
        systemPrompt: input.system,
        textOnly: true,
        ...(options.quick ? { quick: true } : {}),
      },
      ...(options.onText ? { onText: options.onText } : {}),
    });
  return runCodexTextPrompt({
    cwd,
    prompt: rulesFirst(input.system, input.prompt),
    timeoutMs: TEXT_ONLY_TIMEOUT_MS,
    textOnly: true,
  });
}

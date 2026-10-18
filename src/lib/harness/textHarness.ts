import { agentNameWithModel, appName } from "../agentNames";
import type { HarnessId } from "../session";
import { isHarnessAvailable } from "./availability";
import { claudeTextModel } from "./claudeText";
import { codexTextModel } from "./codexText";
import type { PrContent } from "../gitText";
import {
  generateHarnessCommitMessage,
  generateHarnessPrContent,
  warmupHarnessText,
} from "./registry";

const TEXT_HARNESSES: HarnessId[] = [
  "claude",
  "cursor",
  "codex",
  "grok",
  "opencode",
];

/** Pick the harness used for titles, commit messages, and PR text. */
export function pickTextHarness(preferred?: HarnessId): HarnessId {
  const ordered =
    preferred && TEXT_HARNESSES.includes(preferred)
      ? [preferred, ...TEXT_HARNESSES.filter((id) => id !== preferred)]
      : TEXT_HARNESSES;
  for (const id of ordered) {
    if (isHarnessAvailable(id)) return id;
  }
  return preferred && TEXT_HARNESSES.includes(preferred) ? preferred : "cursor";
}

/**
 * Who writes titles, commit messages and pull request text, for the
 * interface: "Claude Haiku 4.5", "Codex GPT-5.6 Luna", or the app alone
 * where its small model has no name to show.
 */
export function textModelLabel(preferred?: HarnessId): string {
  const harness = pickTextHarness(preferred);
  const model =
    harness === "claude"
      ? claudeTextModel().name
      : harness === "codex"
        ? codexTextModel().name
        : "";
  return model ? agentNameWithModel({ harness, model }) : appName(harness);
}

export function warmupText(cwd: string, preferred?: HarnessId): Promise<void> {
  return warmupHarnessText(pickTextHarness(preferred), cwd);
}

export function generateCommitMessage(
  cwd: string,
  preferred?: HarnessId,
  signal?: AbortSignal,
): Promise<string> {
  return generateHarnessCommitMessage(pickTextHarness(preferred), cwd, signal);
}

export function generatePrContent(
  cwd: string,
  preferred?: HarnessId,
): Promise<(PrContent & { base: string; head: string }) | null> {
  return generateHarnessPrContent(pickTextHarness(preferred), cwd);
}

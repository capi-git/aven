import {
  isCheckingHarnessAvailability,
  isHarnessAvailable,
} from "./harness/availability";
import { claudeTextModel } from "./harness/claudeText";
import { codexTextModel } from "./harness/codexText";
import type { RateLimitProvider } from "./rateLimits";

/** The model that keeps memories: the cheapest one Aven can run without tools. */
export type KeeperModel = { harness: RateLimitProvider; label: string };

/** "Claude Haiku 4.5", or "Codex · GPT-5.6 Luna" when the name omits the provider. */
function label(provider: string, name: string): string {
  return name.toLowerCase().includes(provider.toLowerCase())
    ? name
    : `${provider} · ${name}`;
}

/** Claude's small model when Claude Code is installed, else Codex's. */
export function pickKeeperModel(
  available: (id: RateLimitProvider) => boolean = isHarnessAvailable,
): KeeperModel | null {
  if (available("claude"))
    return {
      harness: "claude",
      label: label("Claude", claudeTextModel().name),
    };
  if (available("codex"))
    return { harness: "codex", label: label("Codex", codexTextModel().name) };
  return null;
}

/** Aven has yet to learn whether Claude Code or Codex is installed here. */
export function isKeeperModelChecking(
  checking: (id: RateLimitProvider) => boolean = isCheckingHarnessAvailability,
): boolean {
  return checking("claude") || checking("codex");
}

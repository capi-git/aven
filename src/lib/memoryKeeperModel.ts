import { isHarnessAvailable } from "./harness/availability";
import { claudeTextModel } from "./harness/claudeText";
import { codexTextModel } from "./harness/codexText";
import type { RateLimitProvider } from "./rateLimits";

/** The model that keeps memories: the cheapest one Aven can run without tools. */
export type KeeperModel = { harness: RateLimitProvider; label: string };

/** Claude's small model when Claude Code is installed, else Codex's. */
export function pickKeeperModel(
  available: (id: RateLimitProvider) => boolean = isHarnessAvailable,
): KeeperModel | null {
  if (available("claude"))
    return { harness: "claude", label: `Claude · ${claudeTextModel().name}` };
  if (available("codex"))
    return { harness: "codex", label: `Codex · ${codexTextModel().name}` };
  return null;
}

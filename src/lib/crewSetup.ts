import { parseSetup, type TeamSetup } from "./crewHandoff";
import { setupPrompt } from "./crewPrompts";
import { errorText, logError } from "./errors";
import { buildProjectDigest } from "./memoryKeeperDigest";
import { pickKeeperModel, type KeeperModel } from "./memoryKeeperModel";
import { generateTextOnly } from "./textOnlyModel";

/**
 * Describe a project, and the team sets itself up: one call to the
 * cheapest model Aven can run as text only (no tools, no files, no web, no
 * browser; it runs from the home folder, not the project), with your words
 * and a read-only digest of the folder, answered with an `aven-setup`
 * block. Nothing is written and no teammate runs; the proposal is yours to
 * change before Start.
 */

export type TeamSetupDeps = {
  /** The model to ask, or null when none is installed. */
  model: () => KeeperModel | null;
  generate: (
    model: KeeperModel,
    input: { system: string; prompt: string },
  ) => Promise<string>;
  /** A read-only summary of the folder; a failure reads as none. */
  digest: (path: string) => Promise<string>;
  /** How long one proposal may take. */
  timeoutMs: number;
};

export const SETUP_TIMEOUT_MS = 90_000;

export const NATIVE_SETUP_DEPS: TeamSetupDeps = {
  model: () => pickKeeperModel(),
  generate: (model, input) => generateTextOnly(model, input),
  digest: (path) => buildProjectDigest(path),
  timeoutMs: SETUP_TIMEOUT_MS,
};

/** What the sheet says when the model didn't answer, or answered badly. */
export const SETUP_FAILED =
  "Couldn't suggest a team. Pick teammates yourself, or try again.";
/** No model to ask. */
export const SETUP_NO_MODEL =
  "Teams use Claude Code or Codex. Install one, then try again.";

let deps: TeamSetupDeps = NATIVE_SETUP_DEPS;

/** Test seam: how proposals are made; null puts the native way back. */
export function setTeamSetupDeps(next: TeamSetupDeps | null) {
  deps = next ?? NATIVE_SETUP_DEPS;
}

/**
 * Ask once for a team and first ideas from your description. Resolves with
 * the proposal, or with one plain line on why there is none.
 */
export async function proposeTeamSetup(
  path: string,
  description: string,
): Promise<{ setup: TeamSetup } | { error: string }> {
  const words = description.trim();
  if (!words) return { error: "Say what the project is first." };
  const model = deps.model();
  if (!model) return { error: SETUP_NO_MODEL };
  const digest = await deps.digest(path).catch((error) => {
    logError("Team setup digest", error);
    return "";
  });
  const { system, prompt } = setupPrompt({
    project: path,
    description: words,
    digest,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const reply = await Promise.race([
      deps.generate(model, { system, prompt }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("The model took too long to answer.")),
          deps.timeoutMs,
        );
      }),
    ]);
    const setup = parseSetup(reply);
    if (!setup) {
      logError("Team setup", new Error("The reply had no aven-setup block."));
      return { error: SETUP_FAILED };
    }
    return { setup };
  } catch (error) {
    logError("Team setup", error);
    return { error: `${SETUP_FAILED} (${errorText(error)})` };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

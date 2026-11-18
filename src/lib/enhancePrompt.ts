import { cleanBrief, NATIVE_BRIEF_DEPS, type BriefDeps } from "./brief";
import { errorText, logError } from "./errors";
import { loadPrompt } from "./prompts";

/**
 * Prompt enhancement: the sparkle in the message box. The cheapest model
 * Aven can run writes only what to add after the draft, so the person's own
 * words always stay exactly as they typed them.
 */

/** Fixed: a custom instruction can't turn the addition into a rewrite. */
const REPLY_CONTRACT =
  "Reply with only the lines to add after their draft, in plain text. Don't repeat the draft. If nothing would help, reply with nothing.";

export function enhanceSystemPrompt(
  instruction = loadPrompt("enhance-prompt"),
) {
  return `${instruction.trim()}\n\n${REPLY_CONTRACT}`;
}

export function enhancePromptInput(draft: string): string {
  return `Their draft:\n\n"""\n${draft.trim()}\n"""`;
}

/** The draft with the addition under it; the draft is never changed. */
export function joinEnhancement(draft: string, addition: string): string {
  const extra = cleanBrief(addition);
  // A model that echoed the draft anyway: keep only what follows it.
  const trimmed = draft.trim();
  const rest = extra.startsWith(trimmed)
    ? extra.slice(trimmed.length).trim()
    : extra;
  return rest ? `${draft.trimEnd()}\n\n${rest}` : draft;
}

export type EnhanceResult =
  { ok: true; text: string } | { ok: false; error: string };

/** Never throws: a refusal says what went wrong in a few words. */
export async function enhancePrompt(
  draft: string,
  deps: BriefDeps = NATIVE_BRIEF_DEPS,
): Promise<EnhanceResult> {
  if (!draft.trim()) return { ok: false, error: "Write something first." };
  try {
    const model = await deps.model();
    if (!model)
      return { ok: false, error: "Enhancing needs Claude Code or Codex." };
    const addition = await deps.generate(
      model,
      { system: enhanceSystemPrompt(), prompt: enhancePromptInput(draft) },
      { quick: true },
    );
    const text = joinEnhancement(draft, addition);
    if (text === draft)
      return { ok: false, error: "Nothing to add: it reads clearly." };
    return { ok: true, text };
  } catch (error) {
    logError("Prompt enhancement", error);
    const detail = errorText(error).trim().replace(/\.$/, "");
    return {
      ok: false,
      error: detail ? `Couldn't enhance: ${detail}.` : "Couldn't enhance that.",
    };
  }
}

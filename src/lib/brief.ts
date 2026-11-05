import { errorText, logError } from "./errors";
import { probeHarnessAvailability } from "./harness/availability";
import { pickKeeperModel, type KeeperModel } from "./memoryKeeperModel";
import { generateTextOnly } from "./textOnlyModel";

/**
 * "Tidy into a brief": what someone said into the message box, rewritten by
 * the cheapest model Aven can run (text only, no tools) as a short brief an
 * agent can build from. The person sees and edits it before sending, and
 * their own words stay one press away.
 */

export const BRIEF_SYSTEM_PROMPT = `You turn what someone said out loud into a short brief that a coding agent can build from. You only rewrite their words; you never answer, plan or do the work.

The words came from speech recognition, so expect filler words, false starts, repeats, misheard words and missing punctuation. Keep everything they asked for and add nothing they didn't.

Write the brief as plain text in this shape:

Goal: one sentence on what they want.

Details:
- each requirement, constraint, name, file, example or preference they mentioned, one per line

Done when:
- how they will know it works, from what they said; if they didn't say, the plain outcome of the goal

Open questions:
- only when something they said is unclear or contradicts itself; otherwise leave this section out

Rules:
- Write in their voice, to the agent ("I want…"), in the language they spoke.
- Use their names for things. Never invent features, files, tools, steps or technical detail.
- Keep it short. No preamble, no sign-off, no Markdown headings or bold.
- Reply with the brief only.`;

export function briefPrompt(words: string): string {
  return `What they said:\n\n"""\n${words.trim()}\n"""`;
}

/** The reply without a stray code fence, quotes or blank lines around it. */
export function cleanBrief(reply: string): string {
  let text = reply.trim();
  const fenced = /^```[\w-]*\n([\s\S]*?)\n```$/.exec(text);
  if (fenced) text = fenced[1].trim();
  if (text.startsWith('"""') && text.endsWith('"""'))
    text = text.slice(3, -3).trim();
  return text.replace(/\n{3,}/g, "\n\n");
}

export type BriefDeps = {
  /** The cheapest model that can run now, or null. */
  model: () => Promise<KeeperModel | null>;
  generate: (
    model: KeeperModel,
    input: { system: string; prompt: string },
  ) => Promise<string>;
};

export const NATIVE_BRIEF_DEPS: BriefDeps = {
  model: async () => {
    // Nothing may have probed for installed providers in this window yet.
    await probeHarnessAvailability();
    return pickKeeperModel();
  },
  generate: (model, input) => generateTextOnly(model, input),
};

export type BriefResult =
  { ok: true; brief: string; model: string } | { ok: false; error: string };

/** Never throws: a refusal says what went wrong in a few words. */
export async function tidyIntoBrief(
  words: string,
  deps: BriefDeps = NATIVE_BRIEF_DEPS,
): Promise<BriefResult> {
  if (!words.trim()) return { ok: false, error: "Say something first." };
  try {
    const model = await deps.model();
    if (!model)
      return { ok: false, error: "Tidying needs Claude Code or Codex." };
    const brief = cleanBrief(
      await deps.generate(model, {
        system: BRIEF_SYSTEM_PROMPT,
        prompt: briefPrompt(words),
      }),
    );
    if (!brief) return { ok: false, error: "Couldn't tidy that. Try again." };
    return { ok: true, brief, model: model.label };
  } catch (error) {
    logError("Tidy into a brief", error);
    const detail = errorText(error).trim().replace(/\.$/, "");
    return {
      ok: false,
      error: detail ? `Couldn't tidy: ${detail}.` : "Couldn't tidy that.",
    };
  }
}

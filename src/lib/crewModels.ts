import { crewMember, crewMemberApp, type Crew, type CrewMember } from "./crews";
import {
  findModel,
  pickerModelsFor,
  preferredModelId,
  resolveModel,
} from "./models";
import type { HarnessId } from "./session";

/**
 * The Claude model a Checker falls back to when Codex can't be locked down
 * here: a different one from the Builder's, for fresh eyes, or the
 * Builder's own when there is no other.
 */
export function claudeCheckerModel(
  crew: Pick<Crew, "members">,
  models: readonly string[] = pickerModelsFor("claude").map(
    (model) => model.id,
  ),
  preferred: string = preferredModelId("claude"),
): string {
  const builder = crewMember(crew, "builder")?.model ?? preferred;
  return models.find((id) => id && id !== builder) ?? builder;
}

/** The settings that say how hard a model thinks, as models name them. */
const EFFORT_IDS = ["effort", "reasoningEffort", "reasoning"];

/** The model's effort setting: its id and the values it takes, if it has one. */
export function crewEffortSetting(
  harness: HarnessId,
  model: string,
): { id: string; options: { value: string; label: string }[] } | undefined {
  const setting = (resolveModel(harness, model).settings ?? []).find(
    (item) => EFFORT_IDS.includes(item.id) && item.kind === "select",
  );
  return setting
    ? {
        id: setting.id,
        options: setting.options.map((option) => ({
          value: option.value,
          label: option.label,
        })),
      }
    : undefined;
}

/**
 * A crew chat's model and effort for its next turn: the card's own (for a
 * Builder), else the member's, else the app's usual model. A model of
 * another app, or an effort the model doesn't take, is left out: a member
 * always runs on its own app.
 */
export function crewChatModel(input: {
  harness: HarnessId;
  memberModel?: string;
  memberEffort?: string;
  override?: { model?: string; effort?: string };
  preferred: string;
}): { model: string; effort?: { id: string; value: string } } {
  // Another app's model is ignored; one the catalog doesn't know (yet) is
  // passed on as it is, as a chat's own model always was.
  const own = (id: string | undefined) => {
    if (!id) return undefined;
    const known = findModel(id);
    if (!known) return id;
    return known.harness === input.harness ? known.id : undefined;
  };
  const model =
    own(input.override?.model) ?? own(input.memberModel) ?? input.preferred;
  const value = input.override?.effort ?? input.memberEffort;
  const setting = value ? crewEffortSetting(input.harness, model) : undefined;
  return {
    model,
    ...(setting && setting.options.some((option) => option.value === value)
      ? { effort: { id: setting.id, value: value! } }
      : {}),
  };
}

/** The model Avos answers your messages on when you haven't picked one. */
export const AVOS_TALK_MODEL = "claude:sonnet-5";

/**
 * Avos answering a message: on the model you picked for it, or else on a
 * quick one, so a few sentences don't wait on the biggest model. Building
 * is the helpers' work, on their own models. Codex keeps its own model.
 */
export function avosTalkModel(
  member: Pick<CrewMember, "role" | "model" | "harness" | "fallback">,
  known: (id: string) => boolean = (id) => !!findModel(id),
): { model: string } | undefined {
  if (member.role !== "lead" || member.model || member.fallback)
    return undefined;
  if (crewMemberApp(member as CrewMember).harness !== "claude")
    return undefined;
  return known(AVOS_TALK_MODEL) ? { model: AVOS_TALK_MODEL } : undefined;
}

/** How many of a provider's models Avos picks from: its newest. */
const PICKS_SHOWN = 4;

/**
 * What Avos may pick from for the Builder's jobs, when you've let it
 * choose: the Builder's provider's newest models, each with the efforts it
 * takes. None when you picked its model yourself, or there's no Builder.
 */
export function avosPickChoices(
  crew: Pick<Crew, "members">,
  models: (harness: HarnessId) => readonly { id: string }[] = (harness) =>
    pickerModelsFor(harness),
): string | undefined {
  const builder = crewMember(crew as Crew, "builder");
  if (!builder || builder.chosen) return undefined;
  const { harness } = crewMemberApp(builder);
  const listed = models(harness)
    .slice(0, PICKS_SHOWN)
    .map((model) => {
      const effort = crewEffortSetting(harness, model.id);
      return effort?.options.length
        ? `${model.id} (${effort.options.map((option) => option.value).join(", ")})`
        : model.id;
    });
  if (!listed.length) return undefined;
  return [
    "Pick the Builder's model and effort for each card, for how hard it is: a small, clear fix on a lighter model or a low effort; fiddly or large work on the strongest, with more effort. Use only these, by id, with an effort from its list:",
    ...listed.map((line) => `- ${line}`),
  ].join("\n");
}

/**
 * A card's model and effort for its Builder: Avos's pick, while you've let
 * it choose (the Builder isn't `chosen`). An unknown model or effort is
 * dropped again where the chat opens (`crewChatModel`).
 */
export function avosPickOverride(
  builder: Pick<CrewMember, "chosen"> | undefined,
  pick: { model?: string; effort?: string } | undefined,
): { model?: string; effort?: string } | undefined {
  if (!builder || builder.chosen || !pick) return undefined;
  const out = {
    ...(pick.model ? { model: pick.model } : {}),
    ...(pick.effort ? { effort: pick.effort } : {}),
  };
  return out.model || out.effort ? out : undefined;
}

/** Avos's pick in words, as the plan shows it: "Opus 5.5 · High". */
export function pickLabel(
  pick: { model?: string; effort?: string } | undefined,
): string | undefined {
  if (!pick?.model && !pick?.effort) return undefined;
  const model = pick.model ? findModel(pick.model) : undefined;
  const effort =
    pick.effort && model
      ? crewEffortSetting(model.harness, model.id)?.options.find(
          (option) => option.value === pick.effort,
        )?.label
      : undefined;
  return [model?.name, effort ?? pick.effort].filter(Boolean).join(" · ");
}

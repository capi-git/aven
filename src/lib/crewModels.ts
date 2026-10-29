import { crewMember, type Crew } from "./crews";
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

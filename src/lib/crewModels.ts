import { crewMember, type Crew } from "./crews";
import { pickerModelsFor, preferredModelId } from "./models";

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

import { modelsFor } from "./models";
import {
  HARNESS_TITLE,
  sessionDisplayTitle,
  type HarnessId,
  type Session,
} from "./session";

export type SessionModelIdentity = {
  harness: HarnessId;
  model: string;
  /** A legacy live turn has no captured model, so only the picker is known. */
  selected?: true;
};

/** A picker change may describe the next turn while the previous model works. */
export function sessionModelIdentity(
  session: Pick<Session, "harness" | "model" | "busy" | "blocks">,
): SessionModelIdentity {
  if (session.busy) {
    for (let index = session.blocks.length - 1; index >= 0; index--) {
      const block = session.blocks[index];
      // Steered messages are part of the active turn, not a new model launch.
      if (block.role !== "user" || block.startedAt == null) continue;
      if (block.durationMs == null && block.turnModel) return block.turnModel;
      break;
    }
    return { harness: session.harness, model: session.model, selected: true };
  }
  return { harness: session.harness, model: session.model };
}

/** Unknown saved models retain their identity instead of borrowing a default. */
export function sessionModelName({
  harness,
  model,
  selected,
}: SessionModelIdentity): string {
  const id = model.trim();
  const native = id.startsWith(`${harness}:`)
    ? id.slice(harness.length + 1)
    : id;
  const known = modelsFor(harness).find(
    (entry) =>
      entry.id === id ||
      (entry.nativeId ?? entry.id.replace(`${harness}:`, "")) === native,
  );
  const name = known?.name.trim() || native || HARNESS_TITLE[harness];
  return selected ? `Selected: ${name}` : name;
}

/**
 * A saved model id as people read it, wherever a model is named: a name
 * given for it with the work (an orchestration plan's choices), else the
 * catalog's (`sessionModelName`), which keeps an unknown id's own identity
 * rather than borrowing another model's name.
 */
export function modelDisplayName(
  harness: HarnessId,
  model: string,
  named: readonly { harness: HarnessId; model: string; name: string }[] = [],
): string {
  const given = named.find(
    (entry) => entry.harness === harness && entry.model === model,
  )?.name;
  return given?.trim() || sessionModelName({ harness, model });
}

export function sessionModelNames(
  models: readonly SessionModelIdentity[] = [],
): string[] {
  return [...new Set(models.map(sessionModelName))];
}

/** Provider names already have an icon; keep the model-specific part readable. */
function compactModelName(name: string): string {
  const selected = name.startsWith("Selected: ") ? "Selected: " : "";
  const label = name.slice(selected.length);
  const provider = Object.values(HARNESS_TITLE).find((title) =>
    label.startsWith(`${title} `),
  );
  return selected + (provider ? label.slice(provider.length + 1) : label);
}

/** Keep the focused model first; every name remains available in the tooltip. */
export function compactModelNames(names: readonly string[]): string {
  return names.length > 2
    ? `${compactModelName(names[0])} +${names.length - 1} models`
    : names.map(compactModelName).join(" + ");
}

/**
 * `titleOverride` names the pane by role instead of its conversation title,
 * e.g. a race agent's "Provider · Model". The model is shown once, in the
 * composer's agent pill, so an untitled chat is a "New session" here and the
 * model stays in the tooltip.
 */
export function sessionPaneLabel(session: Session, titleOverride?: string) {
  const display = (
    titleOverride ?? sessionDisplayTitle(session.title, session.harness)
  ).trim();
  const title = display === "New session" ? "" : display;
  const model = sessionModelName(sessionModelIdentity(session));
  return {
    headline: title || "New session",
    tooltip:
      title && !title.includes(model) ? `${title} · ${model}` : title || model,
  };
}

/**
 * Names the model a finished or running turn used, only when it is not the
 * chat's current model: "Sonnet 4.5 worked for 4s" after a switch, and plain
 * "Worked for 4s" otherwise. Turns saved before models were captured are
 * left unnamed rather than guessed.
 */
export function turnModelLabel(
  turnModel: SessionModelIdentity | undefined,
  current: SessionModelIdentity,
): string | undefined {
  if (!turnModel?.model.trim()) return undefined;
  const ran = sessionModelName({
    harness: turnModel.harness,
    model: turnModel.model,
  });
  const now = sessionModelName({
    harness: current.harness,
    model: current.model,
  });
  return ran === now ? undefined : ran;
}

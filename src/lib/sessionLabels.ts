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

export function sessionPaneLabel(session: Session) {
  const display = sessionDisplayTitle(session.title, session.harness).trim();
  const title = display === "New session" ? "" : display;
  const model = sessionModelName(sessionModelIdentity(session));
  const compact = compactModelName(model);
  return {
    headline: title || compact,
    model: title && title !== compact ? compact : "",
    tooltip: title && title !== model ? `${title} · ${model}` : title || model,
  };
}

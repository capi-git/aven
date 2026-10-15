import { useState } from "react";
import type { PaletteAgent } from "../lib/commandPalette";
import { refreshHarnessCatalogs } from "../lib/harness/registry";
import { pickerModelsFor } from "../lib/models";
import { RACE_MAX_LANES, RACE_MIN_LANES } from "../lib/race";
import {
  saveRaceAgentChoice,
  saveRaceModelChoice,
  toggleRaceAgent,
} from "../lib/raceAgents";
import { HARNESS_TITLE, type HarnessId } from "../lib/session";
import { HarnessIcon } from "./HarnessIcon";
import { Check, ChevronDown, Race } from "./icons";
import { PanelSection } from "./PanelSection";

export type RaceProps = {
  active: boolean;
  /** Installed agents; the composer's own agent is first. */
  available: readonly PaletteAgent[];
  /** The lanes the next send will race. */
  lanes: readonly PaletteAgent[];
  /** Why Race can't be used right now; disables the switch. */
  disabledReason?: string;
  onActiveChange: (active: boolean) => void;
  /** Model for the first lane (this chat's agent), for this race only. */
  onFirstModelChange?: (model: string) => void;
};

const modelName = (agent: PaletteAgent) =>
  agent.label.split(" · ").slice(1).join(" · ") || agent.model;

/** The provider's models, always including the one this lane uses now. */
function laneModels(agent: PaletteAgent): { id: string; name: string }[] {
  const models = pickerModelsFor(agent.harness);
  return models.some((model) => model.id === agent.model)
    ? models
    : [{ id: agent.model, name: modelName(agent) }, ...models];
}

const saveLanes = (lanes: readonly PaletteAgent[]) =>
  saveRaceAgentChoice(lanes.slice(1).map((lane) => lane.harness));

/**
 * The agent panel's Race section: send the next message to several agents at
 * once, choose which agents race and the model each one uses.
 */
export function RaceOptions({
  active,
  available,
  lanes,
  disabledReason,
  onActiveChange,
  onFirstModelChange,
}: RaceProps) {
  const [picking, setPicking] = useState<HarnessId | null>(null);
  const installed = available.length >= RACE_MIN_LANES;
  const canRace = installed && !disabledReason;
  const reason =
    disabledReason ??
    (installed ? undefined : "Install or enable a second agent to race");
  return (
    <PanelSection title="Race" data-race-options>
      <button
        type="button"
        role="switch"
        aria-checked={active}
        aria-label="Race this message"
        disabled={!canRace}
        title={
          reason ?? "Send this message to several agents, each in its own copy"
        }
        onClick={() => onActiveChange(!active)}
        className="model-control-option agent-switch-row"
      >
        <Race className="size-3.5 shrink-0" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate">
          {active ? `Race ${lanes.length} agents` : "Race this message"}
        </span>
        <span className="agent-switch" aria-hidden="true" />
      </button>
      {reason ? <p className="agent-panel-note">{reason}</p> : null}
      {installed ? (
        <div role="group" aria-label="Racing agents" className="agent-race">
          <p className="agent-panel-note">
            Agents ({RACE_MIN_LANES}–{RACE_MAX_LANES})
          </p>
          {available.map((agent, index) => {
            const title = HARNESS_TITLE[agent.harness];
            const chosen = lanes.some((lane) => lane.harness === agent.harness);
            const locked = index === 0;
            const atLimit = chosen
              ? lanes.length <= RACE_MIN_LANES
              : lanes.length >= RACE_MAX_LANES;
            const expanded = picking === agent.harness;
            const fixedModel = locked && !onFirstModelChange;
            return (
              <div key={agent.harness}>
                <div className="agent-race-lane">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={chosen}
                    disabled={locked || atLimit}
                    title={
                      locked
                        ? "This chat's agent always races"
                        : atLimit
                          ? chosen
                            ? `A race needs at least ${RACE_MIN_LANES} agents`
                            : `A race can have up to ${RACE_MAX_LANES} agents`
                          : undefined
                    }
                    onClick={() => saveLanes(toggleRaceAgent(lanes, agent))}
                    className="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1.5 text-left text-ui-label text-content disabled:cursor-default"
                  >
                    <span
                      className={`grid size-3.5 shrink-0 place-items-center rounded border ${chosen ? "border-content bg-content text-background-base" : "border-content/25"} ${!locked && atLimit ? "opacity-40" : ""}`}
                    >
                      {chosen ? <Check className="size-2.5" /> : null}
                    </span>
                    <HarnessIcon harness={agent.harness} className="size-3.5" />
                    <span className="min-w-0 truncate">{title}</span>
                  </button>
                  <button
                    type="button"
                    aria-haspopup="listbox"
                    aria-expanded={expanded}
                    aria-label={`${title} model: ${modelName(agent)}`}
                    disabled={fixedModel}
                    title={
                      fixedModel
                        ? "Uses this chat's model. Change it in the model list."
                        : `Choose the ${title} model for this race`
                    }
                    onClick={() => {
                      if (expanded) return setPicking(null);
                      setPicking(agent.harness);
                      // Some providers list their models only once asked.
                      void refreshHarnessCatalogs([agent.harness]).catch(
                        () => undefined,
                      );
                    }}
                    className={`flex max-w-28 shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-ui-caption disabled:cursor-default ${
                      expanded
                        ? "bg-content/10 text-content"
                        : "text-content/55 hover:bg-content/10 hover:text-content disabled:hover:bg-transparent disabled:hover:text-content/55"
                    }`}
                  >
                    <span className="min-w-0 truncate">{modelName(agent)}</span>
                    {fixedModel ? null : (
                      <ChevronDown
                        className={`size-3 shrink-0 ${expanded ? "rotate-180" : ""}`}
                        strokeWidth={1.75}
                      />
                    )}
                  </button>
                </div>
                {expanded ? (
                  <div
                    role="listbox"
                    aria-label={`${title} models`}
                    className="mb-1 ml-4 max-h-44 overflow-y-auto border-l border-content/10 pl-1"
                  >
                    {laneModels(agent).map((model) => {
                      const selected = model.id === agent.model;
                      return (
                        <button
                          key={model.id}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => {
                            setPicking(null);
                            if (locked) {
                              onFirstModelChange?.(model.id);
                              return;
                            }
                            saveRaceModelChoice(agent.harness, model.id);
                            // Picking a model also races that agent, if there's room.
                            if (!chosen && !atLimit)
                              saveLanes(toggleRaceAgent(lanes, agent));
                          }}
                          className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-ui-label ${
                            selected
                              ? "bg-content/8 text-content"
                              : "text-content/80 hover:bg-content/5 hover:text-content"
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {model.name}
                          </span>
                          {selected ? (
                            <Check className="size-3 shrink-0" />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
          <p className="agent-panel-note">
            Each agent works in its own copy of the project on a new branch.
            Your files stay untouched until you keep a result. Uses each
            provider’s normal usage.
          </p>
        </div>
      ) : null}
    </PanelSection>
  );
}

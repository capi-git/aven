import { useState } from "react";
import type { PaletteAgent } from "../lib/commandPalette";
import { providerShortName } from "../lib/discussionVoices";
import { refreshHarnessCatalogs } from "../lib/harness/registry";
import { pickerModelsFor } from "../lib/models";
import { RACE_MAX_LANES, RACE_MIN_LANES } from "../lib/race";
import {
  addRaceLane,
  nextRaceAgent,
  raceLaneChoices,
  removeRaceLane,
  replaceRaceLane,
  sameRaceAgent,
  saveRaceLaneChoice,
} from "../lib/raceAgents";
import { raceAgentLabel, raceModelName } from "../lib/raceNames";
import { HARNESS_TITLE } from "../lib/session";
import { HarnessIcon } from "./HarnessIcon";
import { Check, ChevronDown, Plus, X } from "./icons";

export type RaceProps = {
  /** Installed agents, once each; this chat's agent first, on its model. */
  available: readonly PaletteAgent[];
  /** The lanes the next send will race; this chat's agent first. */
  lanes: readonly PaletteAgent[];
  /** Model for the first lane (this chat's agent), for this race only. */
  onFirstModelChange?: (model: string) => void;
};

/** The provider's models, always including the one this lane uses now. */
function laneModels(agent: PaletteAgent): { id: string; name: string }[] {
  const models = pickerModelsFor(agent.harness);
  return models.some((model) => model.id === agent.model)
    ? models
    : [{ id: agent.model, name: raceModelName(agent) }, ...models];
}

const saveLanes = (lanes: readonly PaletteAgent[]) =>
  saveRaceLaneChoice(raceLaneChoices(lanes));

// Some providers list their models only once asked.
const loadModels = (agent: PaletteAgent) =>
  void refreshHarnessCatalogs([agent.harness]).catch(() => undefined);

/**
 * Which agents race, inside the Race chip's dropdown: a row per lane with
 * its model, and a way to add another of any provider, including a second
 * model of one already racing. This chat's agent always races. Lanes never
 * take a role, so their comparison stays fair.
 */
export function RaceOptions({
  available,
  lanes,
  onFirstModelChange,
}: RaceProps) {
  const [picking, setPicking] = useState<number | null>(null);
  const full = lanes.length >= RACE_MAX_LANES;
  return (
    <div data-race-options>
      <p className="px-2.5 pb-1 pt-2 text-ui-micro font-medium uppercase tracking-wide text-content/40">
        Race with ({RACE_MIN_LANES}–{RACE_MAX_LANES} agents)
      </p>
      <div role="group" aria-label="Racing agents" className="px-1 pb-1">
        {lanes.map((lane, index) => {
          const title = HARNESS_TITLE[lane.harness];
          const own = index === 0;
          const expanded = picking === index;
          const fixedModel = own && !onFirstModelChange;
          const removable = !own && lanes.length > RACE_MIN_LANES;
          return (
            <div key={`${lane.harness}:${lane.model}`}>
              <div
                className="flex h-8 min-w-0 items-center gap-2 rounded-md pl-2 pr-0.5 text-ui-body text-content/85 hover:bg-content/5"
                data-race-lane-choice={index}
                data-race-lane-label={lane.label}
              >
                <HarnessIcon
                  harness={lane.harness}
                  className="size-3.5 shrink-0"
                />
                <span className="min-w-0 flex-1 truncate" title={lane.label}>
                  {title}
                </span>
                <button
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={expanded}
                  aria-label={`${title} model: ${raceModelName(lane)}`}
                  disabled={fixedModel}
                  title={
                    fixedModel
                      ? "Uses this chat's model. Change it in the model list."
                      : own
                        ? "Choose this chat's model for this race only"
                        : `Choose the ${title} model for this race`
                  }
                  onClick={() => {
                    if (expanded) return setPicking(null);
                    setPicking(index);
                    loadModels(lane);
                  }}
                  className={`flex max-w-32 shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-ui-caption disabled:cursor-default ${
                    expanded
                      ? "bg-content/10 text-content"
                      : "text-content/55 hover:bg-content/10 hover:text-content disabled:hover:bg-transparent disabled:hover:text-content/55"
                  }`}
                >
                  <span className="min-w-0 truncate">
                    {raceModelName(lane)}
                  </span>
                  {fixedModel ? null : (
                    <ChevronDown
                      className={`size-3 shrink-0 ${expanded ? "rotate-180" : ""}`}
                      strokeWidth={1.75}
                    />
                  )}
                </button>
                {own ? (
                  <span
                    className="grid size-6 shrink-0 place-items-center text-content/35"
                    title="This chat's agent always races"
                  >
                    <Check className="size-3" />
                  </span>
                ) : (
                  <button
                    type="button"
                    aria-label={`Stop racing ${lane.label}`}
                    disabled={!removable}
                    title={
                      removable
                        ? `Leave ${lane.label} out of the race`
                        : `A race needs at least ${RACE_MIN_LANES} agents`
                    }
                    onClick={() => {
                      setPicking(null);
                      saveLanes(removeRaceLane(lanes, index));
                    }}
                    className="grid size-6 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content disabled:opacity-35 disabled:hover:bg-transparent"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
              {expanded ? (
                <div
                  role="listbox"
                  aria-label={`${title} models`}
                  className="mb-1 ml-4 max-h-44 overflow-y-auto overscroll-none border-l border-content/10 pl-1"
                >
                  {laneModels(lane).map((model) => {
                    const agent = {
                      harness: lane.harness,
                      model: model.id,
                      label: raceAgentLabel(lane.harness, model.name),
                    };
                    const selected = model.id === lane.model;
                    // Each lane races a different provider and model.
                    const taken =
                      !selected &&
                      lanes.some((other) => sameRaceAgent(other, agent));
                    return (
                      <button
                        key={model.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        disabled={taken}
                        title={taken ? "Already racing" : undefined}
                        onClick={() => {
                          setPicking(null);
                          if (selected) return;
                          if (own) onFirstModelChange?.(model.id);
                          else saveLanes(replaceRaceLane(lanes, index, agent));
                        }}
                        className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-ui-label disabled:cursor-default disabled:opacity-40 ${
                          selected
                            ? "bg-content/8 text-content"
                            : "text-content/80 hover:bg-content/5 hover:text-content disabled:hover:bg-transparent"
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
      </div>
      <div
        role="group"
        aria-label="Add an agent"
        className="flex flex-wrap items-center gap-1 border-t border-content/10 px-2.5 py-2"
      >
        <span className="mr-1 text-ui-caption text-content/50">Add</span>
        {available.map((agent) => {
          const next = full
            ? undefined
            : nextRaceAgent(available, lanes, agent.harness);
          const title = HARNESS_TITLE[agent.harness];
          return (
            <button
              key={agent.harness}
              type="button"
              data-race-add={agent.harness}
              disabled={!next}
              title={
                next
                  ? `Race ${next.label} too`
                  : full
                    ? `A race can have up to ${RACE_MAX_LANES} agents`
                    : `Every ${title} model is racing already`
              }
              onClick={() => {
                if (!next) return;
                setPicking(null);
                saveLanes(addRaceLane(lanes, next));
              }}
              className="flex h-6 items-center gap-1 rounded-md bg-content/5 px-1.5 text-ui-caption text-content/70 hover:bg-content/10 hover:text-content disabled:opacity-35 disabled:hover:bg-content/5 disabled:hover:text-content/70"
            >
              <Plus className="size-3 shrink-0" />
              <HarnessIcon
                harness={agent.harness}
                className="size-3 shrink-0"
              />
              {providerShortName(agent.harness)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

import { useRef, useState } from "react";
import type { PaletteAgent } from "../lib/commandPalette";
import { pickerModelsFor } from "../lib/models";
import { RACE_MAX_LANES, RACE_MIN_LANES } from "../lib/race";
import {
  saveRaceAgentChoice,
  saveRaceModelChoice,
  toggleRaceAgent,
} from "../lib/raceAgents";
import { HARNESS_TITLE, type HarnessId } from "../lib/session";
import { HarnessIcon } from "./HarnessIcon";
import { Check, ChevronDown, Zap } from "./icons";
import { Popover } from "./Popover";

type Props = {
  active: boolean;
  /** Installed agents; the composer's own agent is first. */
  available: readonly PaletteAgent[];
  /** The lanes the next send will race. */
  lanes: readonly PaletteAgent[];
  /** Why Race can't be used right now; disables the button. */
  disabledReason?: string;
  onActiveChange: (active: boolean) => void;
  onClose?: () => void;
};

const SELF = "[data-race-toggle]";

const modelName = (agent: PaletteAgent) =>
  agent.label.split(" · ").slice(1).join(" · ") || agent.model;

const saveLanes = (lanes: readonly PaletteAgent[]) =>
  saveRaceAgentChoice(lanes.slice(1).map((lane) => lane.harness));

/** Composer control: send the next message to several agents at once. */
export function RaceToggle({
  active,
  available,
  lanes,
  disabledReason,
  onActiveChange,
  onClose,
}: Props) {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState<HarnessId | null>(null);
  const canRace = available.length >= RACE_MIN_LANES && !disabledReason;
  const close = () => {
    setOpen(false);
    setPicking(null);
    onClose?.();
  };
  const label = active ? `Race · ${lanes.length} agents` : "Race";
  return (
    <span data-race-toggle className="contents">
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-pressed={active}
        aria-label={label}
        disabled={!canRace}
        title={
          disabledReason ??
          (canRace
            ? "Send this message to several agents, each in its own copy"
            : "Install or enable a second agent to race")
        }
        onClick={() => (open ? close() : setOpen(true))}
        className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] disabled:pointer-events-none disabled:opacity-40 ${
          active
            ? "bg-content/12 text-content"
            : open
              ? "bg-content/8 text-content/70"
              : "text-content/45 hover:bg-content/8 hover:text-content/70"
        }`}
      >
        <Zap className="size-3.5" strokeWidth={1.75} />
        {active ? <span>{label}</span> : null}
      </button>
      {open ? (
        <Popover
          anchor={button}
          side="top"
          align="start"
          width={320}
          autoFocus
          ignore={SELF}
          onDismiss={close}
          role="dialog"
          aria-label="Race"
          data-race-menu
          tabIndex={-1}
          className="p-1 font-sans"
        >
          <label className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-content hover:bg-content/5">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => onActiveChange(event.target.checked)}
            />
            Race this message
          </label>
          <div className="mx-1 my-1 h-px bg-content/10" />
          <p className="px-2 pb-1 text-[11px] text-content/45">
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
            return (
              <div key={agent.harness}>
                <div className="flex items-center gap-1 rounded-md pr-1 hover:bg-content/5">
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
                    className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-[12px] text-content disabled:cursor-default"
                  >
                    <span
                      className={`grid size-3.5 shrink-0 place-items-center rounded border ${chosen ? "border-content bg-content text-background-base" : "border-content/25"} ${!locked && atLimit ? "opacity-40" : ""}`}
                    >
                      {chosen ? <Check className="size-2.5" /> : null}
                    </span>
                    <HarnessIcon harness={agent.harness} className="size-3.5" />
                    <span className="min-w-0 truncate">{title}</span>
                    {locked ? (
                      <span className="shrink-0 text-[11px] text-content/40">
                        this chat
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    aria-haspopup="listbox"
                    aria-expanded={expanded}
                    aria-label={`${title} model: ${modelName(agent)}`}
                    disabled={locked}
                    title={
                      locked
                        ? "Uses this chat's model. Change it with the model picker."
                        : `Choose the ${title} model`
                    }
                    onClick={() => setPicking(expanded ? null : agent.harness)}
                    className={`flex max-w-40 shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] disabled:cursor-default ${
                      expanded
                        ? "bg-content/10 text-content"
                        : "text-content/55 hover:bg-content/10 hover:text-content disabled:hover:bg-transparent disabled:hover:text-content/55"
                    }`}
                  >
                    <span className="min-w-0 truncate">{modelName(agent)}</span>
                    {locked ? null : (
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
                    className="mb-1 ml-5 max-h-44 overflow-y-auto border-l border-content/10 pl-1"
                  >
                    {pickerModelsFor(agent.harness).map((model) => {
                      const selected = model.id === agent.model;
                      return (
                        <button
                          key={model.id}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => {
                            saveRaceModelChoice(agent.harness, model.id);
                            // Picking a model also races that agent, if there's room.
                            if (!chosen && !atLimit)
                              saveLanes(toggleRaceAgent(lanes, agent));
                            setPicking(null);
                          }}
                          className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] ${
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
          <p className="px-2 pb-1.5 pt-2 text-[11px] leading-4 text-content/45">
            Each agent works in its own copy of the project on a new branch.
            Your files stay untouched until you keep a result. Uses each
            provider’s normal usage.
          </p>
        </Popover>
      ) : null}
    </span>
  );
}

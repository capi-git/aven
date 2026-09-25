import { useRef, useState } from "react";
import type { PaletteAgent } from "../lib/commandPalette";
import { RACE_MAX_LANES, RACE_MIN_LANES } from "../lib/race";
import { saveRaceAgentChoice, toggleRaceAgent } from "../lib/raceAgents";
import { HarnessIcon } from "./HarnessIcon";
import { Check, Zap } from "./icons";
import { Popover } from "./Popover";

type Props = {
  active: boolean;
  /** Installed agents; the composer's own agent is first. */
  available: readonly PaletteAgent[];
  /** The lanes the next send will race. */
  lanes: readonly PaletteAgent[];
  onActiveChange: (active: boolean) => void;
  onClose?: () => void;
};

const SELF = "[data-race-toggle]";

/** Composer control: send the next message to several agents at once. */
export function RaceToggle({
  active,
  available,
  lanes,
  onActiveChange,
  onClose,
}: Props) {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const canRace = available.length >= RACE_MIN_LANES;
  const close = () => {
    setOpen(false);
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
        disabled={!canRace}
        title={
          canRace
            ? "Send this message to several agents, each in its own copy"
            : "Install or enable a second agent to race"
        }
        onClick={() => setOpen((value) => !value)}
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
          width={300}
          autoFocus
          ignore={SELF}
          onDismiss={close}
          role="dialog"
          aria-label="Race"
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
            const chosen = lanes.some((lane) => lane.harness === agent.harness);
            const locked = index === 0;
            return (
              <button
                key={agent.harness}
                type="button"
                disabled={locked}
                role="menuitemcheckbox"
                aria-checked={chosen}
                onClick={() => {
                  const next = toggleRaceAgent(lanes, agent);
                  saveRaceAgentChoice(
                    next.slice(1).map((lane) => lane.harness),
                  );
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-content hover:bg-content/5 disabled:hover:bg-transparent"
              >
                <span
                  className={`grid size-3.5 shrink-0 place-items-center rounded border ${chosen ? "border-content bg-content text-background-base" : "border-content/25"}`}
                >
                  {chosen ? <Check className="size-2.5" /> : null}
                </span>
                <HarnessIcon harness={agent.harness} className="size-3.5" />
                <span className="min-w-0 flex-1 truncate">{agent.label}</span>
                {locked ? (
                  <span className="text-[11px] text-content/40">this chat</span>
                ) : null}
              </button>
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

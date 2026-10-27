import type { KeyboardEvent } from "react";
import { AGENT_ROLES, agentRole, type AgentRoleId } from "../lib/agentRoles";
import { isImeComposition } from "../lib/keyboard";

/**
 * The role an agent was brought in with, as a small badge beside its name.
 * Hovering shows the instruction it was given.
 */
export function RoleBadge({
  role,
  className = "",
}: {
  role: AgentRoleId;
  className?: string;
}) {
  const { name, instruction } = agentRole(role);
  return (
    <span
      className={`inline-flex h-4 shrink-0 items-center rounded-full px-1.5 text-ui-micro font-medium leading-none tracking-wide text-content/70 bg-(--aven-fill-tertiary) ${className}`}
      title={`${name}: ${instruction}`}
      data-agent-role={role}
    >
      {name}
    </span>
  );
}

/**
 * Choose a role for an agent brought into a team, or none. Each choice shows
 * its instruction on hover. As a radio group it is one Tab stop, the chosen
 * role, and ← and → choose the one beside it; a menu it sits in still moves
 * through every choice with ↑ and ↓.
 */
export function RolePicker({
  value,
  onChange,
  label,
  className = "",
}: {
  value: AgentRoleId | undefined;
  onChange: (role: AgentRoleId | undefined) => void;
  /** Names the group for assistive technology. */
  label: string;
  className?: string;
}) {
  const choices: { id: AgentRoleId | undefined; name: string; hint: string }[] =
    [
      {
        id: undefined,
        name: "None",
        hint: "No role: the agent works as it usually does",
      },
      ...AGENT_ROLES.map((role) => ({
        id: role.id,
        name: role.name,
        hint: role.instruction,
      })),
    ];
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (isImeComposition(event.nativeEvent)) return;
    event.preventDefault();
    event.stopPropagation();
    const at = choices.findIndex((choice) => choice.id === value);
    const step = event.key === "ArrowRight" ? 1 : -1;
    const next = (at + step + choices.length) % choices.length;
    onChange(choices[next].id);
    event.currentTarget
      .querySelectorAll<HTMLElement>("[data-role-choice]")
      [next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-role-picker
      className={`flex flex-wrap gap-0.5 ${className}`}
      onKeyDown={onKeyDown}
    >
      {choices.map((choice) => {
        const selected = choice.id === value;
        return (
          <button
            key={choice.id ?? "none"}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            title={choice.hint}
            data-role-choice={choice.id ?? "none"}
            onClick={() => onChange(choice.id)}
            className={`h-6 rounded-md px-1.5 text-ui-caption ${
              selected
                ? "bg-content/15 text-content"
                : "text-content/55 hover:bg-content/10 hover:text-content"
            }`}
          >
            {choice.name}
          </button>
        );
      })}
    </div>
  );
}

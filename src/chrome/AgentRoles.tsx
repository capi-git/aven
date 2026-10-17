import { AGENT_ROLES, agentRole, type AgentRoleId } from "../lib/agentRoles";

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
      className={`inline-flex h-4 shrink-0 items-center rounded px-1 text-ui-micro font-medium leading-none tracking-wide text-content/70 bg-content/10 ${className}`}
      title={`${name}: ${instruction}`}
      data-agent-role={role}
    >
      {name}
    </span>
  );
}

/**
 * Choose a role for an agent brought into a team, or none. Each choice shows
 * its instruction on hover. The menu it sits in moves focus between them.
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
  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-role-picker
      className={`flex flex-wrap gap-0.5 ${className}`}
    >
      {choices.map((choice) => {
        const selected = choice.id === value;
        return (
          <button
            key={choice.id ?? "none"}
            type="button"
            role="radio"
            aria-checked={selected}
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

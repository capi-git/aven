/**
 * Light roles for an agent brought into a team: a discussion's partner, an
 * orchestration task's worker, or the reviewer a race asks for a winner.
 * Each is a short instruction in plain words, shown on hover and added once
 * to that agent's first message for the run, where its transcript shows it.
 * A role is kept on the run's record only; nothing remembers it for the
 * next run, and race lanes never get one, so their comparison stays fair.
 */
export type AgentRoleId = "reviewer" | "tester" | "skeptic" | "designer";

export type AgentRole = {
  id: AgentRoleId;
  name: string;
  /** One or two sentences, addressed to the agent. */
  instruction: string;
};

export const AGENT_ROLES: readonly AgentRole[] = [
  {
    id: "reviewer",
    name: "Reviewer",
    instruction:
      "Review the work carefully: check that it does what was asked, look for bugs and risks, and say plainly what should change.",
  },
  {
    id: "tester",
    name: "Tester",
    instruction:
      "Work out how to prove it works: run or write the checks that matter, and report what passed, what failed and what is still untested.",
  },
  {
    id: "skeptic",
    name: "Skeptic",
    instruction:
      "Push back on weak points and look for what could go wrong; agree only when convinced.",
  },
  {
    id: "designer",
    name: "Designer",
    instruction:
      "Look at it from the user's side: how it looks, reads and feels to use. Suggest concrete changes to layout, wording and flow.",
  },
];

const BY_ID = new Map(AGENT_ROLES.map((role) => [role.id, role]));

export function agentRole(id: AgentRoleId): AgentRole {
  return BY_ID.get(id)!;
}

/** A stored role, or undefined when the value is not one of the four. */
export function readAgentRole(value: unknown): AgentRoleId | undefined {
  return typeof value === "string" && BY_ID.has(value as AgentRoleId)
    ? (value as AgentRoleId)
    : undefined;
}

/**
 * The line an agent's first message for the run starts with, e.g. "Your
 * role in this discussion: Skeptic. Push back on weak points…".
 */
export function roleBrief(id: AgentRoleId, where: string): string {
  const role = agentRole(id);
  return `Your role ${where}: ${role.name}. ${role.instruction}`;
}

/** `text` led by the role's line, or `text` alone without a role. */
export function withRoleBrief(
  text: string,
  id: AgentRoleId | undefined,
  where: string,
): string {
  return id ? `${roleBrief(id, where)}\n\n${text}` : text;
}

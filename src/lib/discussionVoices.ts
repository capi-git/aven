/**
 * A little character for each side of a discussion: a pixel mascot in its
 * provider's colour, the model's name and a short tag for its part.
 */
import type { Discussion, DiscussionSide } from "./discussions";
import { agentRole, type AgentRoleId } from "./agentRoles";
import { agentFullName, agentNameIn, appName } from "./agentNames";
import { PROJECT_MASCOTS } from "./projectMascots";
import type { HarnessId } from "./session";

/**
 * Brand colours of the providers that have one (Claude's coral, Codex's
 * blue, Oh My Pi's violet). The rest have monochrome marks and speak in the
 * theme's own text colour.
 */
export const PROVIDER_VOICE_COLORS: Partial<Record<HarnessId, string>> = {
  claude: "#d97757",
  codex: "#7a9dff",
  omp: "#b18cff",
};

const NEUTRAL_VOICE =
  "color-mix(in srgb, var(--color-content) 78%, transparent)";

export function providerVoiceColor(harness: HarnessId): string {
  return PROVIDER_VOICE_COLORS[harness] ?? NEUTRAL_VOICE;
}

export type DiscussionVoice = {
  side: DiscussionSide;
  sessionId: string;
  harness: HarnessId;
  /** "Claude", or "Claude Sonnet 5" when both sides are Claude. */
  name: string;
  /** "Claude Code · Sonnet 5", for tooltips. */
  fullName: string;
  /** The chat's title. */
  title: string;
  /**
   * What it does in this discussion: it opened the topic, or joined it, led
   * by its role when it was brought in with one ("Skeptic · Joined the
   * topic").
   */
  persona: string;
  /** The role it was brought in with, shown as a badge on its mascot. */
  role?: AgentRoleId;
  /** The mascot sprite it wears (see `projectMascots`). */
  mascot: string;
  /** CSS colour of its mascot and bubbles. */
  color: string;
};

export const DISCUSSION_PERSONAS: Readonly<Record<DiscussionSide, string>> = {
  a: "Opened the topic",
  b: "Joined the topic",
};

/** "Claude", "Codex", "Grok": the provider as people say it. */
export function providerShortName(harness: HarnessId): string {
  return appName(harness);
}

function hash(text: string): number {
  let value = 0;
  for (let index = 0; index < text.length; index += 1)
    value = (value * 131 + text.charCodeAt(index)) >>> 0;
  return value;
}

/**
 * Each chat's mascot, stable for that chat. A chat whose sprite another
 * chat before it already wears steps to the next free one, so a team's
 * members all look different (while there are sprites enough).
 */
export function teamMascots(sessionIds: readonly string[]): string[] {
  const count = PROJECT_MASCOTS.length;
  const used = new Set<number>();
  return sessionIds.map((id) => {
    let index = hash(id) % count;
    while (used.has(index) && used.size < count) index = (index + 1) % count;
    used.add(index);
    return PROJECT_MASCOTS[index].name;
  });
}

/**
 * Each chat's mascot, stable for that chat; the second side steps to the
 * next sprite when both would wear the same one.
 */
export function discussionMascots(
  a: string,
  b: string,
): Record<DiscussionSide, string> {
  const [first, second] = teamMascots([a, b]);
  return { a: first, b: second };
}

/** "Skeptic · Joined the topic": the part, led by the role it was given. */
function personaWith(part: string, role: AgentRoleId | undefined): string {
  if (!role) return part;
  const name = agentRole(role).name;
  return part ? `${name} · ${part}` : name;
}

/**
 * A team member's face, as a discussion side's: its mascot in its
 * provider's colour, named by its label, its state as its part, with the
 * role it was brought in with.
 */
export function memberVoice(
  member: {
    sessionId: string;
    harness: HarnessId;
    label: string;
    fullName?: string;
    title?: string;
    stateLabel: string;
    agentRole?: AgentRoleId;
  },
  mascot: string,
  first = false,
): DiscussionVoice {
  return {
    side: first ? "a" : "b",
    sessionId: member.sessionId,
    harness: member.harness,
    name: member.label,
    fullName: member.fullName ?? member.label,
    title: member.title ?? member.label,
    persona: personaWith(member.stateLabel, member.agentRole),
    ...(member.agentRole ? { role: member.agentRole } : {}),
    mascot,
    color: providerVoiceColor(member.harness),
  };
}

export function discussionVoices(
  discussion: Pick<Discussion, "a" | "b">,
): Record<DiscussionSide, DiscussionVoice> {
  const mascots = discussionMascots(
    discussion.a.sessionId,
    discussion.b.sessionId,
  );
  const voice = (side: DiscussionSide): DiscussionVoice => {
    const party = side === "a" ? discussion.a : discussion.b;
    return {
      side,
      sessionId: party.sessionId,
      harness: party.harness,
      name: agentNameIn(party, [discussion.a, discussion.b]),
      fullName: agentFullName(party),
      title: party.title,
      persona: personaWith(DISCUSSION_PERSONAS[side], party.role),
      ...(party.role ? { role: party.role } : {}),
      mascot: mascots[side],
      color: providerVoiceColor(party.harness),
    };
  };
  return { a: voice("a"), b: voice("b") };
}

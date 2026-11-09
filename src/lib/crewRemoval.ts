import {
  CREW_ROLE_INFO,
  cardBuilder,
  cardChecker,
  crewMemberById,
  crewMemberName,
  memberOn,
  withoutMember,
  type Crew,
  type CrewCard,
  type CrewMember,
  type CrewRole,
} from "./crews";

/** Stages whose work sits in Avos's copy. */
const IN_COPY: ReadonlySet<CrewCard["stage"]> = new Set([
  "building",
  "checking",
  "ready",
  "stuck",
]);

/** Roles Avos always keeps one of: cards are built and checked by them. */
const NEEDED: ReadonlySet<CrewRole> = new Set(["builder", "checker"]);

/** What removing a helper does, or why it stays. */
export type HelperRemoval =
  | { ok: false; title: string; text: string }
  | {
      ok: true;
      /** The card it is working on now: that turn stops and the card waits for you. */
      stops?: CrewCard;
      /** It is busy without a card (a look round, a sweep): that stops. */
      busy: boolean;
      /** What happens to its work, a sentence each, for the confirmation. */
      lines: string[];
    };

/** Whether a helper can be removed, and what happens to its work if it is. */
export function helperRemoval(crew: Crew, id: string): HelperRemoval | null {
  const member = crewMemberById(crew, id);
  if (!member) return null;
  if (member.role === "lead")
    return {
      ok: false,
      title: "Avos stays",
      text: "It looks after this project. Use the switch at the top to turn it off.",
    };
  if (member.role === "fixer")
    return {
      ok: false,
      title: "The Fixer is the project's bot",
      text: "Turn it off in its own settings.",
    };
  if (
    NEEDED.has(member.role) &&
    crew.members.filter((entry) => entry.role === member.role).length <= 1
  ) {
    const label = CREW_ROLE_INFO[member.role].label;
    return {
      ok: false,
      title: `Avos needs a ${label}`,
      text: `Add another ${label} first, or switch this one off.`,
    };
  }
  const stops = member.sessionId
    ? crew.cards.find(
        (card) =>
          card.turn?.sessionId === member.sessionId &&
          card.stage !== "applied" &&
          card.stage !== "discarded",
      )
    : undefined;
  const busy = !stops && !!member.doing;
  const after = withHelperRemoved(crew, id);
  // Its cards, and who takes each now.
  const takers = new Map<string, { member: CrewMember; cards: CrewCard[] }>();
  for (const card of crew.cards) {
    if (card.id === stops?.id) continue;
    if (card.stage === "applied" || card.stage === "discarded") continue;
    if (card.builderId !== id && card.checkerId !== id) continue;
    const next = after.cards.find((entry) => entry.id === card.id) ?? card;
    const to = takerFor(
      after,
      card.builderId === id ? "builder" : "checker",
      next,
    );
    if (!to) continue;
    const entry = takers.get(to.id) ?? { member: to, cards: [] };
    entry.cards.push(card);
    takers.set(to.id, entry);
  }
  const lines: string[] = [];
  if (stops)
    lines.push(`It stops work on “${stops.title}”, which waits for you.`);
  else if (busy) lines.push("What it's doing now stops.");
  for (const { member: to, cards } of takers.values()) {
    const name = crewMemberName(after, to.id);
    const what =
      cards.length === 1
        ? `“${cards[0]!.title}” goes`
        : `Its ${cards.length} cards go`;
    lines.push(
      memberOn(to)
        ? `${what} to ${name}.`
        : `${what} to ${name}, which is off.`,
    );
  }
  lines.push("Its chat stays in your history.");
  return { ok: true, ...(stops ? { stops } : {}), busy, lines };
}

/**
 * The crew without the helper. A card in Avos's copy that was given to it
 * goes to whoever takes its work now (by your rules, else another of its
 * role), so the card keeps a Builder and Checker of its own.
 */
export function withHelperRemoved(crew: Crew, id: string): Crew {
  const member = crewMemberById(crew, id);
  if (!member) return crew;
  const next = withoutMember(crew, id);
  return {
    ...next,
    cards: next.cards.map((card) => {
      const was = crew.cards.find((entry) => entry.id === card.id);
      if (!was || !IN_COPY.has(card.stage)) return card;
      if (was.builderId === id) {
        const to = takerFor(next, "builder", card);
        return to ? { ...card, builderId: to.id } : card;
      }
      if (was.checkerId === id) {
        const to = takerFor(next, "checker", card);
        return to ? { ...card, checkerId: to.id } : card;
      }
      return card;
    }),
  };
}

/** Who takes a card now: by your rules, else another of the role, on or off. */
function takerFor(
  crew: Crew,
  role: "builder" | "checker",
  card: CrewCard,
): CrewMember | undefined {
  return (
    (role === "builder" ? cardBuilder(crew, card) : cardChecker(crew, card)) ??
    crew.members.find((entry) => entry.role === role)
  );
}

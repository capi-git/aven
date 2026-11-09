import {
  cardBuilder,
  crewMemberName,
  isTime,
  type Crew,
  type CrewCard,
} from "./crews";

/** A helper's question that waits on your answer, on its card. */
export type WaitingQuestion = {
  /** This question: its card and when it asked, as a card can ask again. */
  key: string;
  cardId: string;
  /** The card's title, shown on the box's tag. */
  title: string;
  /** Who asked: the helper working the card. */
  who: string;
  /** When it stopped to ask. */
  at: number;
};

/** The questions that wait on you, oldest first. */
export function waitingQuestions(
  crew: Crew,
  name: (who: string) => string = (who) => crewMemberName(crew, who),
): WaitingQuestion[] {
  if (!crew.on) return [];
  return crew.cards
    .filter(
      (card) => card.stage === "stuck" && card.stuck?.reason === "question",
    )
    .map((card) => ({
      key: `${card.id}:${stoppedAt(card)}`,
      cardId: card.id,
      title: card.title,
      who: asker(crew, card, name),
      at: stoppedAt(card),
    }))
    .sort((a, b) => a.at - b.at);
}

function stoppedAt(card: CrewCard): number {
  return isTime(card.endedAt) ? card.endedAt : card.updatedAt;
}

/** Who asked: "Tester asked: …" says so; else the card's Builder. */
function asker(
  crew: Crew,
  card: CrewCard,
  name: (who: string) => string,
): string {
  const said = /^([^:]{1,40}) asked: /.exec(card.stuck?.text ?? "")?.[1];
  if (said) return said;
  const builder = cardBuilder(crew, card);
  return builder ? name(builder.id) : "Avos";
}

/**
 * Which waiting question a plain message in Avos's box answers. The rule,
 * in order:
 *
 * 1. A message to one helper (@ it, or the thread showing it) goes to that
 *    helper, never to a card.
 * 2. Else the question you picked with Answer, while it still waits.
 * 3. Else the newest question that waits, unless you set it aside from
 *    the box (the × on its tag, Backspace in the empty box, or @Avos).
 * 4. Else none: the message goes to Avos, as any other message does.
 *
 * The box shows the card it answers as a tag, so a message about
 * something else is one × away from going to Avos.
 */
export function questionToAnswer(
  waiting: readonly WaitingQuestion[],
  input: {
    /** A helper the box writes to. */
    to: string | null;
    /** The question you picked with Answer. */
    picked: string | null;
    /** Questions you set aside from the box (their keys). */
    passed: readonly string[];
  },
): WaitingQuestion | null {
  if (input.to) return null;
  const picked = waiting.find((item) => item.cardId === input.picked);
  if (picked) return picked;
  return waiting.findLast((item) => !input.passed.includes(item.key)) ?? null;
}

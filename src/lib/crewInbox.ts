import type { AutomationReview } from "./automationReview";
import {
  CREW_ROLE_INFO,
  securityReviewBy,
  stackedCards,
  type Crew,
  type CrewCard,
} from "./crews";
import { plural } from "./words";

/**
 * Ready and Stuck crew cards in the Inbox, as review cards. Like an
 * automation's card, a bot only supplies words for its text; what a button
 * says and does are Aven's own, fixed for the card's state, and pressing one
 * never sends a bot's words anywhere.
 */

export type CrewInboxAction = "apply" | "review" | "open-board" | "done";

/** Each state's buttons, in Aven's words: never a bot's. */
export const CREW_INBOX_ACTIONS: Readonly<
  Record<"ready" | "stuck", readonly { id: CrewInboxAction; label: string }[]>
> = {
  ready: [
    { id: "apply", label: "Apply" },
    { id: "open-board", label: "Open board" },
  ],
  stuck: [
    { id: "open-board", label: "Open board" },
    { id: "done", label: "Done" },
  ],
};

/**
 * An item's buttons: the batch on the crew's branch opens its Review (an
 * Apply from here couldn't say exactly what you saw); a card of its own is
 * applied by its fingerprint, as its check passed it.
 */
export function crewInboxActions(
  item: Pick<CrewInboxItem, "card" | "batch">,
): readonly { id: CrewInboxAction; label: string }[] {
  if (item.batch) return [{ id: "review", label: "Review" }];
  return CREW_INBOX_ACTIONS[item.card.stage === "ready" ? "ready" : "stuck"];
}

/** "Ready" or "Needs you", for the card's heading. */
export function crewInboxHeading(card: Pick<CrewCard, "stage">): string {
  return card.stage === "ready" ? "Ready" : "Needs you";
}

/**
 * The card's text: what changed and what was checked for Ready, why it
 * stopped for Stuck. Built by Aven from the card's own record.
 */
export function crewInboxSummary(
  card: CrewCard,
  names: { checker: string; security?: string } = {
    checker: CREW_ROLE_INFO.checker.label,
  },
): string {
  if (card.stage === "ready") {
    const fix = card.fix;
    const files = fix
      ? `${plural(fix.files, "file")} · +${fix.additions} −${fix.deletions}`
      : "";
    const secured = card.rounds.some(
      (round) => round.n === card.round && round.security,
    );
    return [
      secured
        ? `Passed ${names.checker}'s check and ${securityReviewBy(names.security ?? CREW_ROLE_INFO.security.label)} in round ${card.round}`
        : `Passed ${names.checker}'s check in round ${card.round}`,
      files,
      plural(card.runs, "run"),
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return [card.stuck?.text ?? "Stopped", plural(card.runs, "run")]
    .filter(Boolean)
    .join(" · ");
}

/** The Inbox card a Ready or Stuck crew card posts. */
export function crewInboxCard(
  card: CrewCard,
  now: number,
  names?: { checker: string; security?: string },
): AutomationReview {
  return {
    kind: "review",
    title: card.title.slice(0, 120),
    summary: crewInboxSummary(card, names).slice(0, 600),
    status: "open",
    postedAt: now,
  };
}

/** Its Inbox card resolved, when the card is applied, thrown away or picked up again. */
export function withInboxResolved(
  card: CrewCard,
  status: "done" | "dismissed",
  now: number,
): CrewCard {
  if (!card.inbox || card.inbox.status !== "open") return card;
  return { ...card, inbox: { ...card.inbox, status, resolvedAt: now } };
}

export type CrewInboxItem = {
  /** `crew:<project key>:<card id>`. */
  key: string;
  project: string;
  card: CrewCard;
  review: AutomationReview;
  /** The cards on the crew's branch, as one item. */
  batch?: true;
};

/**
 * Crew cards whose Inbox card is open, newest first: only Ready and Stuck
 * ones, so a card picked up again leaves the Inbox by itself.
 */
export function openCrewInboxItems(
  crews: Readonly<Record<string, Crew>>,
): CrewInboxItem[] {
  const items: CrewInboxItem[] = [];
  for (const [key, crew] of Object.entries(crews)) {
    // The cards on the crew's branch are one batch: one Inbox card, whose
    // Apply lands them all as one change.
    const batch = stackedCards(crew).filter(
      (card) => card.inbox?.status === "open",
    );
    const top = batch.at(-1);
    if (top?.inbox)
      items.push({
        key: `crew:${key}:batch`,
        project: crew.path,
        card: top,
        batch: true,
        review: {
          ...top.inbox,
          title:
            batch.length === 1
              ? top.title
              : `${batch.length} cards ready on the crew's branch`.slice(
                  0,
                  120,
                ),
          summary: (batch.some((card) => card.stacked?.replayed)
            ? `${batch.map((card) => card.title).join(" · ")} · replayed onto your files, not re-checked; Review them, then Apply`
            : batch.length === 1
              ? top.inbox.summary
              : `${batch.map((card) => card.title).join(" · ")} · each checked on its own; Review them, then Apply lands them together`
          ).slice(0, 600),
          postedAt: Math.max(...batch.map((card) => card.inbox!.postedAt)),
        },
      });
    for (const card of crew.cards)
      if (
        !card.stacked &&
        card.inbox?.status === "open" &&
        (card.stage === "ready" || card.stage === "stuck")
      )
        items.push({
          key: `crew:${key}:${card.id}`,
          project: crew.path,
          card,
          review: card.inbox,
        });
  }
  return items.sort((a, b) => b.review.postedAt - a.review.postedAt);
}

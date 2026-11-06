import { useState } from "react";
import { CrewCritter } from "../chrome/CrewCritter";
import { TeamCardButton } from "../chrome/TeamCard";
import type { BatchRange } from "../hooks/useTeamPipeline";
import { avosForYouLine, type AvosAskKind } from "../lib/avosProfile";
import type { PipelineBatch } from "../lib/crewPipeline";
import type { Crew } from "../lib/crews";
import type { CrewBoardAction, CrewBoardActionId } from "../lib/crewView";
import { plural } from "../lib/words";
import { BatchButtons } from "./TeamBatch";
import "./AvosForYou.css";

/** One thing in Avos's message that waits for you, and its buttons. */
export type AvosAsk = {
  id: string;
  kind: AvosAskKind;
  /** What it is: a change's or a card's title. */
  text: string;
  /** One muted line on it: who made it, a question, where an idea came from. */
  line?: string;
  /** Ready changes on Avos's branch: Review and Apply all. */
  batch?: PipelineBatch;
  /** The card it's about, and its buttons (Build it, Answer, Apply…). */
  cardId?: string;
  actions?: readonly CrewBoardAction[];
  /** Set aside with Not now: shown only when you ask for them. */
  aside?: true;
  /** It can be deleted (after asking). */
  deletable?: true;
};

/** Ideas waiting for you shown before "N more". */
const IDEAS_SHOWN = 4;

/**
 * What needs you, as Avos's own message at the end of its chat (13B of the
 * Avos mocks): a line in its words, then one card with a row for each
 * thing and the buttons that sort it out. Nothing is said when nothing
 * waits; ideas you said Not now to wait behind one quiet line.
 */
export function AvosForYou({
  project,
  crew,
  asks,
  range,
  problems,
  onReview,
  onAct,
}: {
  project: string;
  crew: Crew;
  asks: readonly AvosAsk[];
  range: BatchRange | null;
  problems: Readonly<Record<string, string>>;
  onReview: () => void;
  onAct: (cardId: string, id: CrewBoardActionId | "delete") => void;
}) {
  const [showAside, setShowAside] = useState(false);
  const waiting = asks.filter((ask) => !ask.aside);
  const aside = asks.filter((ask) => ask.aside);
  if (!waiting.length && !aside.length) return null;
  const ideas = waiting.filter((ask) => ask.kind === "idea");
  const shown = [
    ...waiting.filter((ask) => ask.kind !== "idea"),
    ...ideas.slice(0, IDEAS_SHOWN),
    ...(showAside ? aside : []),
  ];
  const moreIdeas = ideas.length - Math.min(ideas.length, IDEAS_SHOWN);
  const toggle = (label: string) => (
    <button
      type="button"
      className="avos-ask-aside"
      aria-expanded={showAside}
      data-avos-set-aside
      onClick={() => setShowAside((open) => !open)}
    >
      {showAside ? "Hide what's set aside" : label}
    </button>
  );
  const card = shown.length ? (
    <div className="avos-asks">
      {shown.map((ask) => (
        <AskRow
          key={ask.id}
          ask={ask}
          crew={crew}
          range={range}
          problem={ask.cardId ? problems[ask.cardId] : undefined}
          onReview={onReview}
          onAct={onAct}
        />
      ))}
    </div>
  ) : null;
  return (
    <ol className="team-posts" aria-label="For you" data-avos-for-you>
      {waiting.length ? (
        <li className="team-post avos-for-you">
          <CrewCritter
            path={project}
            role="lead"
            state="needs"
            className="team-post-mark"
          />
          <div className="team-post-body">
            <p className="team-post-head">
              <b>Avos</b>
            </p>
            <p className="team-post-text">
              {avosForYouLine(waiting.map((ask) => ask.kind))}
            </p>
            {card}
            {moreIdeas > 0 || aside.length ? (
              <p className="avos-asks-foot">
                {moreIdeas > 0 ? (
                  <span>
                    {plural(moreIdeas, "more idea")}{" "}
                    {moreIdeas === 1 ? "waits" : "wait"} after these
                  </span>
                ) : null}
                {aside.length ? toggle(`${aside.length} set aside`) : null}
              </p>
            ) : null}
          </div>
        </li>
      ) : (
        <li className="avos-for-you-quiet">
          {toggle(`${plural(aside.length, "idea")} set aside`)}
          {card}
        </li>
      )}
    </ol>
  );
}

function AskRow({
  ask,
  crew,
  range,
  problem,
  onReview,
  onAct,
}: {
  ask: AvosAsk;
  crew: Crew;
  range: BatchRange | null;
  problem?: string;
  onReview: () => void;
  onAct: (cardId: string, id: CrewBoardActionId | "delete") => void;
}) {
  return (
    <div className="avos-ask" data-avos-need={ask.id}>
      <span className="avos-ask-text">
        <b title={ask.text}>{ask.text}</b>
        {ask.line ? <span title={ask.line}>{ask.line}</span> : null}
      </span>
      {ask.batch ? (
        <BatchButtons
          crew={crew}
          batch={ask.batch}
          range={range}
          onReview={onReview}
          className="avos-ask-buttons"
          problemClass="avos-ask-problem"
        />
      ) : ask.cardId && (ask.actions?.length || ask.deletable) ? (
        <span className="avos-ask-buttons">
          {(ask.actions ?? []).map((action) => (
            <TeamCardButton
              key={action.id}
              size="compact"
              variant={action.primary ? "primary" : "default"}
              onClick={() => onAct(ask.cardId!, action.id)}
            >
              {action.label}
            </TeamCardButton>
          ))}
          {ask.deletable ? (
            <TeamCardButton
              size="compact"
              variant="ghost"
              data-avos-delete
              onClick={() => onAct(ask.cardId!, "delete")}
            >
              Delete
            </TeamCardButton>
          ) : null}
        </span>
      ) : null}
      {problem ? (
        <p className="avos-ask-problem" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

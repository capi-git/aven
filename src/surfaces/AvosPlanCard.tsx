import { Check } from "../chrome/icons";
import { useContext, useMemo, useState, useSyncExternalStore } from "react";
import { CrewCritters } from "../chrome/CrewCritter";
import { TeamCardButton } from "../chrome/TeamCard";
import {
  avosPlanAgents,
  avosPlanStepState,
  avosPlanSteps,
  type AvosPlanState,
  type AvosPlanStep,
} from "../lib/avosPlan";
import { giveIdeasToCrew } from "../lib/crewActions";
import { ideaWaits } from "../lib/crewLimits";
import { crewForChat, crewForFolder, useCrewsStore } from "../lib/crews";
import { errorText } from "../lib/errors";
import { featureBoardState, subscribeFeatureCards } from "../lib/featureCards";
import { CrewFenceSource } from "./CrewFenceCard";
import "./CrewFenceCard.css";
import "./AvosPlanCard.css";

/** Ask Avos's screen to open the review of what is ready. */
export const OPEN_REVIEW = "aven:avos-open-review";

/** A block that will list work, while it is still being written. */
const PLANS = /"(cards|helpers|research|mockup)"\s*:/;

/**
 * Avos's plan, under the reply that made it: each part of the work with the
 * agents it goes to, and where it stands now. Before anything starts it is
 * what Avos is about to do; after, the same rows follow the work. Go shows
 * only while the work waits for you (Ask before building, or a reply that
 * read a page). A reply that starts nothing shows no card.
 */
export function AvosPlanCard({
  code,
  incomplete,
  cwd,
}: {
  code: string;
  incomplete?: boolean;
  /** The chat's folder: the project, or Avos's copy. */
  cwd?: string;
}) {
  useCrewsStore();
  const source = useContext(CrewFenceSource);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const steps = useMemo(
    () => (incomplete ? [] : avosPlanSteps(code)),
    [code, incomplete],
  );
  const crew = crewForChat(source.chatId)?.crew ?? crewForFolder(cwd);
  const path = crew?.path ?? "";
  const board = useSyncExternalStore(
    subscribeFeatureCards,
    () => featureBoardState(path),
    () => featureBoardState(path),
  );
  if (incomplete)
    return PLANS.test(code) ? (
      <p className="crew-fence-quiet" data-avos-plan="writing">
        Planning the work…
      </p>
    ) : null;
  if (!steps.length) return null;
  const now = Date.now();
  const rows = steps.map((step) => {
    const state = avosPlanStepState(crew, step);
    // A build nothing has started, which only your go-ahead will.
    const idea =
      crew && step.kind === "build" && state.at === "waiting"
        ? board.cards.find(
            (card) =>
              card.column === "idea" &&
              card.title.toLowerCase() === step.title.toLowerCase(),
          )
        : undefined;
    const held = !!crew?.on && !!idea && ideaWaits(crew, idea, now) !== null;
    return { step, state, held };
  });
  const held = rows.filter((row) => row.held).map((row) => row.step.title);
  const ready = rows.some((row) => row.state.at === "ready");
  const go = () => {
    if (!crew || !held.length) return;
    setBusy(true);
    setProblem(null);
    void giveIdeasToCrew(crew.path, held)
      .catch((error) => errorText(error))
      .then((why) => {
        setBusy(false);
        setProblem(why);
      });
  };
  return (
    <section
      className="crew-fence avos-plan"
      data-avos-plan={held.length ? "waits" : ready ? "ready" : "started"}
      aria-label="Plan"
    >
      <header className="crew-fence-head">
        <strong>Plan</strong>
        {held.length ? (
          <>
            <TeamCardButton
              size="compact"
              onClick={() =>
                document
                  .querySelector<HTMLElement>(
                    "[data-avos-chat] textarea, [data-avos-chat] [contenteditable=true]",
                  )
                  ?.focus()
              }
            >
              Change
            </TeamCardButton>
            <TeamCardButton
              size="compact"
              variant="primary"
              disabled={busy}
              onClick={go}
            >
              Go
            </TeamCardButton>
          </>
        ) : ready ? (
          // What it built waits for you: one Review, for all of it.
          <TeamCardButton
            size="compact"
            variant="needs-you"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent(OPEN_REVIEW, { detail: { project: path } }),
              )
            }
          >
            Review
          </TeamCardButton>
        ) : null}
      </header>
      <ol className="crew-fence-items avos-plan-steps">
        {rows.map(({ step, state }) => (
          <li key={step.key} data-avos-step={state.at}>
            <CrewCritters
              {...(crew ? { path: crew.path } : {})}
              roles={step.agents}
              active={state.at === "working" ? state.agent : false}
              className="avos-plan-faces"
            />
            <span className="crew-fence-item" title={step.detail}>
              <span className="crew-fence-title">{step.title}</span>
              <span className="crew-fence-detail">{avosPlanAgents(step)}</span>
            </span>
            <StepState state={state} />
          </li>
        ))}
      </ol>
      {problem ? (
        <p className="crew-fence-line" role="alert">
          {problem}
        </p>
      ) : null}
    </section>
  );
}

/** Where a step stands, said only when there is something to say. */
function StepState({ state }: { state: AvosPlanState }) {
  if (state.at === "working")
    return <span className="crew-fence-given">Working</span>;
  if (state.at === "queued")
    return <span className="crew-fence-given">Queued</span>;
  if (state.at === "asks")
    return <span className="avos-plan-needs">Needs you</span>;
  // Built and checked, or finished: the card's Review says what is yours.
  if (state.at === "ready" || state.at === "done")
    return (
      <Check
        className="avos-plan-done"
        strokeWidth={2}
        role="img"
        aria-label={state.at === "ready" ? "Ready to review" : "Done"}
      />
    );
  return null;
}

export type { AvosPlanStep };

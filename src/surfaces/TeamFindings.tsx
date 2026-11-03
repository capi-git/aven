import { useState } from "react";
import { CrewCritters } from "../chrome/CrewCritter";
import { Modal } from "../chrome/Modal";
import { TeamCardButton } from "../chrome/TeamCard";
import {
  addResearchIdeas,
  dismissResearch,
  focusCrewTell,
} from "../lib/crewActions";
import { sourcesText } from "../lib/crewView";
import {
  cardResearcher,
  crewCard,
  memberCritter,
  type Crew,
} from "../lib/crews";
import { errorText } from "../lib/errors";
import { plural } from "../lib/words";
import { workBoardActions } from "../lib/workBoardFeed";
import "../chrome/TeamCard.css";
import "./TeamFindings.css";

/**
 * The Researcher's findings for a research card: its summary, each finding
 * with where it was read (a link opens in Aven's browser), and the ideas it
 * proposes with a tick each. Add puts the ticked ones in Ideas, where each
 * waits for you; Dismiss keeps none. Nothing here ever changed a file, so
 * there is nothing to apply.
 */
export function CrewFindingsSheet({
  crew,
  cardId,
  name,
  onClose,
}: {
  crew: Crew;
  cardId: string;
  /** A member's name, by its id or role. */
  name: (who: string) => string;
  onClose: () => void;
}) {
  const card = crewCard(crew, cardId);
  const findings = card?.findings;
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!card || card.kind !== "research" || !findings) return null;
  const researcher = cardResearcher(crew);
  const who = name(researcher?.id ?? "researcher");
  const open = card.stage === "ready";
  const chosen = findings.ideas.filter((idea) => !unticked.has(idea));
  const minutes =
    card.startedAt && card.endedAt
      ? Math.max(1, Math.round((card.endedAt - card.startedAt) / 60_000))
      : null;
  const finish = async (ideas: readonly string[] | null) => {
    setBusy(true);
    setProblem(null);
    const why = await (
      ideas
        ? addResearchIdeas(crew.path, card.id, ideas)
        : dismissResearch(crew.path, card.id)
    ).catch((error) => errorText(error));
    setBusy(false);
    if (why) setProblem(why);
    else onClose();
  };
  const followUp = () => {
    // The team's Chat opens with the box writing to the Researcher.
    focusCrewTell(crew.path, researcher?.id);
    onClose();
  };
  return (
    <Modal
      onClose={onClose}
      title={card.title}
      description={[
        who,
        `read ${sourcesText(findings.sources)}`,
        minutes ? `${minutes} min` : "",
      ]
        .filter(Boolean)
        .join(" · ")}
      className="crew-sheet crew-findings"
      size="lg"
      leading={
        <CrewCritters
          path={crew.path}
          roles={[
            {
              id: researcher?.id ?? "researcher",
              role: "researcher",
              ...(researcher?.critter
                ? { critter: memberCritter(researcher) }
                : {}),
            },
          ]}
        />
      }
    >
      <div className="crew-sheet-body" data-crew-findings={card.id}>
        {findings.summary ? (
          <section className="crew-sheet-section">
            <h3>Summary</h3>
            <p className="crew-findings-summary">{findings.summary}</p>
          </section>
        ) : null}
        {findings.findings.length ? (
          <section className="crew-sheet-section">
            <h3>{plural(findings.findings.length, "finding")}</h3>
            <ol className="crew-findings-list">
              {findings.findings.map((finding, index) => (
                <li key={index}>
                  <span className="crew-findings-text">{finding.text}</span>
                  {finding.source ? (
                    <SourceChip source={finding.source} />
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        ) : (
          <p className="crew-sheet-note">It found nothing it could point to.</p>
        )}
        {findings.ideas.length ? (
          <section className="crew-sheet-section" data-crew-findings-ideas>
            <h3>
              {open
                ? "Ideas it proposes · tick what goes on the Board"
                : findings.added
                  ? `Ideas it proposed · ${plural(findings.added, "idea")} added`
                  : "Ideas it proposed"}
            </h3>
            <ul className="crew-findings-ideas">
              {findings.ideas.map((idea) => (
                <li key={idea}>
                  <label className="crew-findings-idea">
                    <input
                      type="checkbox"
                      disabled={!open || busy}
                      checked={open ? !unticked.has(idea) : false}
                      onChange={(event) =>
                        setUnticked((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.delete(idea);
                          else next.add(idea);
                          return next;
                        })
                      }
                    />
                    <span>{idea}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {problem ? (
          <p className="crew-sheet-problem" role="alert">
            {problem}
          </p>
        ) : null}
        <footer className="crew-sheet-foot">
          <span className="crew-sheet-small">
            Sources are links in the full page. Nothing here changed any file.
          </span>
          <div className="crew-sheet-actions">
            {open ? (
              <TeamCardButton
                variant="ghost"
                disabled={busy}
                onClick={() => void finish(null)}
              >
                Dismiss
              </TeamCardButton>
            ) : (
              <TeamCardButton variant="ghost" onClick={onClose}>
                Close
              </TeamCardButton>
            )}
            {researcher ? (
              <TeamCardButton disabled={busy} onClick={followUp}>
                Ask a follow-up
              </TeamCardButton>
            ) : null}
            {open && findings.ideas.length ? (
              <TeamCardButton
                variant="primary"
                disabled={busy || !chosen.length}
                onClick={() => void finish(chosen)}
              >
                {busy
                  ? "Adding…"
                  : `Add ${plural(chosen.length, "idea")} to Board`}
              </TeamCardButton>
            ) : null}
          </div>
        </footer>
      </div>
    </Modal>
  );
}

/** Where a finding was read: a link opens in Aven's browser, a file is named. */
function SourceChip({ source }: { source: string }) {
  const link = /^https?:\/\//i.test(source);
  let label = source;
  if (link) {
    try {
      label = new URL(source).hostname.replace(/^www\./, "");
    } catch {
      label = source;
    }
  }
  if (!link)
    return (
      <span className="crew-findings-source" title={source}>
        {label}
      </span>
    );
  return (
    <button
      type="button"
      className="crew-findings-source"
      data-link
      title={source}
      onClick={() => workBoardActions()?.openUrl(source)}
    >
      {label}
    </button>
  );
}

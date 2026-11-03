import { useState, type KeyboardEvent } from "react";
import {
  startTeamSetup,
  type SetupIdeaDraft,
  type SetupMember,
} from "../lib/crewActions";
import { CREW_PRESETS } from "../lib/crewPresets";
import { proposeTeamSetup } from "../lib/crewSetup";
import {
  CREW_ROLE_INFO,
  CREW_ROLE_ORDER,
  type Crew,
  type CrewRole,
} from "../lib/crews";
import { errorText } from "../lib/errors";
import { SETUP_DESCRIPTION_MAX } from "../lib/crewPrompts";
import { CrewCritter } from "./CrewCritter";
import { Plus, X } from "./icons";
import { TeamCardButton } from "./TeamCard";
import "./TeamCard.css";
import "./TeamBuilder.css";
import "./TeamSetup.css";

/**
 * A new team from your words: one box, then the team Aven suggests (tiles
 * with one job each, × to drop, + to add a role back) and the first ideas
 * (rows you can edit, drop or add to), then Start team. Pick teammates
 * myself is the Build a team sheet as it was. Nothing starts until Start.
 */

/** The roles a tile can be; the Fixer joins from the project's bot. */
const SETUP_ROLES = CREW_ROLE_ORDER.filter(
  (role): role is Exclude<CrewRole, "fixer"> => role !== "fixer",
);

/** Where an idea came from, as its row says it. */
function sourceLabel(idea: SetupIdeaDraft): string {
  return idea.source === "you"
    ? "from what you wrote"
    : idea.source === "researcher"
      ? "Researcher"
      : "suggested";
}

export function TeamSetup({
  crew,
  project,
  onPickMyself,
  onTurnOn,
  onStarted,
}: {
  crew: Crew;
  project: string;
  /** Build a team instead, by hand. */
  onPickMyself: () => void;
  /** Turn the team on. Resolves with why it couldn't, or null. */
  onTurnOn: () => Promise<string | null>;
  /** It started: show it. */
  onStarted: () => void;
}) {
  const [text, setText] = useState("");
  const [teammates, setTeammates] = useState<SetupMember[] | null>(null);
  const [ideas, setIdeas] = useState<SetupIdeaDraft[]>([]);
  const [newIdea, setNewIdea] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const path = crew.path;

  const suggest = async () => {
    const words = text.trim();
    if (!words || suggesting) return;
    setSuggesting(true);
    setProblem(null);
    const found = await proposeTeamSetup(path, words).catch((error) => ({
      error: errorText(error),
    }));
    setSuggesting(false);
    if ("error" in found) {
      setProblem(found.error);
      return;
    }
    setTeammates(
      found.setup.teammates
        .filter((mate) => mate.role !== "fixer")
        .map((mate) => ({
          role: mate.role as Exclude<CrewRole, "fixer">,
          job: mate.job,
        })),
    );
    // Your own rows stay; the suggestions are replaced.
    setIdeas((current) => [
      ...current.filter((idea) => idea.source === "you"),
      ...found.setup.ideas.map((idea): SetupIdeaDraft => ({
        title: idea.title,
        source: idea.by === "researcher" ? "researcher" : "setup",
      })),
    ]);
  };
  const addIdea = () => {
    const title = newIdea.trim();
    if (!title) return;
    setIdeas((current) => [...current, { title, source: "you" }]);
    setNewIdea("");
  };
  const start = async () => {
    if (!teammates || starting) return;
    setStarting(true);
    setProblem(null);
    const result = await startTeamSetup(
      path,
      { description: text, teammates, ideas },
      onTurnOn,
    ).catch((error) => ({ on: false, problem: errorText(error) }));
    setStarting(false);
    // On, the team's screen shows it (and says any problem in its feed);
    // off, the sheet says why and Start is there to press again.
    if (result.on) onStarted();
    else setProblem(result.problem);
  };
  const hasResearcher = !!teammates?.some((mate) => mate.role === "researcher");
  const missing = SETUP_ROLES.filter(
    (role) => !teammates?.some((mate) => mate.role === role),
  );
  const canStart =
    !!teammates && teammates.some((mate) => mate.role === "builder");
  const onDescriptionKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    )
      return;
    event.preventDefault();
    void suggest();
  };
  return (
    <div className="team-setup" data-crew-setup>
      <div className="team-setup-describe">
        <textarea
          className="aven-field team-setup-text"
          aria-label={`What ${project} is and what you want`}
          placeholder={`Say what ${project} is and what you want.`}
          rows={3}
          maxLength={SETUP_DESCRIPTION_MAX}
          value={text}
          autoFocus
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onDescriptionKey}
        />
        <TeamCardButton
          size="compact"
          variant={teammates ? "default" : "primary"}
          disabled={suggesting || !text.trim()}
          data-crew-setup-suggest
          onClick={() => void suggest()}
        >
          {suggesting ? "Suggesting…" : teammates ? "Suggest again" : "Suggest"}
        </TeamCardButton>
      </div>
      {teammates ? (
        <>
          <section className="team-build-section" aria-label="Your team">
            <h3 className="team-build-label">
              Your team <span>· from what you wrote</span>
            </h3>
            <ul className="team-setup-tiles" role="list" data-crew-setup-team>
              {teammates.map((mate) => {
                const preset = CREW_PRESETS.find(
                  (item) => item.key === mate.role,
                );
                const name = CREW_ROLE_INFO[mate.role].label;
                return (
                  <li
                    key={mate.role}
                    className="team-setup-tile"
                    data-crew-setup-role={mate.role}
                  >
                    <span className="team-setup-tile-head">
                      <CrewCritter
                        path={path}
                        role={mate.role}
                        {...(preset ? { critter: preset.mark } : {})}
                        className="team-setup-tile-mark"
                      />
                      <span className="team-setup-tile-name">{name}</span>
                      <button
                        type="button"
                        className="team-setup-x"
                        aria-label={`Drop ${name}`}
                        title={`Drop ${name}`}
                        onClick={() =>
                          setTeammates((current) =>
                            (current ?? []).filter(
                              (item) => item.role !== mate.role,
                            ),
                          )
                        }
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                    <span className="team-setup-tile-job">{mate.job}</span>
                  </li>
                );
              })}
            </ul>
            {missing.length ? (
              <div className="team-setup-add" data-crew-setup-add>
                <span className="team-setup-add-label">
                  <Plus className="size-3" /> Add teammate
                </span>
                {missing.map((role) => (
                  <button
                    key={role}
                    type="button"
                    className="team-setup-add-role"
                    onClick={() =>
                      setTeammates((current) => {
                        const next = [
                          ...(current ?? []),
                          { role, job: CREW_ROLE_INFO[role].job },
                        ];
                        return next.sort(
                          (a, b) =>
                            CREW_ROLE_ORDER.indexOf(a.role) -
                            CREW_ROLE_ORDER.indexOf(b.role),
                        );
                      })
                    }
                  >
                    {CREW_ROLE_INFO[role].label}
                  </button>
                ))}
              </div>
            ) : null}
          </section>
          <section className="team-build-section" aria-label="First ideas">
            <h3 className="team-build-label">
              First ideas <span>· edit, drop or add your own</span>
            </h3>
            <ul className="team-setup-ideas" role="list" data-crew-setup-ideas>
              {ideas.map((idea, index) => (
                <li
                  key={index}
                  className="team-setup-idea"
                  data-crew-setup-idea={idea.source}
                >
                  <input
                    className="team-setup-idea-title"
                    aria-label={`Idea ${index + 1}`}
                    value={idea.title}
                    onChange={(event) =>
                      setIdeas((current) =>
                        current.map((item, at) =>
                          at === index
                            ? { ...item, title: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                  <span className="team-setup-idea-source">
                    {idea.source === "researcher" && !hasResearcher
                      ? "suggested"
                      : sourceLabel(idea)}
                  </span>
                  <button
                    type="button"
                    className="team-setup-x"
                    aria-label={`Drop “${idea.title}”`}
                    title="Drop this idea"
                    onClick={() =>
                      setIdeas((current) =>
                        current.filter((_, at) => at !== index),
                      )
                    }
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
              <li className="team-setup-idea" data-crew-setup-new-idea>
                <input
                  className="team-setup-idea-title"
                  aria-label="Add an idea"
                  placeholder="Add an idea…"
                  value={newIdea}
                  onChange={(event) => setNewIdea(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || event.nativeEvent.isComposing)
                      return;
                    event.preventDefault();
                    addIdea();
                  }}
                  onBlur={addIdea}
                />
              </li>
            </ul>
          </section>
        </>
      ) : null}
      {problem ? (
        <p className="bot-sheet-problem" role="alert" data-crew-setup-problem>
          {problem}
        </p>
      ) : null}
      <footer className="team-setup-foot">
        <span className="team-setup-note">
          Nothing starts until you press Start. Teammates work in a copy; you
          apply what you like.
        </span>
        <div className="team-setup-actions">
          <TeamCardButton
            variant="ghost"
            disabled={starting}
            data-crew-setup-pick
            onClick={onPickMyself}
          >
            Pick teammates myself
          </TeamCardButton>
          <TeamCardButton
            variant="primary"
            disabled={!canStart || starting || suggesting}
            data-crew-setup-start
            onClick={() => void start()}
          >
            {starting ? "Starting…" : "Start team"}
          </TeamCardButton>
        </div>
      </footer>
    </div>
  );
}

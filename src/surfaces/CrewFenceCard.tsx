import { useState } from "react";
import { giveIdeasToCrew } from "../lib/crewActions";
import { crewFenceView } from "../lib/crewFences";
import { crewForFolder, useCrewsStore } from "../lib/crews";
import { errorText } from "../lib/errors";
import "./CrewFenceCard.css";

/**
 * A crew's fenced block in a chat, as a compact card instead of raw JSON:
 * "3 ideas" with their titles and Give to crew, "2 must-fix", "Handed
 * over", "Goal met". The bot's words show as quoted text; the buttons are
 * Aven's. While the block is still being written, one quiet line.
 */
export function CrewFenceCard({
  language,
  code,
  incomplete,
  cwd,
}: {
  language: string;
  code: string;
  incomplete?: boolean;
  /** The chat's folder: its project, or a crew's copy. */
  cwd?: string;
}) {
  // Re-read when crews change, so Give to crew appears once the crew is on.
  useCrewsStore();
  const [given, setGiven] = useState<ReadonlySet<string>>(() => new Set());
  const [problem, setProblem] = useState<string | null>(null);
  if (incomplete)
    return (
      <p className="crew-fence-quiet" data-crew-fence={language}>
        Writing a note for the crew…
      </p>
    );
  const view = crewFenceView(language, code);
  if (!view)
    return (
      <p className="crew-fence-quiet" data-crew-fence={language}>
        A note for the crew
      </p>
    );
  const crew = view.kind === "ideas" ? crewForFolder(cwd) : undefined;
  const canGive = !!crew?.on;
  const give = (titles: string[]) => {
    if (!crew) return;
    setProblem(null);
    setGiven((current) => new Set([...current, ...titles]));
    void giveIdeasToCrew(crew.path, titles)
      .catch((error) => errorText(error))
      .then((why) => {
        if (!why) return;
        setProblem(why);
        setGiven((current) => {
          const next = new Set(current);
          for (const title of titles) next.delete(title);
          return next;
        });
      });
  };
  const open = view.items.filter((item) => !given.has(item.title));
  return (
    <section
      className="crew-fence"
      data-crew-fence={language}
      aria-label={view.label}
    >
      <header className="crew-fence-head">
        <strong>{view.label}</strong>
        {canGive && open.length > 1 ? (
          <button
            type="button"
            className="crew-fence-button"
            onClick={() => give(open.map((item) => item.title))}
          >
            Give all to crew
          </button>
        ) : null}
      </header>
      {view.line ? <p className="crew-fence-line">{view.line}</p> : null}
      {view.items.length ? (
        <ul className="crew-fence-items">
          {view.items.map((item) => (
            <li key={item.title}>
              <span className="crew-fence-item">
                <span className="crew-fence-title">{item.title}</span>
                {item.detail ? (
                  <span className="crew-fence-detail">{item.detail}</span>
                ) : null}
              </span>
              {canGive ? (
                given.has(item.title) ? (
                  <span className="crew-fence-given">Given</span>
                ) : (
                  <button
                    type="button"
                    className="crew-fence-button"
                    onClick={() => give([item.title])}
                  >
                    Give to crew
                  </button>
                )
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {problem ? (
        <p className="crew-fence-line" role="alert">
          {problem}
        </p>
      ) : null}
    </section>
  );
}

import { createContext } from "react";
import { crewFenceView } from "../lib/crewFences";
import "./CrewFenceCard.css";

/**
 * Where a fenced block was written: the chat, the reply it is in, and
 * whether that reply answers words you typed yourself.
 */
export const CrewFenceSource = createContext<{
  chatId?: string;
  replyId?: string;
  askedByYou?: boolean;
}>({});

/**
 * A crew's fenced block in a chat, as a compact card instead of raw JSON:
 * "3 ideas" with their titles, "2 must-fix", "Handed over", "Goal met".
 * The agent's words show as quoted text. While the block is still being
 * written, one quiet line.
 */
export function CrewFenceCard({
  language,
  code,
  incomplete,
}: {
  language: string;
  code: string;
  incomplete?: boolean;
  /** The chat's folder. */
  cwd?: string;
}) {
  if (incomplete)
    return (
      <p className="crew-fence-quiet" data-crew-fence={language}>
        Writing a note for the team…
      </p>
    );
  const view = crewFenceView(language, code);
  if (!view)
    return (
      <p className="crew-fence-quiet" data-crew-fence={language}>
        A note for the team
      </p>
    );
  // Its notes are its own: one quiet line here.
  if (view.kind === "memory")
    return (
      <p className="crew-fence-quiet" data-crew-fence={language}>
        {view.label}
      </p>
    );
  return (
    <section
      className="crew-fence"
      data-crew-fence={language}
      aria-label={view.label}
    >
      <header className="crew-fence-head">
        <strong>{view.label}</strong>
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
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

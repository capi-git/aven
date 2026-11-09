import { useEffect, useRef, useState } from "react";
import { removeCrewMember } from "../lib/crewActions";
import { helperRemoval } from "../lib/crewRemoval";
import type { Crew } from "../lib/crews";

/**
 * Remove a helper, asked once: what happens to its work, then Keep it or
 * Remove. A helper Avos can't do without says why instead, and what to do.
 * Removed, the sheet goes back to the team list by itself.
 */
export function RemoveHelperConfirm({
  crew,
  id,
  name,
  onCancel,
}: {
  crew: Crew;
  id: string;
  name: string;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const plan = helperRemoval(crew, id);
  if (!plan) return null;
  if (!plan.ok)
    return (
      <div
        className="crew-settings-remove"
        data-confirming
        data-crew-remove={id}
        data-crew-remove-kept
      >
        <p className="bot-sheet-question">{plan.title}</p>
        <p className="bot-sheet-note">{plan.text}</p>
        <div className="bot-sheet-actions">
          <button
            type="button"
            className="team-card-button"
            data-variant="primary"
            onClick={onCancel}
          >
            OK
          </button>
        </div>
      </div>
    );
  return (
    <div className="crew-settings-remove" data-confirming data-crew-remove={id}>
      <p className="bot-sheet-question">Remove {name}?</p>
      <p className="bot-sheet-note">{plan.lines.join(" ")}</p>
      {problem ? (
        <p className="bot-sheet-problem" role="alert">
          {problem}
        </p>
      ) : null}
      <div className="bot-sheet-actions">
        <button type="button" className="team-card-button" onClick={onCancel}>
          Keep it
        </button>
        <button
          type="button"
          className="team-card-button"
          data-variant="primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setProblem(null);
            void removeCrewMember(crew.path, id).then((why) => {
              if (!mounted.current) return;
              setBusy(false);
              if (why) setProblem(why);
              else onCancel();
            });
          }}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

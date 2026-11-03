import { useEffect, useRef, useState } from "react";
import { CrewCritters } from "../chrome/CrewCritter";
import { Modal } from "../chrome/Modal";
import { TeamCardButton } from "../chrome/TeamCard";
import { buildMockup, dismissMockup } from "../lib/crewActions";
import { sanitizeMockupHtml } from "../lib/crewMockups";
import { cardDesigner, crewCard, memberCritter, type Crew } from "../lib/crews";
import { errorText, logError } from "../lib/errors";
import { readTextFile } from "../lib/fs";
import "../chrome/TeamCard.css";
import "./TeamMockup.css";

/**
 * The Designer's mock-up for a mock-up card, as drawn: the file Aven kept,
 * shown inside its own shadow root so its styles stay its own, with its
 * scripts and handlers taken out (Aven's page runs none anyway). Build it
 * makes a card of yours for a Builder; Dismiss keeps nothing. The file is
 * never part of the project.
 */
export function CrewMockupSheet({
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
  const mockup = card?.mockup;
  const [html, setHtml] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = mockup?.file;
  useEffect(() => {
    if (!file) return;
    let live = true;
    readTextFile(file)
      .then((text) => {
        if (live) setHtml(sanitizeMockupHtml(text));
      })
      .catch((error) => {
        logError("Crew mock-up", error);
        if (live) setProblem("Couldn't read the mock-up file.");
      });
    return () => {
      live = false;
    };
  }, [file]);
  if (!card || card.kind !== "mockup" || !mockup) return null;
  const designer = cardDesigner(crew);
  const who = name(designer?.id ?? "designer");
  const open = card.stage === "ready";
  const finish = async (what: "build" | "dismiss") => {
    setBusy(true);
    setProblem(null);
    const why = await (
      what === "build"
        ? buildMockup(crew.path, card.id)
        : dismissMockup(crew.path, card.id)
    ).catch((error) => errorText(error));
    setBusy(false);
    if (why) setProblem(why);
    else onClose();
  };
  return (
    <Modal
      onClose={onClose}
      title={card.title}
      description={[
        `Mock-up · ${who}`,
        mockup.note,
        mockup.outcome === "built"
          ? "built"
          : mockup.outcome === "dismissed"
            ? "dismissed"
            : "",
      ]
        .filter(Boolean)
        .join(" · ")}
      size="lg"
      className="crew-sheet crew-mockup"
      leading={
        <CrewCritters
          path={crew.path}
          roles={[
            {
              id: designer?.id ?? "designer",
              role: "designer",
              ...(designer?.critter
                ? { critter: memberCritter(designer) }
                : {}),
            },
          ]}
        />
      }
    >
      <div className="crew-sheet-body" data-crew-mockup={card.id}>
        {html === null && !problem ? (
          <p className="crew-sheet-note" role="status">
            Reading the mock-up…
          </p>
        ) : null}
        {html !== null ? <MockupFrame html={html} /> : null}
        {problem ? (
          <p className="crew-sheet-problem" role="alert">
            {problem}
          </p>
        ) : null}
        <footer className="crew-sheet-foot">
          <span className="crew-sheet-small" title={mockup.file}>
            One file Aven keeps for you; nothing here is in the project.
          </span>
          <div className="crew-sheet-actions">
            {open ? (
              <TeamCardButton
                variant="ghost"
                disabled={busy}
                data-crew-mockup-dismiss
                onClick={() => void finish("dismiss")}
              >
                Dismiss
              </TeamCardButton>
            ) : (
              <TeamCardButton variant="ghost" onClick={onClose}>
                Close
              </TeamCardButton>
            )}
            {open ? (
              <TeamCardButton
                variant="primary"
                disabled={busy}
                data-crew-mockup-build
                onClick={() => void finish("build")}
              >
                {busy ? "Working…" : "Build it"}
              </TeamCardButton>
            ) : null}
          </div>
        </footer>
      </div>
    </Modal>
  );
}

/** The mock-up inside a shadow root: its styles its own, its scripts gone. */
function MockupFrame({ html }: { html: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const root = node.shadowRoot ?? node.attachShadow({ mode: "open" });
    root.innerHTML = html;
  }, [html]);
  return (
    <div className="crew-mockup-frame" data-crew-mockup-frame>
      <div ref={host} className="crew-mockup-page" />
    </div>
  );
}

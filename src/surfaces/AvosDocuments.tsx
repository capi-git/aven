import { useEffect, useState } from "react";
import { ChevronLeft, File } from "../chrome/icons";
import {
  deleteAvosDocument,
  useAvosDocument,
  useAvosDocuments,
} from "../lib/avosDocuments";
import { copyText } from "../lib/clipboard";
import { forgetDocumentCards } from "../lib/crewActions";
import type { Crew, CrewFindings, CrewMockup } from "../lib/crews";
import { errorText } from "../lib/errors";
import { formatRunTime } from "../lib/scheduledAgents";
import { plural } from "../lib/words";
import { AgentMarkdown } from "./AgentMarkdown";

/**
 * Avos's Documents, as a Mono's in MonoCode: what it wrote up, newest
 * first, each a row that opens the document here, over the list, to read.
 * The Researcher's findings and the Designer's mock-ups sit under them.
 */
export function AvosDocuments({
  project,
  crew,
  now,
  open,
  onOpen,
}: {
  project: string;
  crew: Crew;
  now: number;
  /** The document open over the list, by its id. */
  open: string | null;
  onOpen: (id: string | null) => void;
}) {
  const documents = useAvosDocuments(project);
  if (open)
    return (
      <AvosDocumentPage
        key={open}
        project={project}
        id={open}
        onBack={() => onOpen(null)}
      />
    );
  const made = crew.cards
    .flatMap((card) => {
      const rows: {
        id: string;
        title: string;
        at: number;
        findings?: CrewFindings;
        mockup?: CrewMockup;
      }[] = [];
      if (card.findings)
        rows.push({
          id: `f:${card.id}`,
          title: card.title,
          at: card.findings.readAt,
          findings: card.findings,
        });
      if (card.mockup)
        rows.push({
          id: `m:${card.id}`,
          title: card.title,
          at: card.mockup.madeAt,
          mockup: card.mockup,
        });
      return rows;
    })
    .sort((a, b) => b.at - a.at);
  // Still reading with nothing else to show: no "nothing here" yet.
  if (documents === null && !made.length)
    return (
      <div className="avos-panel-stack" data-avos-panel-body="documents" />
    );
  if (!documents?.length && !made.length)
    return (
      <div className="avos-panel-stack" data-avos-panel-body="documents">
        <p className="avos-panel-empty avos-panel-centre">
          Ask Avos to write something up, like a plan or a summary, and it shows
          up here.
        </p>
      </div>
    );
  return (
    <div className="avos-panel-stack" data-avos-panel-body="documents">
      {documents?.length ? (
        <div className="avos-panel-doc-rows">
          {documents.map((document) => (
            <button
              key={document.id}
              type="button"
              className="avos-panel-doc-row"
              data-avos-document={document.id}
              aria-label={`Open document ${document.title}`}
              onClick={() => onOpen(document.id)}
            >
              <span className="avos-panel-doc-tile" aria-hidden>
                <File size={14} />
              </span>
              <span className="avos-panel-doc-words">
                <b>{document.title}</b>
                <small>{document.summary || "Document"}</small>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {made.map((doc) => (
        <article key={doc.id} className="avos-panel-doc" data-avos-doc={doc.id}>
          <p className="avos-panel-line">
            <span className="avos-panel-doc-title">{doc.title}</span>
            <span className="avos-panel-when">
              {formatRunTime(doc.at, now)}
            </span>
          </p>
          <p className="avos-panel-doc-kind">
            {doc.findings
              ? `Findings · ${plural(doc.findings.sources, "source")}`
              : "Mock-up"}
          </p>
          <p className="avos-panel-doc-text">
            {doc.findings ? doc.findings.summary : doc.mockup!.note}
          </p>
        </article>
      ))}
    </div>
  );
}

/**
 * One document, read here over the list: a way back (Escape too), its
 * title, Copy and Delete, then its Markdown, which you read and don't edit.
 * Delete asks once, in place.
 */
function AvosDocumentPage({
  project,
  id,
  onBack,
}: {
  project: string;
  id: string;
  onBack: () => void;
}) {
  const document = useAvosDocument(project, id);
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      if (deleting) setDeleting(false);
      else onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleting, onBack]);
  const found = typeof document === "string" ? null : document;
  const remove = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await deleteAvosDocument(project, id);
      forgetDocumentCards(project, id);
      onBack();
    } catch (error) {
      setProblem(errorText(error));
      setBusy(false);
    }
  };
  return (
    <div
      className="avos-panel-stack avos-doc-page"
      data-avos-document-page={id}
    >
      <div className="avos-doc-head">
        <button
          type="button"
          className="avos-panel-back"
          data-avos-document-back
          onClick={onBack}
        >
          <ChevronLeft className="size-3.5" />
          Documents
        </button>
        <span className="avos-panel-spacer" />
        {found && !deleting ? (
          <>
            <button
              type="button"
              className="team-card-button"
              data-avos-document-copy
              onClick={() => {
                void copyText(found.body).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1600);
                });
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              className="team-card-button"
              data-avos-document-delete
              onClick={() => setDeleting(true)}
            >
              Delete
            </button>
          </>
        ) : null}
      </div>
      {found && deleting ? (
        <div
          className="avos-doc-confirm"
          role="alertdialog"
          aria-label="Delete"
        >
          <p>Delete “{found.title}”? It can't be brought back.</p>
          <div className="avos-panel-actions">
            <button
              type="button"
              className="team-card-button"
              disabled={busy}
              onClick={() => setDeleting(false)}
            >
              Keep it
            </button>
            <button
              type="button"
              className="team-card-button"
              data-avos-document-delete-confirm
              disabled={busy}
              onClick={() => void remove()}
            >
              Delete
            </button>
          </div>
        </div>
      ) : null}
      {problem ? (
        <p className="avos-panel-problem" role="alert">
          {problem}
        </p>
      ) : null}
      {document === "loading" ? (
        <p className="avos-panel-empty">Loading document…</p>
      ) : document === "missing" ? (
        <p className="avos-panel-empty">
          This document is no longer available.
        </p>
      ) : (
        <article className="avos-doc" data-avos-document-body>
          {/^\s*#\s/.test(document.body) ? null : (
            <h1 className="avos-doc-title">{document.title}</h1>
          )}
          <AgentMarkdown text={document.body} cwd={project} hardBreaks />
        </article>
      )}
    </div>
  );
}

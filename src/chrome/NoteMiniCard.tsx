import { CornerDownRight, File, X } from "./icons";
import { HarnessIcon } from "./HarnessIcon";
import { ProjectLogoIcon } from "./ProjectLogoIcon";
import { useTabGroupLogos } from "../hooks/useTabGroupLogos";
import {
  notePreview,
  noteSourceProject,
  type NoteCardMeta,
} from "../lib/notes";
import { projectKey } from "../lib/paths";
import { projectToneAt } from "../lib/projectAppearance";
import { requestOpenChat } from "../lib/shipRequest";
import { resolveTabGroupLogo } from "../lib/tabGroups";
import { AgentMark } from "./AgentMark";

type Props = {
  card: NoteCardMeta & { body?: string };
  onDismiss?: () => void;
  embedded?: boolean;
};

export function NoteMiniCard({ card, onDismiss, embedded = false }: Props) {
  const logos = useTabGroupLogos();
  const project = noteSourceProject(card.sourceCwd);
  const key = card.sourceCwd ? projectKey(card.sourceCwd) : null;
  const logoPath = key ? resolveTabGroupLogo(key, logos) : null;

  if (card.kind === "forward")
    return (
      <ForwardCard card={card} onDismiss={onDismiss} embedded={embedded} />
    );

  const inner = (
    <div
      className={`relative rounded-md border border-content/10 bg-content/6 px-2.5 py-2 ${
        onDismiss ? "pr-8" : ""
      }`}
    >
      <div className="flex w-full flex-col text-left">
        <span className="flex min-w-0 items-center gap-1.5">
          <File
            className="size-3.5 shrink-0 text-content/45"
            strokeWidth={1.75}
          />
          <span className="min-w-0 truncate text-ui-caption text-content/50">
            Note{!embedded && card.slug ? ` · ${card.slug}` : ""}
          </span>
        </span>
        <span className="mt-1 line-clamp-1 text-ui-body font-semibold leading-snug text-content">
          {card.title || "Untitled"}
        </span>
        {!embedded && project ? (
          <span className="mt-1 flex min-w-0 items-center gap-1.5 text-ui-caption text-content/45">
            {logoPath ? (
              <ProjectLogoIcon
                path={logoPath}
                className="size-3.5 shrink-0 rounded-sm"
                imageClassName="size-3.5"
              />
            ) : (
              <AgentMark
                tone={projectToneAt(card.sourceCwd!)}
                className="size-[15px] shrink-0"
              />
            )}
            <span className="min-w-0 truncate">{project}</span>
          </span>
        ) : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          title="Remove"
          aria-label={`Remove note ${card.title || "Untitled"}`}
          onClick={onDismiss}
          className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded text-content/40 hover:bg-content/10 hover:text-content"
        >
          <X className="size-3" strokeWidth={2} />
        </button>
      ) : null}
    </div>
  );

  if (embedded) return inner;
  return <div className="px-3 pt-2">{inner}</div>;
}

/**
 * A reply forwarded from another chat: which chat it came from, and in the
 * message box a line of what it says.
 */
function ForwardCard({ card, onDismiss, embedded = false }: Props) {
  const title = card.title.trim() || "Untitled chat";
  const preview = card.body ? notePreview(card.body, "", 280) : "";
  if (embedded)
    return (
      // In the sent message: one quiet line, which opens the chat it came from.
      <button
        type="button"
        title={`Open ${title}`}
        onClick={() => requestOpenChat(card.id)}
        className="flex max-w-full min-w-0 items-center gap-1.5 rounded text-left text-ui-caption text-content/55 hover:text-content/80"
      >
        <CornerDownRight
          aria-hidden
          className="size-3.5 shrink-0"
          strokeWidth={1.75}
        />
        <span className="shrink-0">Forwarded from</span>
        {card.harness ? (
          <HarnessIcon harness={card.harness} className="size-3 shrink-0" />
        ) : null}
        <span className="min-w-0 truncate font-medium text-content/80">
          {title}
        </span>
      </button>
    );
  const inner = (
    <div
      className={`relative rounded-md border border-content/10 bg-content/6 px-2.5 py-2 ${
        onDismiss ? "pr-8" : ""
      }`}
    >
      <span className="flex min-w-0 items-center gap-1.5 text-ui-caption text-content/50">
        <CornerDownRight
          aria-hidden
          className="size-3.5 shrink-0 text-content/45"
          strokeWidth={1.75}
        />
        <span className="shrink-0">Forwarded from</span>
        {card.harness ? (
          <HarnessIcon harness={card.harness} className="size-3 shrink-0" />
        ) : null}
        <span className="min-w-0 truncate font-medium text-content/75">
          {title}
        </span>
      </span>
      {preview ? (
        <span className="mt-1 line-clamp-2 text-ui-body leading-snug text-content/80">
          {preview}
        </span>
      ) : null}
      {onDismiss ? (
        <button
          type="button"
          title="Remove"
          aria-label={`Remove the reply forwarded from ${title}`}
          onClick={onDismiss}
          className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded text-content/40 hover:bg-content/10 hover:text-content"
        >
          <X className="size-3" strokeWidth={2} />
        </button>
      ) : null}
    </div>
  );
  return <div className="px-3 pt-2">{inner}</div>;
}

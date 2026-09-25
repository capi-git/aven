import { createPortal } from "react-dom";
import { LAYER } from "../lib/layers";
import { HARNESS_TITLE, type HarnessId } from "../lib/session";
import { HarnessIcon } from "./HarnessIcon";
import { X } from "./icons";

/** A page an agent opened in a project other than the one on screen. */
export type AgentPageNotice = {
  id: string;
  project: string;
  projectName: string;
  surfaceId: string;
  /** The project's browser tab behind `surfaceId`. */
  tabId: string;
  sessionId: string;
  harness: HarnessId;
  url: string;
};

export function agentPageLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host || url;
  } catch {
    return url;
  }
}

type Props = {
  notices: AgentPageNotice[];
  onShow: (notice: AgentPageNotice) => void;
  onDismiss: (id: string) => void;
};

export function AgentPageNotices({ notices, onShow, onDismiss }: Props) {
  if (notices.length === 0) return null;
  return createPortal(
    <div
      aria-live="polite"
      style={{ zIndex: LAYER.toast }}
      className="pointer-events-none fixed bottom-3 right-3 flex w-[min(340px,calc(100vw-24px))] flex-col gap-2"
    >
      {notices.map((notice) => (
        <article
          key={notice.id}
          role="status"
          className="pointer-events-auto flex items-center gap-2.5 rounded-xl border border-content/15 bg-[color-mix(in_srgb,var(--color-content)_8%,var(--color-background-base))] py-2 pr-2 pl-3 shadow-xl"
        >
          <HarnessIcon harness={notice.harness} className="size-4 shrink-0" />
          <p className="min-w-0 flex-1 text-[12px] leading-4 text-content/75">
            <span className="text-content">
              {HARNESS_TITLE[notice.harness]}
            </span>{" "}
            opened{" "}
            <span className="text-content">{agentPageLabel(notice.url)}</span>{" "}
            in {notice.projectName}
          </p>
          <button
            type="button"
            onClick={() => onShow(notice)}
            className="shrink-0 rounded-md border border-content/20 px-2 py-0.5 text-[12px] text-content hover:bg-content/10"
          >
            Show
          </button>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => onDismiss(notice.id)}
            className="grid size-6 shrink-0 place-items-center rounded-md text-content/50 hover:bg-content/10 hover:text-content"
          >
            <X className="size-3.5" />
          </button>
        </article>
      ))}
    </div>,
    document.body,
  );
}

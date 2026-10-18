import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { SidebarDiscussion, SidebarTalk } from "../lib/discussions";
import type { HarnessId } from "../lib/session";
import { HarnessIcon } from "./HarnessIcon";
import "./ProviderMarks.css";
import "./SidebarDiscussions.css";

/** A row's provider mark, talking while its discussion is active. */
export function DiscussionTalkMark({
  harness,
  talk,
  className = "size-3",
}: {
  harness: HarnessId;
  talk: SidebarTalk;
  className?: string;
}) {
  return (
    <span
      className="discussion-talk-mark"
      data-provider={harness}
      data-talking={!talk.paused || undefined}
      data-speaking={(!talk.paused && talk.speaking) || undefined}
      title={`${talk.paused ? "Paused discussion" : "Discussing"} with “${talk.partnerTitle}”`}
      aria-hidden
    >
      <HarnessIcon harness={harness} className={className} />
    </span>
  );
}

/** Shown on a talking row whose partner row is not on screen. */
export function DiscussionTalkBadge({ talk }: { talk: SidebarTalk }) {
  return (
    <span
      className="discussion-talk-badge"
      data-paused={talk.paused || undefined}
      title={`${talk.paused ? "Paused discussion" : "Discussing"} with “${talk.partnerTitle}”`}
    >
      {`${talk.paused ? "Paused discussion" : "Discussing"} with “${talk.partnerTitle}”`}
    </span>
  );
}

/** One connector: row centres relative to the link layer, in pixels. */
export type DiscussionLink = {
  id: string;
  /** "“Caching” and “Review”", for the connector's button. */
  label: string;
  top: number;
  height: number;
  /** The pulse travels toward the chat that is answering. */
  toward: "up" | "down";
  paused: boolean;
};

type LinkState = {
  links: readonly DiscussionLink[];
  /** Talking rows whose partner row is also shown. */
  linked: ReadonlySet<string>;
};

const NO_LINKS: LinkState = { links: [], linked: new Set() };

function sameState(left: LinkState, right: LinkState): boolean {
  return (
    left.links.length === right.links.length &&
    left.links.every((link, index) => {
      const other = right.links[index];
      return (
        link.id === other.id &&
        link.label === other.label &&
        link.top === other.top &&
        link.height === other.height &&
        link.toward === other.toward &&
        link.paused === other.paused
      );
    }) &&
    left.linked.size === right.linked.size &&
    [...left.linked].every((id) => right.linked.has(id))
  );
}

/** Where each discussion's two rows sit, measured from layout. */
export function measureDiscussionLinks(
  layer: HTMLElement,
  discussions: readonly SidebarDiscussion[],
): LinkState {
  const scroller = layer.parentElement;
  if (!scroller || discussions.length === 0) return NO_LINKS;
  const rows = new Map<string, HTMLElement>();
  for (const row of scroller.querySelectorAll<HTMLElement>(
    "[data-discussion-row]",
  )) {
    const id = row.dataset.discussionRow;
    if (id && !rows.has(id) && row.getClientRects().length > 0)
      rows.set(id, row);
  }
  const frame = layer.getBoundingClientRect();
  // Rects are in zoomed pixels under CSS zoom (Aven's browser fallback for
  // UI scale); the connector is placed in the layer's own pixels.
  const scale =
    layer.offsetWidth > 0 && frame.width > 0
      ? frame.width / layer.offsetWidth
      : 1;
  const centre = (row: HTMLElement) => {
    const rect = row.getBoundingClientRect();
    return (rect.top + rect.height / 2 - frame.top) / scale;
  };
  const links: DiscussionLink[] = [];
  const linked = new Set<string>();
  for (const discussion of discussions) {
    const a = rows.get(discussion.a.sessionId);
    const b = rows.get(discussion.b.sessionId);
    if (!a || !b) continue;
    const ya = centre(a);
    const yb = centre(b);
    const answering = discussion.speaking === "a" ? ya : yb;
    links.push({
      id: discussion.id,
      label: `“${discussion.a.title}” and “${discussion.b.title}”`,
      top: Math.round(Math.min(ya, yb)),
      height: Math.max(1, Math.round(Math.abs(ya - yb))),
      toward: answering > Math.min(ya, yb) ? "down" : "up",
      paused: discussion.paused,
    });
    linked.add(discussion.a.sessionId);
    linked.add(discussion.b.sessionId);
  }
  return links.length ? { links, linked } : NO_LINKS;
}

/**
 * Measures the talking rows once per sidebar render and on size changes, never
 * per frame; the pulse itself is a CSS animation.
 */
export function useDiscussionLinks(
  layer: RefObject<HTMLElement | null>,
  discussions: readonly SidebarDiscussion[],
): LinkState {
  const [state, setState] = useState<LinkState>(NO_LINKS);
  const measure = useCallback(() => {
    const element = layer.current;
    const next = element
      ? measureDiscussionLinks(element, discussions)
      : NO_LINKS;
    setState((current) => (sameState(current, next) ? current : next));
  }, [discussions, layer]);
  const latest = useRef(measure);
  latest.current = measure;
  // Rows move when the sidebar re-renders (new rows, expanded projects).
  useLayoutEffect(() => {
    if (discussions.length || state !== NO_LINKS) measure();
  });
  const active = discussions.length > 0;
  // ...and when a section changes size without a render here.
  useEffect(() => {
    const scroller = layer.current?.parentElement;
    if (!active || !scroller || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => latest.current());
    for (const child of scroller.children) observer.observe(child);
    return () => observer.disconnect();
  }, [active, layer]);
  return state;
}

/**
 * The connector layer: a bracket on the left edge between two rows. With
 * `onOpen`, pressing a bracket shows that discussion in the team panel.
 */
export function DiscussionLinks({
  layer,
  links,
  onOpen,
}: {
  layer: RefObject<HTMLDivElement | null>;
  links: readonly DiscussionLink[];
  onOpen?: (id: string) => void;
}) {
  return (
    <div
      ref={layer}
      className="discussion-links"
      aria-hidden={onOpen ? undefined : true}
    >
      {links.map((link, index) => {
        const style = {
          top: link.top,
          height: link.height,
          left: 2 + index * 3,
        };
        const pulse = link.paused ? null : (
          <span className="discussion-link-track">
            <span className="discussion-link-pulse" />
          </span>
        );
        return onOpen ? (
          <button
            key={link.id}
            type="button"
            className="discussion-link"
            data-discussion-link={link.id}
            data-toward={link.toward}
            data-paused={link.paused || undefined}
            title={`Open the discussion between ${link.label}`}
            aria-label={`Open the discussion between ${link.label}`}
            onClick={() => onOpen(link.id)}
            style={style}
          >
            {pulse}
          </button>
        ) : (
          <span
            key={link.id}
            className="discussion-link"
            data-discussion-link={link.id}
            data-toward={link.toward}
            data-paused={link.paused || undefined}
            style={style}
          >
            {pulse}
          </span>
        );
      })}
    </div>
  );
}

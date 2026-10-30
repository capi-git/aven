import type { ReactNode } from "react";
import { useProjectAppearance } from "../hooks/useProjectAppearance";
import { appearanceSigil } from "../lib/dotSigils";
import { DotMark } from "./DotMark";

/** One tab of a collapsed pane, as its rail shows it. */
export type PaneRailTab = {
  id: string;
  label: string;
  /** The same mark the strip draws for it: a provider, a favicon, a file. */
  icon: ReactNode;
  /** The pane's tab in front. */
  front?: boolean;
  needsYou?: boolean;
  busy?: boolean;
};

/** How many tabs a rail lists before it counts the rest. */
const RAIL_TABS = 5;

/** What a rail is called: its tab in front, and how many more it holds. */
export function paneRailLabel(tabs: readonly PaneRailTab[]): string {
  const front = tabs.find((tab) => tab.front) ?? tabs[0];
  if (!front) return "pane";
  const more = tabs.length - 1;
  return more > 0
    ? `${front.label} and ${more} more ${more === 1 ? "tab" : "tabs"}`
    : front.label;
}

/**
 * The inside of a collapsed pane's rail: a mark for each of its tabs, the
 * one in front first and lit, its name running along the rail, and the
 * project's mark when a chat is on it, as on that chat's message box.
 * The rail itself is the button that opens the pane (WorkspaceStage).
 */
export function PaneRail({
  tabs,
  project,
  chat = false,
}: {
  tabs: readonly PaneRailTab[];
  /** The project whose mark stands at the rail's foot. */
  project?: string | null;
  /** The pane holds a chat. */
  chat?: boolean;
}) {
  const appearance = useProjectAppearance(chat ? project : null);
  const front = tabs.find((tab) => tab.front) ?? tabs[0];
  const ordered = front
    ? [front, ...tabs.filter((tab) => tab !== front)]
    : [...tabs];
  const shown = ordered.slice(0, RAIL_TABS);
  const more = ordered.length - shown.length;
  return (
    <span className="aven-pane-rail" aria-hidden>
      <span className="aven-pane-rail-marks">
        {shown.map((tab) => (
          <span
            key={tab.id}
            className="aven-pane-rail-mark"
            data-front={tab === front || undefined}
            data-busy={tab.busy || undefined}
          >
            {tab.icon}
            {tab.needsYou ? (
              <span className="aven-pane-rail-needs-you" />
            ) : null}
          </span>
        ))}
        {more > 0 ? <span className="aven-pane-rail-more">+{more}</span> : null}
      </span>
      {front ? (
        <span className="aven-pane-rail-label">{front.label}</span>
      ) : null}
      {appearance ? (
        <span className="aven-pane-rail-critter">
          <DotMark
            sigil={appearanceSigil(appearance)}
            state={tabs.some((tab) => tab.busy) ? "working" : "still"}
          />
        </span>
      ) : null}
    </span>
  );
}

/**
 * A collapsed pane's rail from its tabs: chats and files drawn as the strip
 * draws them (`TabIdentity`), pages by their icon.
 */
export function paneRailContent({
  members,
  front,
  tabs,
  pages,
  project,
  identity,
  pageIcon,
  labelOf,
}: {
  members: readonly string[];
  front: string;
  tabs: ReadonlyMap<
    string,
    { busy: boolean; needsYou: boolean; chat: boolean }
  >;
  pages: ReadonlyMap<string, { title: string; favicon?: string }>;
  project: string | null;
  identity: (id: string) => ReactNode;
  pageIcon: (favicon?: string) => ReactNode;
  labelOf: (id: string) => string;
}): { label: string; content: ReactNode } {
  const railTabs: PaneRailTab[] = members.map((id) => {
    const page = pages.get(id);
    const tab = tabs.get(id);
    return {
      id,
      label: page ? page.title || "Browser" : labelOf(id),
      icon: page ? pageIcon(page.favicon) : identity(id),
      front: id === front,
      busy: tab?.busy,
      needsYou: tab?.needsYou,
    };
  });
  return {
    label: paneRailLabel(railTabs),
    content: (
      <PaneRail
        tabs={railTabs}
        project={project}
        chat={members.some((id) => !!tabs.get(id)?.chat)}
      />
    ),
  };
}

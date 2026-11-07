import { Kanban, Terminal } from "./icons";
import { lastMotionImage } from "../lib/browserMotion";
import type { Block } from "../lib/session";
import { recentChatLines } from "../lib/recentSurfaces";
import {
  entryKey,
  isSpaceKey,
  spacePanes,
  type WorkspaceStrip,
} from "../lib/workspaceSpaces";
import { BrowserTabIcon } from "./BrowserTabIcon";
import { FileTypeIcon } from "./FileTypeIcon";
import type { RecentCard } from "./RecentSwitcher";
import { TabIdentity, tabCopy, type Tab } from "./TitleBar";

export type RecentPage = {
  id: string;
  title: string;
  url: string;
  favicon?: string;
};

type Context = {
  strip: WorkspaceStrip;
  tabs: readonly Tab[];
  pages: readonly RecentPage[];
  /** The blocks of the chat a tab shows, if it shows one. */
  blocksOf: (tabId: string) => readonly Block[] | undefined;
  projectless?: boolean;
};

const site = (url: string) =>
  url.replace(/^https?:\/\//, "").replace(/\/$/, "") || url;

/** One tab's name and mark. */
function named(id: string, ctx: Context) {
  const tab = ctx.tabs.find((entry) => entry.id === id);
  if (tab)
    return {
      title: tabCopy(tab, ctx.projectless).headline,
      mark: <TabIdentity tab={tab} active />,
      tab,
    };
  const page = ctx.pages.find((entry) => entry.id === id);
  if (page)
    return {
      title: page.title,
      mark: <BrowserTabIcon favicon={page.favicon} />,
      page,
    };
  return { title: "Tab", mark: null };
}

/** What the recent switcher shows for a strip entry. */
export function recentCard(key: string, ctx: Context): RecentCard {
  if (isSpaceKey(key)) {
    const entry = ctx.strip.entries.find(
      (item) => item.kind === "space" && entryKey(item) === key,
    );
    const panes =
      entry?.kind === "space"
        ? spacePanes(entry.view).map((pane) => {
            const front = pane.tabs.includes(pane.id) ? pane.id : pane.tabs[0];
            const { title, mark } = named(front ?? pane.id, ctx);
            return { id: pane.id, title, mark };
          })
        : [];
    const first = panes[0];
    return {
      key,
      title: panes.map((pane) => pane.title).join(" · ") || "Split",
      meta: `${panes.length} panes`,
      mark: first?.mark ?? null,
      preview: { kind: "panes", panes },
    };
  }

  const { title, mark, tab, page } = named(key, ctx);
  if (page) {
    return {
      key,
      title,
      meta: site(page.url),
      mark,
      preview: {
        kind: "page",
        image: lastMotionImage(key),
        icon: <BrowserTabIcon favicon={page.favicon} />,
      },
    };
  }
  const status = tab?.needsInput
    ? "needs"
    : tab && tab.busyHarnesses.length > 0
      ? "working"
      : undefined;
  const blocks = tab && tab.harnesses.length > 0 ? ctx.blocksOf(key) : null;
  const lines = blocks ? recentChatLines(blocks) : [];
  if (lines.length) {
    return {
      key,
      title,
      mark,
      status,
      preview: { kind: "chat", lines },
    };
  }
  const file = tab?.files[0];
  return {
    key,
    title,
    mark,
    status,
    preview: {
      kind: "plain",
      icon: tab?.board ? (
        <Kanban className="size-3.5" strokeWidth={1.75} aria-hidden />
      ) : file && !tab?.terminal ? (
        <FileTypeIcon name={file} isDir={false} size={14} />
      ) : tab?.harnesses.length ? (
        mark
      ) : (
        <Terminal className="size-3.5" strokeWidth={1.75} aria-hidden />
      ),
      detail: tab && tab.files.length > 1 ? tab.files.join(", ") : undefined,
    },
  };
}

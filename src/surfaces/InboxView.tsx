import "./UtilityViews.css";
import { openInAppUrl } from "../lib/inAppLinks";
import { retryableLazy } from "../lib/retryableLazy";
import { SurfaceBoundary } from "../chrome/SurfaceBoundary";
import {
  CheckCheck,
  CheckCircle,
  CircleDot,
  CircleX,
  ExternalLink,
  GitCompare,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Inbox,
  MessageSquare,
  ListFilter,
  LoaderCircle,
  RefreshCw,
  Search,
  type IconComponent,
} from "../chrome/icons";
import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { InboxFiltersMenu } from "../chrome/InboxFiltersMenu";
import { InboxProviderMark } from "../chrome/InboxProviderMark";
import { ProjectLogoIcon } from "../chrome/ProjectLogoIcon";
import { ProjectMascot } from "../chrome/ProjectMascot";
import { OverlayNav } from "../chrome/TitleBar";
import { WindowControls } from "../chrome/WindowControls";
import { useDragResize } from "../hooks/useDragResize";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { useTabGroupLogos } from "../hooks/useTabGroupLogos";
import {
  githubPrDiff,
  githubReviewDecisionLabel,
  githubWorkItemComment,
  githubWorkItemDetails,
  githubWorkItemThread,
  inboxItemKey,
  inboxItemRef,
  inboxItemStatus,
  inboxListIsFresh,
  inboxProjectsForRail,
  listInboxItems,
  peekGithubPrDiff,
  peekGithubWorkItemDetails,
  peekGithubWorkItemThread,
  peekInboxList,
  formatRelativeTime,
  inboxPersonAvatarUrl,
  type GithubLabel,
  type GithubPrDiff,
  type GithubWorkItemDetails,
  type GithubWorkItemThread,
  type InboxItem,
  type InboxProviderErrors,
  type InboxQuery,
} from "../lib/githubTasks";
import {
  applyInboxFilters,
  inboxCrewItems,
  inboxReviewRuns,
  hasActiveInboxFilters,
  inboxFetchState,
  loadInboxFilters,
  pruneInboxFilters,
  saveInboxFilters,
  type InboxFilters,
} from "../lib/inboxFilters";
import { projectKey, projectName } from "../lib/paths";
import { IS_MAC } from "../lib/platform";
import type { RecentProject } from "../lib/recents";
import {
  isInboxEntryUnseen,
  markInboxItemSeen,
  markInboxItemsSeen,
  useInboxSeenTick,
} from "../lib/inboxSeen";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupLogo,
  resolveTabGroupMascot,
} from "../lib/tabGroups";
import { AgentMarkdown } from "./AgentMarkdown";
import {
  InboxComments,
  InboxCommentForm,
  type InboxReplyTarget,
} from "./InboxComments";
import {
  InboxDiscussionPanel,
  type InboxSessionPortal,
} from "./InboxDiscussionPanel";
import { inboxAskKey } from "../lib/inboxAsk";
import {
  useOpenCrewInboxItems,
  useOpenReviewRuns,
} from "../hooks/useAutomationChats";
import { CrewInboxDetail, InboxCrewCard } from "./CrewInboxCard";
import type { ScheduledRun } from "../lib/scheduledAgents";
import { AutomationReviewCard, InboxReviewCard } from "./AutomationReviewCard";

// The diff renderer pulls in CodeMirror; load it when a PR's code is opened.
const InboxPrDiff = retryableLazy(() =>
  import("./InboxPrDiff").then((module) => module.InboxPrDiff),
);

const MIN_WIDTH = 240;
const MAX_WIDTH = 420;

// One height for the whole detail action row; `border` is inside it, so the
// outline variant lines up with the filled and ghost ones.
const ACTION = "inline-flex items-center gap-1.5 rounded-md px-3 text-ui-label";
const ACTION_FILLED = `${ACTION} h-7 bg-content text-background-base hover:bg-(--aven-inverse-hover)`;
const ACTION_OUTLINE = `${ACTION} h-7 border border-content/15 text-content/80 hover:bg-(--aven-control-bg)`;
const ACTION_GHOST = `${ACTION} h-7 text-content/70 hover:bg-(--aven-control-bg) hover:text-content`;
const DEFAULT_WIDTH = 280;

let rememberedWidth = DEFAULT_WIDTH;

type InboxProjectOption = {
  path: string;
  name: string;
  logoPath: string | null;
};

function inboxProjectOptions(
  projects: RecentProject[],
  logos: ReturnType<typeof useTabGroupLogos>,
): InboxProjectOption[] {
  return [...projects]
    .map((project) => ({
      path: project.path,
      name: projectName(project.path),
      logoPath: resolveTabGroupLogo(projectKey(project.path), logos),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function peekInboxForRail(recents: RecentProject[], cwd: string) {
  const projects = inboxProjectsForRail(recents, cwd);
  const filters = pruneInboxFilters(
    loadInboxFilters(),
    projects.map((project) => project.path),
  );
  return peekInboxList(projects, {
    assignedToMe: filters.assignedToMe,
    state: inboxFetchState(filters),
    search: "",
  });
}

function InboxDetailTab({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={`relative flex h-9 items-center text-ui-label leading-none ${
        selected ? "text-content" : "text-content/50 hover:text-content"
      }`}
    >
      {label}
      {selected ? (
        <span className="absolute inset-x-0 bottom-0 h-0.5 bg-content" />
      ) : null}
    </button>
  );
}

type Props = {
  onAsk: (item: InboxItem) => Promise<string>;
  onAskRestart: (item: InboxItem) => Promise<string>;
  onAskMount: (portal: InboxSessionPortal | null) => void;
  cwd: string;
  recents: RecentProject[];
  besideRail?: boolean;
  onClose?: () => void;
  onToggleSidebar?: () => void;
  onStart?: (item: InboxItem) => void | Promise<void>;
  /** A card's button: sends its message to the automation run's chat. */
  onReviewAction?: (run: ScheduledRun) => unknown;
  /** Shows the run a card came from, in Automations. */
  onOpenAutomationRun?: (runId: string) => void;
};

const reviewKey = (run: ScheduledRun) => `review:${run.id}`;

export function InboxView({
  onAsk,
  onAskRestart,
  onAskMount,
  cwd,
  recents,
  besideRail = false,
  onClose,
  onToggleSidebar,
  onStart,
  onReviewAction,
  onOpenAutomationRun,
}: Props) {
  const [discussionOpen, setDiscussionOpen] = useState(false);
  const listLock = useLockOverscroll<HTMLDivElement>();
  const detailLock = useLockOverscroll<HTMLDivElement>();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const logos = useTabGroupLogos();
  const [groupMascots] = useState(loadTabGroupMascots);
  const [groupColors] = useState(loadTabGroupColors);
  const [groupCustomColors] = useState(loadTabGroupCustomColors);

  const [searchInput, setSearchInput] = useState("");
  const [items, setItems] = useState<InboxItem[]>(
    () => peekInboxForRail(recents, cwd)?.items ?? [],
  );
  const [loading, setLoading] = useState(
    () => peekInboxForRail(recents, cwd) == null,
  );
  const [revalidating, setRevalidating] = useState(false);
  const [providerErrors, setProviderErrors] = useState<InboxProviderErrors>(
    () => peekInboxForRail(recents, cwd)?.errors ?? {},
  );
  const [refresh, setRefresh] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [filters, setFilters] = useState(loadInboxFilters);
  const [filterMenu, setFilterMenu] = useState<HTMLButtonElement | null>(null);
  const prevRefresh = useRef(refresh);

  const projects = useMemo(
    () => inboxProjectsForRail(recents, cwd),
    [cwd, recents],
  );
  const projectOptions = useMemo(
    () => inboxProjectOptions(projects, logos),
    [logos, projects],
  );
  const activeFilters = useMemo(
    () =>
      pruneInboxFilters(
        filters,
        projects.map((project) => project.path),
      ),
    [filters, projects],
  );
  const filtersActive = hasActiveInboxFilters(activeFilters);
  const fetchState = inboxFetchState(activeFilters);
  const fetchQuery = useMemo<InboxQuery>(
    () => ({
      assignedToMe: activeFilters.assignedToMe,
      state: fetchState,
      search: "",
    }),
    [activeFilters.assignedToMe, fetchState],
  );

  const resize = useDragResize({
    min: MIN_WIDTH,
    max: () => Math.min(MAX_WIDTH, Math.round(window.innerWidth * 0.5)),
    defaultWidth: DEFAULT_WIDTH,
    initial: rememberedWidth,
    onCommit: (width) => {
      rememberedWidth = width;
    },
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      if (filterMenu) {
        setFilterMenu(null);
        return;
      }
      onCloseRef.current?.();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [filterMenu]);

  useEffect(() => {
    const force = refresh !== prevRefresh.current;
    prevRefresh.current = refresh;
    const cached = peekInboxList(projects, fetchQuery);
    if (cached) {
      setItems(cached.items);
      setProviderErrors(cached.errors);
      setLoading(false);
    }
    if (!force && cached && inboxListIsFresh(projects, fetchQuery)) {
      return;
    }

    let cancelled = false;
    if (cached) setRevalidating(true);
    else {
      setLoading(true);
      setProviderErrors({});
    }
    void listInboxItems(projects, fetchQuery, { force })
      .then((next) => {
        if (cancelled) return;
        setItems(next.items);
        setProviderErrors(next.errors);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (cached) return;
        setItems([]);
        const message = err instanceof Error ? err.message : String(err);
        setProviderErrors({ github: message });
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setRevalidating(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fetchQuery, projects, refresh]);

  const visibleItems = useMemo(
    () => applyInboxFilters(items, activeFilters, searchInput, Date.now()),
    [activeFilters, items, searchInput],
  );
  // Cards automations left for you, above the issues and pull requests.
  const reviewRuns = useOpenReviewRuns();
  const visibleReviews = useMemo(
    () =>
      inboxReviewRuns(
        reviewRuns,
        activeFilters,
        projects.map((project) => project.path),
        searchInput,
      ),
    [reviewRuns, activeFilters, projects, searchInput],
  );
  // Crew cards (Ready, Needs you), above the automations' cards.
  const crewItems = useOpenCrewInboxItems();
  const visibleCrew = useMemo(
    () =>
      inboxCrewItems(
        crewItems,
        activeFilters,
        projects.map((project) => project.path),
        searchInput,
      ),
    [crewItems, activeFilters, projects, searchInput],
  );
  const inboxSeenTick = useInboxSeenTick();
  const seenEntries = useMemo(
    () =>
      items.map((item) => ({
        key: inboxItemKey(item),
        updatedAt: item.updatedAt,
      })),
    [items],
  );
  const hasUnseen = useMemo(
    () => seenEntries.some(isInboxEntryUnseen),
    [inboxSeenTick, seenEntries],
  );

  const searchNarrowed = searchInput.trim().length > 0;
  const listed =
    visibleReviews.length || visibleCrew.length
      ? "issues or pull requests"
      : "reviews, issues or pull requests";
  const narrowedByUser = searchNarrowed || filtersActive;
  const fetchError = providerErrors.github ?? null;

  const chosenItem = visibleItems.find(
    (item) => inboxItemKey(item) === selectedKey,
  );
  const chosenReview = visibleReviews.find(
    (run) => reviewKey(run) === selectedKey,
  );
  const chosenCrew = visibleCrew.find((item) => item.key === selectedKey);
  // A card is shown when chosen, and first when nothing else is: a crew's,
  // then an automation's.
  const selectedCrew =
    chosenCrew ?? (!chosenItem && !chosenReview ? visibleCrew[0] : undefined);
  const selectedReview =
    chosenItem || selectedCrew
      ? undefined
      : (chosenReview ?? visibleReviews[0]);
  const selected =
    selectedReview || selectedCrew
      ? null
      : (chosenItem ?? visibleItems[0] ?? null);

  useEffect(() => {
    const key = selectedCrew
      ? selectedCrew.key
      : selectedReview
        ? reviewKey(selectedReview)
        : selected
          ? inboxItemKey(selected)
          : null;
    if (key !== selectedKey) setSelectedKey(key);
  }, [selected, selectedReview, selectedCrew, selectedKey]);

  const onFiltersChange = (next: InboxFilters) => {
    const pruned = pruneInboxFilters(
      next,
      projects.map((project) => project.path),
    );
    setFilters(pruned);
    saveInboxFilters(pruned);
  };

  const onFilterButtonClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    // Anchored to this button, so the menu's outside-click dismissal ignores
    // it and this press closes an open menu rather than reopening it.
    const button = event.currentTarget;
    setFilterMenu((open) => (open ? null : button));
  };

  const list = (
    <div
      ref={resize.setPaneRef}
      className="relative flex h-full min-h-0 shrink-0 flex-col border-r border-content/10"
    >
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-content/10 px-2">
        <div className="relative flex h-7 min-w-0 flex-1 items-center">
          <Search className="pointer-events-none absolute left-2 size-3 shrink-0 opacity-50" />
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Filter inbox"
            aria-label="Filter inbox"
            spellCheck={false}
            autoComplete="off"
            className="h-7 w-full rounded-md bg-transparent pl-7 pr-2 text-ui-label text-content outline-none placeholder:text-content/40"
          />
        </div>
        <button
          type="button"
          title="Filter inbox"
          aria-label="Filter inbox"
          aria-expanded={!!filterMenu}
          aria-haspopup="menu"
          onClick={onFilterButtonClick}
          className={`grid size-6 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content ${
            filterMenu || filtersActive ? "bg-content/10 text-content" : ""
          }`}
        >
          <ListFilter className="size-3" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          title="Mark all as read"
          aria-label="Mark all as read"
          disabled={!hasUnseen}
          onClick={() => markInboxItemsSeen(seenEntries)}
          className="grid size-6 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-content/45"
        >
          <CheckCheck className="size-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          aria-label="Refresh"
          onClick={() => setRefresh((value) => value + 1)}
          className="grid size-6 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content"
        >
          {loading || revalidating ? (
            <LoaderCircle
              className="size-3.5 animate-spin"
              strokeWidth={1.75}
            />
          ) : (
            <RefreshCw className="size-3.5" strokeWidth={1.75} />
          )}
        </button>
      </div>
      <div
        ref={listLock}
        className="min-h-0 flex-1 overflow-y-auto overscroll-none"
      >
        {visibleCrew.length ? (
          <ul
            className="flex flex-col gap-0.5 p-1.5 pb-0"
            aria-label="From crews"
          >
            {visibleCrew.map((item) => (
              <li key={item.key}>
                <InboxCrewCard
                  item={item}
                  active={selectedCrew?.key === item.key}
                  onSelect={() => setSelectedKey(item.key)}
                />
              </li>
            ))}
          </ul>
        ) : null}
        {visibleReviews.length ? (
          <ul
            className="flex flex-col gap-0.5 p-1.5 pb-0"
            aria-label="From automations"
          >
            {visibleReviews.map((run) => (
              <li key={run.id}>
                <InboxReviewCard
                  run={run}
                  active={selectedReview?.id === run.id}
                  onSelect={() => setSelectedKey(reviewKey(run))}
                />
              </li>
            ))}
          </ul>
        ) : null}
        {fetchError && visibleItems.length === 0 ? (
          <p className="px-3 py-2 text-ui-label text-content/50">
            {fetchError}
          </p>
        ) : loading && items.length === 0 ? (
          <div className="flex justify-center py-10 text-content/40">
            <LoaderCircle className="size-4 animate-spin" strokeWidth={1.75} />
          </div>
        ) : visibleItems.length === 0 ? (
          <p className="px-3 py-2 text-ui-label text-content/50">
            {/* Cards shown above: this line speaks for the rest alone. */}
            {narrowedByUser
              ? searchNarrowed
                ? `No matching ${listed}`
                : `No ${listed} match these filters`
              : projects.length === 0
                ? "Open a project to fill the inbox"
                : `No matching ${listed}`}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5 p-1.5">
            {visibleItems.map((item) => {
              const key = inboxItemKey(item);
              const projectId = projectKey(item.projectPath);
              return (
                <li key={key}>
                  <InboxCard
                    item={item}
                    active={selected != null && key === inboxItemKey(selected)}
                    logoPath={resolveTabGroupLogo(projectId, logos)}
                    mascotName={resolveTabGroupMascot(projectId, groupMascots)}
                    mascotColor={resolveTabGroupColor(
                      projectId,
                      groupColors,
                      groupCustomColors,
                      projectName(item.projectPath),
                    )}
                    onSelect={() => {
                      markInboxItemSeen({
                        key,
                        updatedAt: item.updatedAt,
                      });
                      setSelectedKey(key);
                    }}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize inbox list"
        className={`absolute inset-y-0 -right-px z-10 w-1.5 cursor-col-resize touch-none ${
          resize.dragging ? "bg-content/15" : "hover:bg-content/10"
        }`}
        onPointerDown={resize.onPointerDown}
        onDoubleClick={resize.onDoubleClick}
      />
    </div>
  );

  const filtersPortal = filterMenu ? (
    <InboxFiltersMenu
      anchor={filterMenu}
      projects={projectOptions}
      filters={activeFilters}
      onChange={onFiltersChange}
      onClose={() => setFilterMenu(null)}
    />
  ) : null;

  return (
    <div
      role="region"
      aria-label="Inbox"
      data-app-inbox
      className="flex min-h-0 min-w-0 flex-1 flex-col text-content"
    >
      <div
        className="flex h-10 shrink-0 select-none items-center border-b border-content/10"
        data-tauri-drag-region="deep"
      >
        {IS_MAC && !besideRail ? <div className="w-[78px] shrink-0" /> : null}
        <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />
        <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-ui-body">
          <Inbox
            className="size-3.5 shrink-0 text-content/45"
            strokeWidth={1.75}
          />
          <span className="min-w-0 truncate text-content">Inbox</span>
          <span className="truncate text-ui-caption text-content/45">
            Reviews, issues & pull requests
          </span>
        </div>
        {IS_MAC ? null : <WindowControls />}
      </div>

      <div className="flex min-h-0 min-w-0 flex-1">
        {list}
        <div className="relative flex min-h-0 min-w-0 flex-1">
          <div
            ref={detailLock}
            className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-none"
          >
            {selectedCrew ? (
              <div className="mx-auto w-full max-w-3xl px-8 py-8">
                <CrewInboxDetail key={selectedCrew.key} item={selectedCrew} />
              </div>
            ) : selectedReview ? (
              <div className="mx-auto w-full max-w-3xl px-8 py-8">
                <AutomationReviewCard
                  key={selectedReview.id}
                  run={selectedReview}
                  onAction={onReviewAction}
                  onOpenRun={
                    onOpenAutomationRun
                      ? (run) => onOpenAutomationRun(run.id)
                      : undefined
                  }
                />
              </div>
            ) : (
              <InboxDetailBody
                item={selected}
                cwd={cwd}
                revision={refresh}
                onDiscuss={() => setDiscussionOpen(true)}
                onStart={onStart}
              />
            )}
          </div>
          {discussionOpen && selected ? (
            <InboxDiscussionPanel
              onOpen={onAsk}
              onRestart={onAskRestart}
              onMount={onAskMount}
              key={inboxAskKey(selected)}
              item={selected}
              onClose={() => setDiscussionOpen(false)}
            />
          ) : null}
        </div>
      </div>
      {filtersPortal}
    </div>
  );
}

function InboxDetailBody({
  item,
  cwd,
  revision = 0,
  onDiscuss,
  onStart,
}: {
  item: InboxItem | null;
  cwd: string;
  revision?: number;
  onDiscuss?: () => void;
  onStart?: (item: InboxItem) => void | Promise<void>;
}) {
  if (!item) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <Inbox className="mb-3 size-6 text-content/30" strokeWidth={1.75} />
        <p className="text-ui-body text-content/45">
          Select a review, issue or pull request
        </p>
      </div>
    );
  }
  return (
    <InboxDetail
      key={inboxItemKey(item)}
      item={item}
      cwd={cwd}
      revision={revision}
      onDiscuss={onDiscuss}
      onStart={onStart}
    />
  );
}

type InboxStatusMark = {
  Icon: IconComponent;
  className: string;
  label: string;
};

/** Status reads from the glyph first and the color second, so it survives color blindness. */
export function inboxStatusMark(item: InboxItem): InboxStatusMark {
  const label = inboxItemStatus(item);
  const pr = item.kind === "pr";
  if (label === "Draft") {
    return {
      Icon: GitPullRequestDraft,
      className: "text-content/50",
      label,
    };
  }
  if (label === "Merged") {
    return { Icon: GitMerge, className: "text-violet-400/90", label };
  }
  if (label === "Closed") {
    // GitHub marks issues closed as completed with a purple check, not a red cross.
    if (
      item.provider === "github" &&
      item.kind === "issue" &&
      item.stateReason?.trim().toLowerCase() === "completed"
    ) {
      return { Icon: CheckCircle, className: "text-violet-400/90", label };
    }
    return {
      Icon: pr ? GitPullRequestClosed : CircleX,
      className: "text-rose-400/90",
      label,
    };
  }
  return {
    Icon: pr ? GitPullRequest : CircleDot,
    className: "text-emerald-400/90",
    label,
  };
}

function InboxCard({
  item,
  active,
  logoPath,
  mascotName,
  mascotColor,
  onSelect,
}: {
  item: InboxItem;
  active: boolean;
  logoPath: string | null;
  mascotName: string | null;
  mascotColor: string;
  onSelect: () => void;
}) {
  useInboxSeenTick();
  const status = inboxStatusMark(item);
  const kindLabel = item.kind === "pr" ? "Pull request" : "Issue";
  const time = formatRelativeTime(item.updatedAt);
  const name = projectName(item.projectPath);
  const source = item.repo || name;
  const unseen = isInboxEntryUnseen({
    key: inboxItemKey(item),
    updatedAt: item.updatedAt,
  });

  return (
    <button
      type="button"
      title={item.title}
      aria-current={active ? "true" : undefined}
      data-utility-card
      aria-label={`${status.label} ${kindLabel.toLowerCase()} ${inboxItemRef(
        item,
      )}: ${item.title}${unseen ? ", new" : ""}`}
      onClick={onSelect}
      className={`flex w-full flex-col rounded-md border px-2.5 py-2 text-left ${
        active
          ? "border-transparent bg-(--aven-selected) text-content"
          : "border-transparent text-content/80 hover:bg-(--aven-hover) hover:text-content"
      }`}
    >
      <span className="flex items-center gap-2">
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <InboxProviderMark className="size-3.5 shrink-0" />
          <status.Icon
            className={`size-3 shrink-0 ${status.className}`}
            strokeWidth={1.75}
          />
          <span className="min-w-0 truncate text-ui-caption text-content/50">
            {kindLabel} · {inboxItemRef(item)}
          </span>
        </span>
        {time || unseen ? (
          <span className="flex shrink-0 items-center gap-1.5">
            {time ? (
              <span className="text-ui-caption tabular-nums text-content/45">
                {time}
              </span>
            ) : null}
            {unseen ? (
              <span aria-hidden className="size-1.5 rounded-full bg-content" />
            ) : null}
          </span>
        ) : null}
      </span>
      <span className="mt-1 line-clamp-1 text-ui-body font-semibold leading-snug text-content">
        {item.title}
      </span>
      <span className="mt-1 flex min-w-0 items-center gap-2">
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-ui-caption text-content/45">
          {logoPath ? (
            <ProjectLogoIcon
              path={logoPath}
              className="size-3.5 shrink-0 rounded-sm"
              imageClassName="size-3.5"
            />
          ) : (
            <ProjectMascot
              project={name}
              color={mascotColor}
              name={mascotName}
              className="size-3 shrink-0"
            />
          )}
          <span className="min-w-0 truncate">{source}</span>
        </span>
        {item.labels.length > 0 ? (
          <span className="flex min-w-0 shrink-0 items-center gap-1">
            {item.labels.slice(0, 2).map((label) => (
              <InboxLabel key={label.name} label={label} compact />
            ))}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function InboxDetail({
  item,
  cwd,
  revision,
  onDiscuss,
  onStart,
}: {
  item: InboxItem;
  cwd: string;
  revision: number;
  onDiscuss?: () => void;
  onStart?: (item: InboxItem) => void | Promise<void>;
}) {
  const kind = item.kind;
  const isPr = kind === "pr";
  const cached = peekGithubWorkItemDetails(item.projectPath, kind, item.number);
  const cachedDiff = isPr
    ? peekGithubPrDiff(item.projectPath, item.number)
    : null;
  const cachedThread = peekGithubWorkItemThread(
    item.projectPath,
    kind,
    item.number,
  );
  const [details, setDetails] = useState<GithubWorkItemDetails | null>(cached);
  const [loading, setLoading] = useState(cached == null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"summary" | "code">("summary");
  const [prDiff, setPrDiff] = useState<GithubPrDiff | null>(cachedDiff);
  const [diffLoading, setDiffLoading] = useState(isPr && cachedDiff == null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [thread, setThread] = useState<GithubWorkItemThread | null>(
    cachedThread,
  );
  const [threadLoading, setThreadLoading] = useState(cachedThread == null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<InboxReplyTarget | null>(null);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const status = inboxItemStatus(item);
  const statusMark = inboxStatusMark(item);

  const source = item.repo || projectName(item.projectPath);
  const markdownCwd = item.projectPath || cwd;
  const authorName = details?.author?.trim() ?? "";
  const extraAssignees = item.assignees.filter(
    (person) =>
      !authorName ||
      person.login.trim().toLowerCase() !== authorName.toLowerCase(),
  );
  const showAssignment =
    extraAssignees.length > 0 || item.assignees.length === 0;
  const reviewDecision =
    details?.reviewDecision?.trim() || thread?.reviewDecision?.trim() || "";
  const reviewLabel = githubReviewDecisionLabel(reviewDecision);
  const reviewClass =
    reviewDecision.toUpperCase() === "APPROVED"
      ? "text-emerald-400/90"
      : reviewDecision.toUpperCase() === "CHANGES_REQUESTED"
        ? "text-rose-400/90"
        : "text-content/50";
  const baseRef =
    details?.baseRefName?.trim() || thread?.baseRefName?.trim() || "";
  const headRef =
    details?.headRefName?.trim() || thread?.headRefName?.trim() || "";

  useEffect(() => {
    let cancelled = false;
    const cachedDetails = peekGithubWorkItemDetails(
      item.projectPath,
      kind,
      item.number,
    );
    if (cachedDetails) {
      setDetails(cachedDetails);
      setLoading(false);
      setError(null);
    } else {
      setLoading(true);
      setError(null);
      setDetails(null);
    }
    void githubWorkItemDetails(item.projectPath, kind, item.number)
      .then((next) => {
        if (cancelled) return;
        setDetails(next);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (cachedDetails) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, item.number, item.projectPath, revision]);

  useEffect(() => {
    let cancelled = false;
    const cachedThread = peekGithubWorkItemThread(
      item.projectPath,
      kind,
      item.number,
    );
    if (cachedThread) {
      setThread(cachedThread);
      setThreadLoading(false);
      setThreadError(null);
    } else {
      setThreadLoading(true);
      setThreadError(null);
      setThread(null);
    }
    void githubWorkItemThread(item.projectPath, kind, item.number)
      .then((next) => {
        if (cancelled) return;
        setThread(next);
        setThreadError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (cachedThread) return;
        setThreadError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setThreadLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, item.number, item.projectPath, revision]);

  useEffect(() => {
    if (!isPr || tab !== "code") return;
    let cancelled = false;
    const cachedDiff = peekGithubPrDiff(item.projectPath, item.number);
    if (cachedDiff) {
      setPrDiff(cachedDiff);
      setDiffLoading(false);
      setDiffError(null);
    } else {
      setDiffLoading(true);
      setDiffError(null);
      setPrDiff(null);
    }
    void githubPrDiff(item.projectPath, item.number)
      .then((next) => {
        if (cancelled) return;
        setPrDiff(next);
        setDiffError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (cachedDiff) return;
        setDiffError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isPr, item.number, item.projectPath, revision, tab]);

  const postComment = async (body: string) => {
    setPosting(true);
    setPostError(null);
    try {
      await githubWorkItemComment(item.projectPath, kind, item.number, body, {
        inReplyTo: replyTo?.threadId,
      });
      setReplyTo(null);
      try {
        setThread(
          await githubWorkItemThread(item.projectPath, kind, item.number, {
            force: true,
          }),
        );
      } catch (err: unknown) {
        setPostError(err instanceof Error ? err.message : String(err));
      }
    } catch (err: unknown) {
      setPostError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className={`mx-auto flex w-full flex-col gap-5 px-8 py-8 max-w-5xl`}>
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-ui-label text-content/50">
          <InboxProviderMark className="size-3.5" />
          <span>{item.kind === "pr" ? "Pull request" : "Issue"}</span>
          <span className="tabular-nums">{inboxItemRef(item)}</span>
          <span className={`flex items-center gap-1 ${statusMark.className}`}>
            <statusMark.Icon className="size-3.5" strokeWidth={1.75} />
            {status}
          </span>
          {source ? <span className="truncate">{source}</span> : null}
        </div>
        <h1 className="text-ui-heading font-semibold leading-tight text-content">
          {item.title}
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-ui-label text-content/50">
          {authorName ? (
            <InboxPerson
              name={authorName}
              avatarUrl={inboxPersonAvatarUrl(
                authorName,
                details?.authorAvatarUrl,
              )}
              size={16}
            />
          ) : null}
          {showAssignment ? (
            <>
              {authorName ? <span aria-hidden>·</span> : null}
              {extraAssignees.length > 0 ? (
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  {extraAssignees.map((person) => (
                    <InboxPerson
                      key={person.login}
                      name={person.login}
                      avatarUrl={inboxPersonAvatarUrl(
                        person.login,
                        person.avatarUrl,
                      )}
                      size={16}
                    />
                  ))}
                </span>
              ) : (
                <span>Unassigned</span>
              )}
            </>
          ) : null}
          <span aria-hidden>·</span>
          <span>{projectName(item.projectPath)}</span>
          {formatRelativeTime(item.updatedAt) ? (
            <>
              <span aria-hidden>·</span>
              <span>Updated {formatRelativeTime(item.updatedAt)}</span>
            </>
          ) : null}
          {baseRef && headRef ? (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex min-w-0 items-center gap-1">
                <GitCompare className="size-3 shrink-0" strokeWidth={1.75} />
                <span className="min-w-0 truncate">
                  {baseRef} ← {headRef}
                </span>
              </span>
            </>
          ) : null}
          {reviewLabel ? (
            <>
              <span aria-hidden>·</span>
              <span className={reviewClass}>{reviewLabel}</span>
            </>
          ) : null}
        </div>
        {item.labels.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {item.labels.map((label) => (
              <InboxLabel key={label.name} label={label} />
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {onStart && item.kind !== "pr" ? (
            <button
              type="button"
              disabled={starting}
              onClick={() => {
                if (starting) return;
                setStarting(true);
                setStartError(null);
                void Promise.resolve(onStart(item))
                  .catch((err: unknown) => {
                    setStartError(
                      err instanceof Error ? err.message : String(err),
                    );
                  })
                  .finally(() => setStarting(false));
              }}
              className={`${ACTION_FILLED} disabled:cursor-default disabled:opacity-40`}
            >
              {starting ? "Sending…" : "Send to agent"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDiscuss}
            className={item.kind === "pr" ? ACTION_FILLED : ACTION_OUTLINE}
          >
            <MessageSquare className="size-3.5" strokeWidth={1.75} /> Ask
          </button>
          <button
            type="button"
            onClick={() => void openInAppUrl(item.url)}
            className={ACTION_GHOST}
          >
            <ExternalLink className="size-3.5" strokeWidth={1.75} />
            {item.kind === "pr" ? "Review on GitHub" : "Open on GitHub"}
          </button>
        </div>
        {startError ? (
          <p className="text-ui-label text-red-400/90">{startError}</p>
        ) : null}
      </header>
      {isPr ? (
        <div
          role="tablist"
          aria-label="Pull request sections"
          className="flex h-9 gap-4 items-stretch border-b border-content/10"
        >
          <InboxDetailTab
            label="Summary"
            selected={tab === "summary"}
            onSelect={() => setTab("summary")}
          />
          <InboxDetailTab
            label="Code"
            selected={tab === "code"}
            onSelect={() => setTab("code")}
          />
        </div>
      ) : (
        <div className="border-t border-content/10" />
      )}
      {isPr && tab === "code" ? (
        diffLoading ? (
          <div className="flex justify-center py-10 text-content/40">
            <LoaderCircle className="size-4 animate-spin" strokeWidth={1.75} />
          </div>
        ) : diffError ? (
          <p className="text-ui-body text-content/50">{diffError}</p>
        ) : prDiff ? (
          <SurfaceBoundary label="pull request diff">
            <Suspense
              fallback={
                <div className="flex justify-center py-10 text-content/40">
                  <LoaderCircle
                    className="size-4 animate-spin"
                    strokeWidth={1.75}
                  />
                </div>
              }
            >
              <InboxPrDiff
                key={`${item.projectPath}:${item.number}:${revision}`}
                diff={prDiff}
              />
            </Suspense>
          </SurfaceBoundary>
        ) : (
          <p className="text-ui-body text-content/45">No file changes</p>
        )
      ) : loading ? (
        <div className="flex justify-center py-10 text-content/40">
          <LoaderCircle className="size-4 animate-spin" strokeWidth={1.75} />
        </div>
      ) : error ? (
        <p className="text-ui-body text-content/50">{error}</p>
      ) : (
        <>
          {details?.body.trim() ? (
            <AgentMarkdown
              text={details.body}
              cwd={markdownCwd}
              allowRemoteMedia
            />
          ) : (
            <p className="text-ui-body text-content/45">No description</p>
          )}
          <InboxComments
            thread={thread}
            loading={threadLoading}
            error={threadError}
            cwd={markdownCwd}
            onReply={setReplyTo}
          />
          <InboxCommentForm
            replyTo={replyTo}
            posting={posting}
            error={postError}
            onCancelReply={() => {
              setReplyTo(null);
              setPostError(null);
            }}
            onSubmit={postComment}
          />
        </>
      )}
    </div>
  );
}

function InboxPerson({
  name,
  avatarUrl,
  size = 20,
  className = "",
}: {
  name: string;
  avatarUrl?: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(!avatarUrl);
  const initial = name.trim().charAt(0).toUpperCase() || "?";

  useEffect(() => {
    setFailed(!avatarUrl);
  }, [avatarUrl]);

  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className}`}>
      {avatarUrl && !failed ? (
        <img
          src={avatarUrl}
          alt=""
          width={size}
          height={size}
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setFailed(true)}
          className="shrink-0 rounded-full bg-content/10 object-cover"
          style={{ width: size, height: size }}
        />
      ) : (
        <span
          aria-hidden
          className="grid shrink-0 place-items-center rounded-full bg-content/12 font-medium text-content/55"
          style={{
            width: size,
            height: size,
            fontSize: Math.max(9, Math.round(size * 0.45)),
          }}
        >
          {initial}
        </span>
      )}
      <span className="min-w-0 truncate">{name}</span>
    </span>
  );
}

function InboxLabel({
  label,
  compact = false,
}: {
  label: GithubLabel;
  compact?: boolean;
}) {
  const color = labelColor(label.color);
  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1 rounded-full px-1.5 py-px text-content/50 bg-(--aven-fill-tertiary) ${
        compact ? "max-w-20 text-ui-micro" : "text-ui-caption"
      }`}
    >
      {color ? (
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
      ) : null}
      <span className="min-w-0 truncate">{label.name}</span>
    </span>
  );
}

function labelColor(value: string): string | null {
  const hex = value.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return `#${hex}`;
}

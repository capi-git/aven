/**
 * The hover cards for a sidebar chat, a project, a chat's tab, Activity and
 * Changes. Each reads what it shows only while it is open; rows never fetch
 * or tick for it.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { usePeekData } from "../hooks/usePeekData";
import { peekChat } from "../lib/chatPeek";
import { errorText, logError } from "../lib/errors";
import {
  gitDiffIndex,
  gitPrStatus,
  gitWorktrees,
  type GitDiffIndex,
  type GitDiffStats,
  type GitPr,
} from "../lib/fs";
import {
  activityPeek,
  changesPeek,
  chatPrState,
  chatsToday,
  lastReplyQuote,
  lastTurnEndedAt,
  peekAge,
  writePeekCache,
} from "../lib/hoverPeek";
import type { ActivityEntry } from "../lib/activity";
import { resolveModel } from "../lib/models";
import { prettyCwd, projectKey } from "../lib/paths";
import {
  gitPrChecks,
  summarizePrChecks,
  type PrChecksSummary,
} from "../lib/prChecks";
import { squashMergeAfterAsking } from "../lib/prMerge";
import type { ProjectStatus } from "../lib/projectStatus";
import { sessionDisplayTitle, type HarnessId } from "../lib/session";
import { sessionRunStatus } from "../lib/sessionRunStatus";
import { plural } from "../lib/words";
import { AgentMark } from "./AgentMark";
import { HoverCard, useHoverCard, type HoverCardState } from "./HoverCard";
import { Check, GitMerge } from "./icons";

function OkMark({ small = false }: { small?: boolean }) {
  return (
    <span
      className="hover-card-ok"
      data-size={small ? "small" : undefined}
      aria-hidden
    >
      <Check className={small ? "size-2" : "size-2.5"} strokeWidth={3} />
    </span>
  );
}

function AddDel({ add, del }: { add: number; del: number }) {
  return (
    <>
      <span className="hover-card-add">+{add}</span>{" "}
      <span className="hover-card-del">−{del}</span>
    </>
  );
}

// ---------------------------------------------------------------- chats

/** What a sidebar row knows about its chat without reading anything. */
export type ChatPeekRow = {
  id: string;
  title: string;
  harness: HarnessId;
  /** Its project. */
  cwd: string;
  branch?: string;
  updatedAt: number;
};

type ChatPr = {
  cwd: string;
  branch: string | null;
  defaultBranch: string | null;
  pr: GitPr | null;
  checks: PrChecksSummary | null;
};

/**
 * The chat's copy and its pull request: the copy it works in when the chat
 * is open, else the checkout that has its branch.
 */
async function loadChatPr(
  project: string,
  copy: string | undefined,
  branch: string | undefined,
): Promise<ChatPr | null> {
  let cwd = copy;
  if (!cwd && branch) {
    const trees = await gitWorktrees(project).catch(() => []);
    cwd = trees.find((tree) => tree.branch === branch)?.path;
  }
  if (!cwd) return null;
  const [index, pr] = await Promise.all([
    gitDiffIndex(cwd).catch(() => null),
    gitPrStatus(cwd).catch(() => null),
  ]);
  let checks: PrChecksSummary | null = null;
  if (pr?.state === "open")
    checks = await gitPrChecks(cwd, pr.number)
      .then((result) => summarizePrChecks(result.checks))
      .catch(() => null);
  return {
    cwd,
    branch: index?.branch ?? branch ?? null,
    defaultBranch: index?.defaultBranch ?? null,
    pr,
    checks,
  };
}

function ChatPeekBody({
  row,
  open,
  busy,
  needsYou,
  onMerged,
}: {
  row: ChatPeekRow;
  open: boolean;
  busy: boolean;
  needsYou: boolean;
  onMerged: () => void;
}) {
  const live = peekChat(row.id);
  const copy = live?.worktreeCwd;
  const knownBranch = live?.branch ?? row.branch;
  const key = `chat:${row.id}:${copy ?? ""}:${knownBranch ?? ""}`;
  const pr = usePeekData(key, open && (!!copy || !!knownBranch), () =>
    loadChatPr(row.cwd, copy, knownBranch),
  );
  const [merging, setMerging] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const now = Date.now();
  const title = sessionDisplayTitle(row.title, row.harness);
  const branch = pr?.branch ?? knownBranch;
  const number = pr?.pr?.number;
  const state = chatPrState(pr?.pr, pr?.checks);
  const doing =
    busy && live ? sessionRunStatus(live, [], now)?.doing : undefined;

  const merge = async () => {
    if (!pr?.pr || merging) return;
    setMerging(true);
    setFailure(null);
    try {
      const merged = await squashMergeAfterAsking(
        pr.cwd,
        pr.pr.number,
        pr.defaultBranch,
      );
      if (merged) {
        writePeekCache(key, { ...pr, pr: { ...pr.pr, state: "merged" } });
        onMerged();
      }
    } catch (cause) {
      logError("Chat card: squash and merge", cause);
      setFailure(errorText(cause));
    } finally {
      setMerging(false);
    }
  };

  const foot = failure ? (
    <span className="hover-card-del">{failure}</span>
  ) : needsYou ? (
    <>
      <span className="hover-card-dot" data-state="waiting" />
      <span>Waiting for you</span>
    </>
  ) : state?.kind === "ready" ? (
    <>
      <OkMark />
      <span>{state.label}</span>
      <button
        type="button"
        className="hover-card-button"
        disabled={merging}
        onClick={() => void merge()}
      >
        <GitMerge className="size-3.5" strokeWidth={1.6} aria-hidden />
        {merging ? "Merging…" : "Squash & merge"}
      </button>
    </>
  ) : state ? (
    <>
      <span
        className="hover-card-dot"
        data-state={state.kind === "failing" ? "failed" : "idle"}
      />
      <span
        className={state.kind === "failing" ? undefined : "hover-card-muted"}
      >
        {state.label}
      </span>
    </>
  ) : null;

  return (
    <>
      <div className="hover-card-body">
        <div className="hover-card-title">
          <span>{title}</span>
          <span className="hover-card-aside">
            {peekAge(row.updatedAt, now)}
          </span>
        </div>
        {number || branch ? (
          <div className="hover-card-meta">
            {number ? <b>#{number}</b> : null}
            {branch ? <span>{branch}</span> : null}
          </div>
        ) : null}
        {busy ? (
          <div className="hover-card-live">
            <AgentMark state="working" className="personal-task-agent-mark" />
            <span>{doing || "Working"}</span>
          </div>
        ) : null}
      </div>
      {foot ? <div className="hover-card-foot">{foot}</div> : null}
    </>
  );
}

/**
 * One card for every chat row in the sidebar: rows carry `data-chat-peek`
 * with their chat's id, and pointing rests on one to open it. A single
 * listener on the list, so a long list costs nothing per row.
 */
export function SidebarChatPeek({
  container,
  disabled,
  find,
  busy,
  needsYou,
}: {
  container: RefObject<HTMLElement | null>;
  disabled: boolean;
  find: (id: string) => ChatPeekRow | undefined;
  busy: ReadonlySet<string>;
  needsYou: (id: string) => boolean;
}) {
  const state = useHoverCard({ disabled });
  const anchor = useRef<HTMLElement | null>(null);
  const [id, setId] = useState<string | null>(null);
  const { onPointerEnter, onPointerLeave } = state.triggerProps;
  const { close } = state;

  useEffect(() => {
    const root = container.current;
    if (!root || disabled) return;
    let over: HTMLElement | null = null;
    const rowOf = (target: EventTarget | null) =>
      target instanceof Element
        ? target.closest<HTMLElement>("[data-chat-peek]")
        : null;
    const onOver = (event: PointerEvent) => {
      const row = rowOf(event.target);
      if (!row || row === over) return;
      over = row;
      anchor.current = row;
      setId(row.dataset.chatPeek ?? null);
      onPointerEnter(event);
    };
    const onOut = (event: PointerEvent) => {
      const row = rowOf(event.target);
      if (!row || row !== over) return;
      if (
        event.relatedTarget instanceof Node &&
        row.contains(event.relatedTarget)
      )
        return;
      over = null;
      onPointerLeave(event);
    };
    // Pressing a row opens it or starts a drag: the card steps aside.
    const onDown = () => close();
    root.addEventListener("pointerover", onOver);
    root.addEventListener("pointerout", onOut);
    root.addEventListener("pointerdown", onDown);
    return () => {
      root.removeEventListener("pointerover", onOver);
      root.removeEventListener("pointerout", onOut);
      root.removeEventListener("pointerdown", onDown);
    };
  }, [container, disabled, onPointerEnter, onPointerLeave, close]);

  const row = id ? find(id) : undefined;
  if (!row || !state.open || !anchor.current?.isConnected) return null;
  return (
    <HoverCard
      key={row.id}
      state={state}
      anchor={anchor}
      side="right"
      align="start"
      width={320}
      label={`About ${sessionDisplayTitle(row.title, row.harness)}`}
    >
      <ChatPeekBody
        row={row}
        open={state.open}
        busy={busy.has(row.id)}
        needsYou={needsYou(row.id)}
        onMerged={close}
      />
    </HoverCard>
  );
}

// ------------------------------------------------------------- projects

export function ProjectPeekCard({
  state,
  anchor,
  path,
  name,
  status,
  chats,
  note,
}: {
  state: HoverCardState;
  anchor: RefObject<HTMLElement | null>;
  path: string;
  name: string;
  status?: ProjectStatus;
  chats?: readonly { updatedAt: number; archived?: boolean }[];
  /** A line about its memory, when Aven changed it lately. */
  note?: string;
}) {
  const index = usePeekData<GitDiffIndex | null>(
    `project:${projectKey(path)}`,
    state.open,
    () => gitDiffIndex(path),
  );
  if (!state.open) return null;
  const today = chats ? chatsToday(chats, Date.now()) : 0;
  const running = status?.running ?? 0;
  const waiting = status?.waiting ?? 0;
  const chatWords = [
    running ? `${running} working` : "",
    waiting ? `${waiting} waiting for you` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <HoverCard
      state={state}
      anchor={anchor}
      side="right"
      align="start"
      width={320}
      label={`About ${name}`}
    >
      <div className="hover-card-body">
        <div className="hover-card-title">
          <span>{name}</span>
          <span className="hover-card-aside">{prettyCwd(path)}</span>
        </div>
        {index?.branch ? (
          <>
            <div className="hover-card-heading">Git</div>
            <div className="hover-card-row">
              <span className="hover-card-mono">{index.branch}</span>
              {index.ahead > 0 ? (
                <span className="hover-card-row-end">
                  ↑{index.ahead} to push
                </span>
              ) : null}
            </div>
            {index.files.length ? (
              <div className="hover-card-row">
                <span>{plural(index.files.length, "changed file")}</span>
                <span className="hover-card-row-end">
                  <AddDel add={index.additions} del={index.deletions} />
                </span>
              </div>
            ) : null}
          </>
        ) : null}
        {chatWords || today ? (
          <>
            <div className="hover-card-heading">Chats</div>
            <div className="hover-card-row">
              <span className={chatWords ? undefined : "hover-card-muted"}>
                {chatWords || "None working"}
              </span>
              {today ? (
                <span className="hover-card-row-end">{today} today</span>
              ) : null}
            </div>
          </>
        ) : null}
        {note ? <div className="hover-card-live">{note}</div> : null}
      </div>
    </HoverCard>
  );
}

// ------------------------------------------------------------------ tabs

export function TabPeekCard({
  state,
  anchor,
  sessionId,
  title,
  project,
}: {
  state: HoverCardState;
  anchor: RefObject<HTMLElement | null>;
  sessionId?: string;
  title: string;
  project: string;
}) {
  if (!state.open) return null;
  const chat = peekChat(sessionId);
  const now = Date.now();
  const quote = chat ? lastReplyQuote(chat.blocks) : "";
  const ended = chat && !chat.busy ? lastTurnEndedAt(chat.blocks) : undefined;
  const age = peekAge(ended, now);
  const when = chat?.busy
    ? "Working"
    : age
      ? age === "now"
        ? "Done just now"
        : `Done ${age} ago`
      : "";
  const model = chat ? resolveModel(chat.harness, chat.model).name : "";
  return (
    <HoverCard
      state={state}
      anchor={anchor}
      side="bottom"
      align="start"
      width={320}
      label={`About ${title}`}
    >
      <div className="hover-card-body">
        <div className="hover-card-title" data-size="small">
          <span>{title}</span>
          <span className="hover-card-aside">{project}</span>
        </div>
        {quote ? <div className="hover-card-quote">{quote}</div> : null}
        {when || model ? (
          <div className="hover-card-live">
            <span>{when}</span>
            {model ? <span className="hover-card-aside">{model}</span> : null}
          </div>
        ) : null}
      </div>
    </HoverCard>
  );
}

// -------------------------------------------------------------- activity

export function ActivityPeekCard({
  state,
  anchor,
  entries,
  summary,
}: {
  state: HoverCardState;
  anchor: RefObject<HTMLElement | null>;
  entries: readonly ActivityEntry[];
  /** The queue in a few words ("Queue is clear"). */
  summary: string;
}) {
  if (!state.open) return null;
  const { unread, rows } = activityPeek(entries, Date.now());
  return (
    <HoverCard
      state={state}
      anchor={anchor}
      side="bottom"
      align="end"
      width={320}
      label="Activity"
    >
      <div className="hover-card-body">
        <div className="hover-card-heading">
          {unread ? `${unread} unread` : "Nothing unread"}
        </div>
        {rows.map((row) => (
          <div key={row.id} className="hover-card-row">
            {row.state === "ready" ? (
              <OkMark small />
            ) : (
              <span
                className="hover-card-dot"
                data-state={
                  row.state === "needs"
                    ? "waiting"
                    : row.state === "failed"
                      ? "failed"
                      : "idle"
                }
              />
            )}
            <span>{row.title}</span>
            <span className="hover-card-row-end">{row.end}</span>
          </div>
        ))}
        <div className="hover-card-separator" />
        <div className="hover-card-row hover-card-muted">
          <span>{summary}</span>
          <span className="hover-card-row-end">Click for all activity</span>
        </div>
      </div>
    </HoverCard>
  );
}

// --------------------------------------------------------------- changes

export function ChangesPeekCard({
  state,
  anchor,
  cwd,
  stats,
}: {
  state: HoverCardState;
  anchor: RefObject<HTMLElement | null>;
  cwd: string;
  /** The counts the tab already has, shown before the list arrives. */
  stats?: GitDiffStats | null;
}) {
  const index = usePeekData<GitDiffIndex>(
    `changes:${projectKey(cwd)}`,
    state.open,
    () => gitDiffIndex(cwd),
  );
  if (!state.open) return null;
  const peek = index ? changesPeek(index.files) : null;
  const files = peek?.files ?? stats?.files ?? 0;
  if (!files) return null;
  const additions = peek?.additions ?? stats?.additions ?? 0;
  const deletions = peek?.deletions ?? stats?.deletions ?? 0;
  return (
    <HoverCard
      state={state}
      anchor={anchor}
      side="bottom"
      align="end"
      width={340}
      label="Changes"
    >
      <div className="hover-card-body">
        <div className="hover-card-heading">
          {plural(files, "file")} · <AddDel add={additions} del={deletions} />
        </div>
        {peek?.shown.map((file) => (
          <div key={file.relative} className="hover-card-row">
            <span className="hover-card-mono" title={file.relative}>
              {file.relative}
            </span>
            <span className="hover-card-row-end hover-card-mono">
              <AddDel add={file.additions} del={file.deletions} />
            </span>
          </div>
        ))}
        {peek?.more ? (
          <div className="hover-card-row hover-card-muted">
            <span>and {peek.more} more</span>
          </div>
        ) : null}
      </div>
    </HoverCard>
  );
}

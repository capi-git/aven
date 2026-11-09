import { useRef, useState, type ReactNode } from "react";
import { CrewCritter } from "../chrome/CrewCritter";
import {
  Clock,
  File,
  GitCompare,
  Kanban,
  MessageMultiple,
} from "../chrome/icons";
import { Toggle } from "./SettingsControls";
import { useDragResize } from "../hooks/useDragResize";
import { useBatchActions, type BatchRange } from "../hooks/useTeamPipeline";
import {
  cardHolderId,
  cardInCopy,
  crewMemberById,
  type CrewFindings,
  type CrewMockup,
} from "../lib/crews";
import { memberAppLine } from "../chrome/crewSettingsParts";
import { teammateChatReady } from "../lib/crewActions";
import type { PipelineBatch } from "../lib/crewPipeline";
import {
  describeSchedule,
  formatRunTime,
  setScheduledAgentEnabled,
  type ScheduledAgent,
  type ScheduledRun,
} from "../lib/scheduledAgents";
import { localDay } from "../lib/projectBots";
import { shortTimeAgo } from "../lib/gitChangesView";
import { plural } from "../lib/words";
import type { BoardCard } from "../lib/workBoard";
import {
  AvosGoal,
  AvosMore,
  AvosSections,
  readyTitle,
  type AvosProfileProps,
} from "./AvosProfile";
import "./AvosPanel.css";

/**
 * Avos's side panel, as a Mono's in MonoCode: one header of five tabs and
 * one body. Overview (who it is, what it did, today, up next), Helpers (who
 * is working now and what finished), Documents (what it wrote up: findings
 * and mock-ups), Habits (its jobs on a schedule) and Changes (what's ready
 * to review and apply, and what you applied). On a narrow pane the tabs
 * are icons in Avos's header and open in a sheet.
 */

export type AvosTab =
  "overview" | "helpers" | "documents" | "habits" | "changes";

export const AVOS_TABS: readonly {
  id: AvosTab;
  label: string;
  icon: (props: { size?: number }) => ReactNode;
}[] = [
  { id: "overview", label: "Overview", icon: Kanban },
  { id: "helpers", label: "Helpers", icon: MessageMultiple },
  { id: "documents", label: "Documents", icon: File },
  { id: "habits", label: "Habits", icon: Clock },
  { id: "changes", label: "Changes", icon: GitCompare },
];

export type AvosPanelProps = AvosProfileProps & {
  tab: AvosTab;
  onTab: (tab: AvosTab) => void;
  /** Its jobs, oldest first, and their runs. */
  jobs: readonly ScheduledAgent[];
  runs: readonly ScheduledRun[];
  /** Work you applied, newest first. */
  shipped: readonly BoardCard[];
  /** What Apply all lands, read from the branch. */
  range: BatchRange | null;
  onOpenJob: (id: string) => void;
  /** The helper open in Helpers, by its id, or none (the list). */
  helper: string | null;
  onCloseHelper: () => void;
  /** Its chat beside Avos, in a split: resolves with why it couldn't. */
  onWatch: (id: string) => Promise<string | null> | void;
  /** Stop its turn, by its chat. */
  onStopHelper: (sessionId: string) => void;
  /** Its posts, in Avos's chat. */
  onPosts: (id: string) => void;
};

const DAY = 24 * 60 * 60_000;

/** The start of `at`'s day, on this computer's clock. */
function dayStart(at: number): number {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/** The tab row: icons, and the open tab's name beside its icon. */
function AvosTabs({
  tab,
  onTab,
  badge,
  compact = false,
}: {
  tab: AvosTab | null;
  onTab: (tab: AvosTab) => void;
  /** How many changes wait in Changes. */
  badge: number;
  compact?: boolean;
}) {
  return (
    <div className="avos-tabs" role="tablist" aria-label="Avos">
      {AVOS_TABS.map(({ id, label, icon: Icon }) => {
        const open = tab === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            className="avos-tab"
            aria-selected={open}
            aria-label={label}
            title={label}
            data-avos-tab={id}
            onClick={() => onTab(id)}
          >
            <Icon size={14} />
            {open && !compact ? <span>{label}</span> : null}
            {id === "changes" && badge ? (
              <span className="avos-tab-badge">{badge}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Beside the chat on a wide pane: the tabs over one body. */
/** The panel's width, as you last dragged it: one for every Avos. */
export const AVOS_PANEL_WIDTH_KEY = "aven.avosPanelWidth";
export const AVOS_PANEL_WIDTH = { min: 300, default: 380, max: 720 } as const;
/** Room the chat keeps beside the panel, however wide you drag it. */
const CHAT_KEEPS = 360;

export function readAvosPanelWidth(): number {
  try {
    const saved = Number(localStorage.getItem(AVOS_PANEL_WIDTH_KEY));
    return Number.isFinite(saved) && saved > 0
      ? saved
      : AVOS_PANEL_WIDTH.default;
  } catch {
    return AVOS_PANEL_WIDTH.default;
  }
}

function saveAvosPanelWidth(width: number) {
  try {
    localStorage.setItem(AVOS_PANEL_WIDTH_KEY, String(width));
  } catch {
    // Not kept: the next screen opens at the default.
  }
}

export function AvosPanel(props: AvosPanelProps) {
  const { crew, tab, onTab, batch } = props;
  const pane = useRef<HTMLElement | null>(null);
  // Its left edge drags it wider or narrower, from 300px up to what leaves
  // the chat its room; double-click puts it back. The same width for every
  // tab and every project's Avos.
  const resize = useDragResize({
    min: AVOS_PANEL_WIDTH.min,
    max: () => {
      const screen = pane.current?.parentElement?.clientWidth;
      const room = (screen || window.innerWidth) - CHAT_KEEPS;
      return Math.max(
        AVOS_PANEL_WIDTH.min,
        Math.min(AVOS_PANEL_WIDTH.max, room),
      );
    },
    direction: "left",
    defaultWidth: AVOS_PANEL_WIDTH.default,
    initial: readAvosPanelWidth(),
    onCommit: saveAvosPanelWidth,
  });
  return (
    <aside
      ref={(element) => {
        pane.current = element;
        resize.setPaneRef(element);
      }}
      className="avos-profile avos-panel"
      aria-label="Avos"
      data-crew-header={crew.path}
      data-avos-panel={tab}
      data-resizing={resize.dragging || undefined}
    >
      <div
        role="separator"
        aria-label="Resize Avos's panel"
        aria-orientation="vertical"
        aria-valuemin={AVOS_PANEL_WIDTH.min}
        aria-valuemax={AVOS_PANEL_WIDTH.max}
        aria-valuenow={resize.width}
        tabIndex={0}
        className="personal-panel-resizer personal-inspector-divider avos-panel-resizer"
        data-native-hit-margin=""
        data-avos-panel-resizer
        data-resizing={resize.dragging || undefined}
        onPointerDown={resize.onPointerDown}
        onDoubleClick={resize.onDoubleClick}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          resize.setWidth(
            resize.width + (event.key === "ArrowLeft" ? 20 : -20),
          );
        }}
      />
      <div className="avos-panel-head">
        <AvosTabs tab={tab} onTab={onTab} badge={batch?.cards.length ?? 0} />
        <AvosMore {...props} />
      </div>
      <div className="avos-panel-body" role="tabpanel">
        <AvosTabBody {...props} />
      </div>
    </aside>
  );
}

/**
 * On a narrow pane: one header over the chat, Avos's Bot and name, a line,
 * and the tabs as icons; a tab opens in a sheet (`onSheet`).
 */
export function AvosPanelBar(
  props: AvosPanelProps & {
    sheet: AvosTab | null;
    onSheet: (tab: AvosTab) => void;
  },
) {
  const { project, glance, line, batch, sheet, onSheet } = props;
  return (
    <header className="avos-bar" data-avos-bar>
      <button
        type="button"
        className="avos-bar-who"
        aria-label="Avos's overview"
        aria-haspopup="dialog"
        onClick={() => onSheet("overview")}
      >
        <CrewCritter
          path={project}
          role="lead"
          state={glance.state}
          className="avos-bar-mark"
        />
        <span className="avos-bar-name">Avos</span>
      </button>
      <p
        className="avos-bar-line"
        data-avos-note={glance.note ?? undefined}
        title={line}
      >
        {line}
      </p>
      <AvosTabs
        tab={sheet}
        onTab={onSheet}
        badge={batch?.cards.length ?? 0}
        compact
      />
      <AvosMore {...props} />
    </header>
  );
}

/** The open tab's body. */
export function AvosTabBody(props: AvosPanelProps) {
  switch (props.tab) {
    case "helpers":
      if (props.helper) return <AvosHelperPage {...props} id={props.helper} />;
      return (
        <div className="avos-panel-stack" data-avos-panel-body="helpers">
          <AvosSections {...props} parts={["helpers", "activity"]} />
        </div>
      );
    case "documents":
      return <AvosDocuments {...props} />;
    case "habits":
      return <AvosHabits {...props} />;
    case "changes":
      return <AvosChanges {...props} />;
    default:
      return <AvosOverview {...props} />;
  }
}

/** Who it is, what it did these six months, today, up next, new today. */
function AvosOverview(props: AvosPanelProps) {
  const { project, crew, glance, line, goal, batch, shipped, jobs, runs, now } =
    props;
  const today = dayStart(now);
  const appliedToday = shipped.filter((card) => card.at >= today).length;
  const helpersToday =
    crew.helperRuns?.day === localDay(now)
      ? crew.helperRuns.count
      : (crew.helpers?.length ?? 0);
  const jobIds = new Set(jobs.map((job) => job.id));
  const runsToday = runs.filter(
    (run) => jobIds.has(run.scheduleId) && run.startedAt >= today,
  ).length;
  const dueToday = jobs.filter(
    (job) =>
      job.enabled && job.nextRunAt !== null && job.nextRunAt < today + DAY,
  ).length;
  const next = jobs
    .filter((job) => job.enabled && job.nextRunAt !== null)
    .sort((a, b) => a.nextRunAt! - b.nextRunAt!)[0];
  const newToday = [
    ...shipped
      .filter((card) => card.at >= today)
      .map((card) => ({
        id: card.id,
        text: `${card.title} · applied`,
        at: card.at,
      })),
    ...crew.cards
      .filter((card) => card.findings && card.findings.readAt >= today)
      .map((card) => ({
        id: `f:${card.id}`,
        text: `${card.title} · findings`,
        at: card.findings!.readAt,
      })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 4);
  return (
    <div className="avos-panel-stack" data-avos-panel-body="overview">
      <div className="avos-profile-id">
        <div className="avos-profile-top">
          <CrewCritter
            path={project}
            role="lead"
            state={glance.state}
            className="avos-profile-mark"
          />
          <div className="avos-profile-who">
            <h1 className="avos-profile-name">Avos</h1>
            <p
              className="avos-profile-line"
              data-crew-sentence
              data-avos-note={glance.note ?? undefined}
              title={line}
            >
              {line}
            </p>
          </div>
        </div>
        <AvosGoal project={project} goal={goal} />
      </div>
      <AvosActivityGrid shipped={shipped} now={now} />
      <section className="avos-profile-section" data-avos-profile="today">
        <h2>Today</h2>
        <div className="avos-panel-tiles">
          <AvosTile
            value={String(batch?.cards.length ?? 0)}
            label="Ready to review"
          />
          <AvosTile value={String(appliedToday)} label="Applied" />
          <AvosTile value={String(helpersToday)} label="Helpers run" />
          <AvosTile
            value={`${runsToday}/${Math.max(runsToday, dueToday)}`}
            label="Habits run"
          />
        </div>
      </section>
      <section className="avos-profile-section" data-avos-profile="next">
        <h2>Up next</h2>
        {next ? (
          <p className="avos-panel-line">
            <span>{next.name}</span>
            <span className="avos-panel-when">
              {formatRunTime(next.nextRunAt!, now)}
            </span>
          </p>
        ) : (
          <p className="avos-panel-empty">
            Nothing scheduled. Ask Avos to do something on a habit.
          </p>
        )}
      </section>
      <section className="avos-profile-section" data-avos-profile="new">
        <h2>New today</h2>
        {newToday.length ? (
          newToday.map((row) => (
            <p key={row.id} className="avos-panel-line">
              <span>{row.text}</span>
              <span className="avos-panel-when">
                {formatRunTime(row.at, now)}
              </span>
            </p>
          ))
        ) : (
          <p className="avos-panel-empty">Nothing new yet today.</p>
        )}
      </section>
    </div>
  );
}

function AvosTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="avos-panel-tile">
      <span className="avos-panel-tile-value">{value}</span>
      <span className="avos-panel-tile-label">{label}</span>
    </div>
  );
}

const WEEKS = 26;

/**
 * What it did: a grid of the last 26 weeks, a day a square, greyer to
 * whiter for more of its work you applied that day. Grey only (no tints).
 */
export function activityLevels(
  applied: readonly number[],
  now: number,
): number[] {
  const end = dayStart(now);
  const first = end - (WEEKS * 7 - 1) * DAY;
  const counts = new Array<number>(WEEKS * 7).fill(0);
  for (const at of applied) {
    const day = Math.round((dayStart(at) - first) / DAY);
    if (day >= 0 && day < counts.length) counts[day]! += 1;
  }
  return counts.map((count) => (count >= 4 ? 4 : count));
}

function AvosActivityGrid({
  shipped,
  now,
}: {
  shipped: readonly BoardCard[];
  now: number;
}) {
  const levels = activityLevels(
    shipped.map((card) => card.at),
    now,
  );
  const total = levels.reduce((sum, level) => sum + (level ? 1 : 0), 0);
  const applied = shipped.filter(
    (card) => card.at >= dayStart(now) - (WEEKS * 7 - 1) * DAY,
  ).length;
  return (
    <section className="avos-profile-section" data-avos-profile="did">
      <h2 className="avos-panel-heading-row">
        <span>What it did</span>
        <span className="avos-panel-when">
          {applied
            ? `${plural(applied, "change")} applied in 6 months`
            : "Nothing applied yet"}
        </span>
      </h2>
      <div
        className="avos-panel-grid"
        role="img"
        aria-label={`Work applied on ${plural(total, "day")} in the last 6 months`}
      >
        {levels.map((level, index) => (
          <i key={index} data-level={level} />
        ))}
      </div>
    </section>
  );
}

/** What it wrote up: the Researcher's findings and the Designer's mock-ups. */
function AvosDocuments({ crew, now }: AvosPanelProps) {
  const docs = crew.cards
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
  if (!docs.length)
    return (
      <div className="avos-panel-stack" data-avos-panel-body="documents">
        <p className="avos-panel-empty avos-panel-centre">
          Ask Avos to look something up or sketch a screen, and what it writes
          shows up here.
        </p>
      </div>
    );
  return (
    <div className="avos-panel-stack" data-avos-panel-body="documents">
      {docs.map((doc) => (
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

/** Its jobs on a schedule, each with a switch; opening one shows its runs. */
function AvosHabits({ jobs, runs, now, onOpenJob }: AvosPanelProps) {
  if (!jobs.length)
    return (
      <div className="avos-panel-stack" data-avos-panel-body="habits">
        <p className="avos-panel-empty avos-panel-centre">
          Ask Avos to do something on a schedule, like a morning digest or a
          weekly check.
        </p>
      </div>
    );
  return (
    <div className="avos-panel-stack" data-avos-panel-body="habits">
      <div className="avos-profile-card">
        {jobs.map((job) => {
          const last = runs
            .filter((run) => run.scheduleId === job.id)
            .sort((a, b) => b.startedAt - a.startedAt)[0];
          return (
            <div
              key={job.id}
              className="avos-panel-habit"
              data-avos-habit={job.id}
            >
              <button
                type="button"
                className="avos-panel-habit-text"
                onClick={() => onOpenJob(job.id)}
              >
                <span className="avos-profile-helper-name">{job.name}</span>
                <span className="avos-profile-helper-meta">
                  {describeSchedule(job.schedule)}
                </span>
                <span className="avos-profile-helper-meta">
                  {last
                    ? `${formatRunTime(last.startedAt, now)}: ${last.summary || "ran"}`
                    : job.enabled && job.nextRunAt !== null
                      ? `First run ${formatRunTime(job.nextRunAt, now)}`
                      : "Off"}
                </span>
              </button>
              <Toggle
                label={job.name}
                tone="neutral"
                on={job.enabled}
                onChange={(on) => setScheduledAgentEnabled(job.id, on)}
              />
            </div>
          );
        })}
      </div>
      <p className="avos-panel-empty">
        Ask Avos in the chat to add or change one. A habit only posts when it
        has something to tell you.
      </p>
    </div>
  );
}

/** What's ready to review and apply, and what you applied. */
function AvosChanges(props: AvosPanelProps) {
  const { batch, shipped, now } = props;
  const applied = shipped.slice(0, 6);
  return (
    <div className="avos-panel-stack" data-avos-panel-body="changes">
      {batch?.cards.length ? (
        <AvosReady {...props} batch={batch} />
      ) : (
        <p className="avos-panel-empty">
          Nothing waiting. What Avos builds comes here for you to review.
        </p>
      )}
      {applied.length ? (
        <section className="avos-profile-section" data-avos-profile="applied">
          <h2>Applied</h2>
          {applied.map((card) => (
            <p key={card.id} className="avos-panel-line">
              <span>{card.title}</span>
              <span className="avos-panel-when">
                {formatRunTime(card.at, now)}
              </span>
            </p>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function AvosReady({
  crew,
  batch,
  range,
  onReview,
}: AvosPanelProps & { batch: PipelineBatch }) {
  const actions = useBatchActions(crew, batch, range);
  return (
    <section className="avos-profile-section" data-avos-profile="ready">
      <h2 className="avos-panel-heading-row">
        <span>Ready to review · {batch.cards.length}</span>
        {range ? (
          <span className="avos-panel-when">{plural(range.files, "file")}</span>
        ) : null}
      </h2>
      <div className="avos-profile-card">
        {batch.cards.map((card) => (
          <p
            key={card.id}
            className="avos-panel-change"
            data-avos-change={card.id}
          >
            {card.title}
          </p>
        ))}
      </div>
      {actions.problem ? (
        <p className="avos-panel-problem" role="alert">
          {actions.problem}
        </p>
      ) : null}
      <div className="avos-panel-actions">
        <button
          type="button"
          className="team-card-button"
          data-avos-panel-review
          onClick={onReview}
        >
          Review
        </button>
        <span className="avos-panel-spacer" />
        {actions.restack ? (
          <button
            type="button"
            className="team-card-button"
            disabled={actions.busy}
            onClick={actions.update}
          >
            Update onto your files
          </button>
        ) : (
          <button
            type="button"
            className="team-card-button"
            data-variant="primary"
            data-avos-panel-apply
            disabled={actions.busy || !range || batch.reviewFirst}
            title={batch.reviewFirst ? "Review it first" : undefined}
            onClick={actions.applyAll}
          >
            {batch.cards.length === 1 ? "Apply" : "Apply all"}
          </button>
        )}
      </div>
      <p className="avos-panel-empty">
        Review shows the pictures and code beside the chat. {readyTitle(batch)}{" "}
        stays in Avos's copy until you apply it.
      </p>
    </section>
  );
}

/**
 * A helper's lines in the activity, one step per job: the job's title once,
 * then what it did, newest time on the right. "Builder started “X”" under
 * X's own title reads as "Started".
 */
export function helperSteps(
  entries: readonly { id: string; at: number; title?: string; text: string }[],
): { id: string; at: number; title?: string; texts: string[] }[] {
  const steps: { id: string; at: number; title?: string; texts: string[] }[] =
    [];
  for (const entry of entries) {
    const last = steps.at(-1);
    const text =
      entry.title && entry.text.includes(`started “${entry.title}”`)
        ? "Started"
        : entry.text;
    if (last && entry.title && last.title === entry.title) {
      last.texts.push(text);
      last.at = entry.at;
    } else
      steps.push({
        id: entry.id,
        at: entry.at,
        ...(entry.title ? { title: entry.title } : {}),
        texts: [text],
      });
  }
  return steps;
}

/**
 * One helper, inside the Helpers tab: its face, what it's on and what it
 * runs on, Watch (its chat beside Avos, never instead) and Stop, what it
 * has been doing (its lines in the activity), and what Avos asked it.
 * Avos's chat stays where it is.
 */
function AvosHelperPage(props: AvosPanelProps & { id: string }) {
  const {
    project,
    crew,
    members,
    id,
    now,
    onCloseHelper,
    onWatch,
    onStopHelper,
    onPosts,
  } = props;
  const view = members.find((member) => member.id === id);
  const quick = crew.helpers?.find((helper) => helper.id === id);
  const stored = crewMemberById(crew, id);
  // Why Watch couldn't open its chat, said under it rather than lost.
  const [problem, setProblem] = useState<{ id: string; text: string } | null>(
    null,
  );
  if (!view && !quick)
    return (
      <div className="avos-panel-stack" data-avos-helper-page={id}>
        <button
          type="button"
          className="avos-panel-back"
          onClick={onCloseHelper}
        >
          ‹ Helpers
        </button>
        <p className="avos-panel-empty">This helper has finished and left.</p>
      </div>
    );
  const state = quick
    ? "working"
    : view!.status === "needs-you"
      ? "needs"
      : view!.status === "ready"
        ? "ready"
        : view!.active || view!.status === "working"
          ? "working"
          : "resting";
  const card = cardInCopy(crew);
  const brief =
    card && cardHolderId(crew, card) === id ? card.brief : quick?.doing?.text;
  const role = quick ? "helper" : view!.role;
  const lines = crew.feed
    .filter(
      (entry) =>
        entry.member === id ||
        (!entry.member && entry.who === role && role !== "helper"),
    )
    .slice(-6);
  const sessionId = stored?.sessionId;
  // A teammate's chat starts with Avos's first job in its copy: until
  // then there's nothing to watch, so it says so instead of a dead button.
  const watchable = !quick && teammateChatReady(crew, id);
  return (
    <div className="avos-panel-stack" data-avos-helper-page={id}>
      <button
        type="button"
        className="avos-panel-back"
        data-avos-helper-back
        onClick={onCloseHelper}
      >
        ‹ Helpers
      </button>
      <div className="avos-profile-top">
        <CrewCritter
          path={project}
          role={role}
          {...(view?.critter ? { critter: view.critter } : {})}
          state={state}
          className="avos-profile-mark"
        />
        <div className="avos-profile-who">
          <h1 className="avos-profile-name">
            {quick ? (quick.name ?? "Quick helper") : view!.name}
          </h1>
          <p className="avos-profile-line">
            {[
              view?.line ?? quick?.doing?.text,
              stored ? memberAppLine(stored, crew) : quick ? "Reads only" : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>
      <div className="avos-panel-actions">
        {quick || !watchable ? null : (
          <button
            type="button"
            className="team-card-button"
            data-avos-helper-watch
            onClick={() => {
              setProblem(null);
              void Promise.resolve(onWatch(id)).then((why) => {
                if (why) setProblem({ id, text: why });
              });
            }}
          >
            Watch beside Avos
          </button>
        )}
        {state === "working" && sessionId ? (
          <button
            type="button"
            className="team-card-button"
            data-avos-helper-stop
            onClick={() => onStopHelper(sessionId)}
          >
            Stop
          </button>
        ) : null}
        <span className="avos-panel-spacer" />
        {quick ? null : (
          <button
            type="button"
            className="avos-panel-back"
            data-avos-helper-posts
            onClick={() => onPosts(id)}
          >
            Its posts in the chat
          </button>
        )}
      </div>
      {!quick && !watchable ? (
        <p className="avos-panel-empty" data-avos-helper-unwatchable>
          Its chat opens when Avos gives it its first job.
        </p>
      ) : problem?.id === id ? (
        <p className="avos-panel-problem" role="alert">
          {problem.text}
        </p>
      ) : null}
      <section className="avos-profile-section" data-avos-profile="doing">
        <h2>What it's doing</h2>
        {lines.length ? (
          <div className="avos-profile-card">
            {helperSteps(lines).map((step) => (
              <div
                key={step.id}
                className="avos-panel-step"
                data-avos-helper-step
              >
                <p className="avos-panel-line">
                  <span className="avos-panel-step-title">
                    {step.title ?? step.texts[0]}
                  </span>
                  <span className="avos-panel-when">
                    {shortTimeAgo(step.at, now)}
                  </span>
                </p>
                {(step.title ? step.texts : step.texts.slice(1)).map(
                  (text, index) => (
                    <p key={index} className="avos-panel-step-text">
                      {text}
                    </p>
                  ),
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="avos-panel-empty">
            {state === "working"
              ? "Nothing yet. It's getting started."
              : "Nothing yet. It waits for Avos to give it a job."}
          </p>
        )}
      </section>
      {brief ? (
        <section className="avos-profile-section" data-avos-profile="brief">
          <h2>Avos asked it</h2>
          <p className="avos-panel-doc-text">{brief}</p>
        </section>
      ) : null}
      <p className="avos-panel-empty">
        When it's done, its work is checked, then comes back to you in Changes.
      </p>
    </div>
  );
}

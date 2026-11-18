import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  costLedgerVersion,
  costSummary,
  formatUsd,
  loadCostLedger,
  subscribeCostLedger,
} from "../lib/chatCost";
import { copyText } from "../lib/clipboard";
import { contextPercent, formatTokens } from "../lib/contextUsage";
import { errorText, logError } from "../lib/errors";
import {
  formatGroup,
  formatMemoryOf,
  formatPercent,
  memoryShare,
  type MachineStats,
} from "../lib/machineStats";
import {
  defaultOpenInApp,
  loadOpenInApp,
  openInApp,
  openInApps,
  saveOpenInApp,
  type OpenInApp,
} from "../lib/openInApps";
import { IS_MAC } from "../lib/platform";
import { hasRateLimitWindows, loadSavedRateLimits } from "../lib/rateLimits";
import { useMachineStats } from "../hooks/useMachineStats";
import { HoverCard, useHoverCard } from "./HoverCard";
import { Chip, ChevronDown } from "./icons";

/** A thin line between the usage summary and this chat's buttons. */
export function FooterDivider() {
  return <i className="workspace-footer-divider" aria-hidden />;
}

function Bar({ percent }: { percent: number }) {
  return (
    <div className="hover-card-bar" aria-hidden>
      <i style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
    </div>
  );
}

function Row({ label, end }: { label: ReactNode; end?: ReactNode }) {
  return (
    <div className="hover-card-row">
      <span>{label}</span>
      {end != null ? <span className="hover-card-row-end">{end}</span> : null}
    </div>
  );
}

// --- Spent today -------------------------------------------------------------

const MAX_CHAT_ROWS = 6;

/** Claude reports usage windows only for a subscription account. */
function claudePlanCovers(): boolean {
  const claude = loadSavedRateLimits().claude;
  return !!claude && hasRateLimitWindows(claude);
}

/**
 * Money spent today across chats. Only Claude reports a price, so the
 * button stays hidden until a Claude turn has cost something today.
 */
export function FooterCost({
  chatTitle,
}: {
  /** A chat's title by id, read only while the card is open. */
  chatTitle: (chatId: string) => string | undefined;
}) {
  useSyncExternalStore(subscribeCostLedger, costLedgerVersion);
  const card = useHoverCard();
  const anchor = useRef<HTMLButtonElement>(null);
  const summary = costSummary(loadCostLedger(), Date.now());
  if (summary.today <= 0) return null;
  const today = formatUsd(summary.today);
  const rows = summary.byChat.slice(0, MAX_CHAT_ROWS);
  const more = summary.byChat.length - rows.length;
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="workspace-footer-quiet"
        aria-label={`Spent today: ${today}`}
        aria-expanded={card.open && card.mode === "pinned"}
        data-open={card.open || undefined}
        onClick={card.toggle}
        {...card.triggerProps}
      >
        {today}
      </button>
      <HoverCard
        state={card}
        anchor={anchor}
        side="top"
        align="start"
        width={300}
        label="Spent today"
      >
        <div className="hover-card-body">
          <div className="hover-card-title">
            <span>{today}</span>
            <span className="hover-card-aside">spent today</span>
          </div>
          <div className="hover-card-heading" style={{ marginTop: 12 }}>
            By chat
          </div>
          {rows.map((row) => (
            <Row
              key={row.chatId}
              label={chatTitle(row.chatId) || "A removed chat"}
              end={formatUsd(row.usd)}
            />
          ))}
          {more > 0 ? (
            <Row
              label={<span className="hover-card-muted">{`${more} more`}</span>}
            />
          ) : null}
          <div className="hover-card-separator" />
          <Row label="This week" end={formatUsd(summary.week)} />
          {claudePlanCovers() ? (
            <Row
              label={
                <span className="hover-card-muted">
                  Covered by your Claude plan
                </span>
              }
            />
          ) : null}
        </div>
      </HoverCard>
    </>
  );
}

// --- This chat's context -----------------------------------------------------

export type FooterContextProps = {
  context: { used: number; window?: number | null } | null | undefined;
  /** The chat's model, as people read it. */
  model?: string;
  /** Compacts the chat; absent when its provider can't or it is busy. */
  onCompact?: () => void;
};

/** "31%" of this chat's context, or its tokens when the window is unknown. */
export function contextButtonLabel(
  context: FooterContextProps["context"],
): string | null {
  if (!context || !Number.isFinite(context.used) || context.used < 0)
    return null;
  const percent = contextPercent({
    used: context.used,
    window: context.window ?? undefined,
  });
  return percent != null ? `${percent}%` : formatTokens(context.used);
}

export function FooterContext({
  context,
  model,
  onCompact,
}: FooterContextProps) {
  const card = useHoverCard();
  const anchor = useRef<HTMLButtonElement>(null);
  const label = contextButtonLabel(context);
  if (!context || !label) return null;
  const window =
    context.window != null && context.window > 0 ? context.window : undefined;
  const percent = contextPercent({ used: context.used, window });
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="workspace-footer-quiet"
        aria-label={
          percent != null
            ? `Context used: ${percent}%`
            : `Context used: ${label} tokens`
        }
        aria-expanded={card.open && card.mode === "pinned"}
        data-open={card.open || undefined}
        data-high={(percent != null && percent >= 80) || undefined}
        onClick={card.toggle}
        {...card.triggerProps}
      >
        {label}
      </button>
      <HoverCard
        state={card}
        anchor={anchor}
        side="top"
        align="start"
        width={280}
        label="This chat's context"
      >
        <div className="hover-card-body">
          <div className="hover-card-title">
            <span>This chat</span>
            {model ? <span className="hover-card-aside">{model}</span> : null}
          </div>
          <div className="hover-card-heading" style={{ marginTop: 12 }}>
            Context
          </div>
          {percent != null && window ? (
            <>
              <Row
                label={`${percent}% used`}
                end={`${formatTokens(context.used)} of ${formatTokens(window)}`}
              />
              <Bar percent={percent} />
            </>
          ) : (
            <Row label="Used" end={`${formatTokens(context.used)} tokens`} />
          )}
          {onCompact ? (
            <>
              <div className="hover-card-separator" />
              <div className="hover-card-row">
                <span>Make room by summing up</span>
                <button
                  type="button"
                  className="hover-card-button"
                  data-size="small"
                  onClick={() => {
                    card.close();
                    onCompact();
                  }}
                >
                  Compact
                </button>
              </div>
            </>
          ) : null}
        </div>
      </HoverCard>
    </>
  );
}

// --- This Mac ----------------------------------------------------------------

/**
 * The This Mac card. `children` adds sections below the machine's own
 * rows, such as a list of chats and tabs with their memory.
 */
export function MachineCardBody({
  stats,
  children,
}: {
  stats: MachineStats | null;
  children?: ReactNode;
}) {
  return (
    <div className="hover-card-body">
      <div className="hover-card-heading">This Mac</div>
      {!stats ? (
        <Row label={<span className="hover-card-muted">Measuring…</span>} />
      ) : (
        <>
          <Row
            label="CPU"
            end={
              stats.cpuPercent != null ? formatPercent(stats.cpuPercent) : "…"
            }
          />
          <Bar percent={stats.cpuPercent ?? 0} />
          {stats.memoryTotal > 0 ? (
            <>
              <Row
                label="Memory"
                end={formatMemoryOf(stats.memoryUsed, stats.memoryTotal)}
              />
              <Bar percent={memoryShare(stats)} />
            </>
          ) : null}
          {stats.aven || stats.scripts ? (
            <div className="hover-card-separator" />
          ) : null}
          {stats.aven ? (
            <Row label="Aven and its agents" end={formatGroup(stats.aven)} />
          ) : null}
          {stats.scripts ? (
            <Row
              label="Dev servers and tests"
              end={formatGroup(stats.scripts)}
            />
          ) : null}
        </>
      )}
      {children}
    </div>
  );
}

export function FooterMachine() {
  const card = useHoverCard();
  const anchor = useRef<HTMLButtonElement>(null);
  const stats = useMachineStats(card.open);
  if (!IS_MAC) return null;
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="workspace-footer-quiet"
        data-square
        aria-label="This Mac"
        aria-expanded={card.open && card.mode === "pinned"}
        data-open={card.open || undefined}
        onClick={card.toggle}
        {...card.triggerProps}
      >
        <Chip size={14} strokeWidth={1.6} aria-hidden />
      </button>
      <HoverCard
        state={card}
        anchor={anchor}
        side="top"
        align="end"
        width={280}
        label="This Mac"
      >
        <MachineCardBody stats={stats} />
      </HoverCard>
    </>
  );
}

// --- Open in -----------------------------------------------------------------

/** Installed apps, asked for once the window has settled. */
function useOpenInApps(): OpenInApp[] {
  const [apps, setApps] = useState<OpenInApp[]>([]);
  useEffect(() => {
    if (!IS_MAC) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      openInApps()
        .then((list) => {
          if (alive) setApps(list);
        })
        .catch((error: unknown) => logError("Couldn't list apps", error));
    }, 1_500);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, []);
  return apps;
}

function AppIcon({ app }: { app: OpenInApp }) {
  return app.icon ? (
    <img src={app.icon} alt="" draggable={false} />
  ) : (
    <span className="workspace-footer-app-blank" aria-hidden />
  );
}

/**
 * Opens the project's folder in Finder, a terminal or an editor. The icon
 * opens the app chosen last; the arrow lists the others.
 */
export function FooterOpenIn({ cwd }: { cwd: string }) {
  const apps = useOpenInApps();
  const [saved, setSaved] = useState(loadOpenInApp);
  const card = useHoverCard();
  const anchor = useRef<HTMLSpanElement>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const app = defaultOpenInApp(apps, saved);
  if (!IS_MAC || !app || !cwd || cwd === "~") return null;

  const open = (target: OpenInApp) => {
    card.close();
    setFailure(null);
    if (target.id !== saved) {
      saveOpenInApp(target.id);
      setSaved(target.id);
    }
    openInApp(target.id, cwd).catch((error: unknown) =>
      setFailure(errorText(error)),
    );
  };

  return (
    <>
      <span
        ref={anchor}
        className="workspace-footer-split"
        data-open={card.open || undefined}
      >
        <button
          type="button"
          aria-label={`Open in ${app.name}`}
          title={failure ?? `Open in ${app.name}`}
          onClick={() => open(app)}
        >
          <AppIcon app={app} />
        </button>
        <button
          type="button"
          className="workspace-footer-split-arrow"
          aria-label="Open in…"
          aria-haspopup="dialog"
          aria-expanded={card.open}
          onClick={card.toggle}
        >
          <ChevronDown size={10} strokeWidth={2} aria-hidden />
        </button>
      </span>
      <HoverCard
        state={card}
        anchor={anchor}
        side="top"
        align="end"
        width={240}
        label="Open in"
      >
        <div className="hover-card-menu" role="menu">
          {apps.map((item) => (
            <button
              type="button"
              role="menuitem"
              key={item.id}
              className="hover-card-menu-item"
              onClick={() => open(item)}
            >
              <AppIcon app={item} />
              {item.name}
            </button>
          ))}
          <div
            className="hover-card-separator"
            style={{ margin: "6px -6px" }}
          />
          <button
            type="button"
            role="menuitem"
            className="hover-card-menu-item workspace-footer-menu-plain"
            onClick={() => {
              card.close();
              copyText(cwd).catch((error: unknown) =>
                logError("Couldn't copy the path", error),
              );
            }}
          >
            Copy path
          </button>
        </div>
      </HoverCard>
    </>
  );
}

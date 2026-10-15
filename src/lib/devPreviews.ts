import {
  createDevOutputScanner,
  type DevOutputScanner,
  type DevOutputSignal,
  type DevServerAddress,
  type DevServerStrength,
} from "./devServerUrls";
import { logError } from "./errors";
import type { HarnessEvent } from "./harness/types";
import { isEqualOrInside, pathKey } from "./paths";
import { looksLikeProject } from "./recents";
import { SETTINGS } from "./settingDefinitions";

/**
 * Dev servers Aven noticed in terminals and agent shell commands, one per
 * project and port. Kept in memory only: a server never outlives this window's
 * terminals or agents, and a dismissal or open applies to one server start.
 */

export type DevPreviewSource = "terminal" | "agent";
/** Where a ready preview is offered: near the chat, or in the terminal panel. */
export type DevPreviewPlacement = "chat" | "terminal";

export type DevPreview = {
  /** Project and port; one entry per server however often it is announced. */
  key: string;
  project: string;
  /** Where the command ran: a terminal's folder or the agent's checkout. */
  cwd: string;
  url: string;
  label: string;
  port: number;
  strength: DevServerStrength;
  source: DevPreviewSource;
  /** `terminal:<id>` or `agent:<session id>`; stops apply to their own source. */
  sourceId: string;
  sessionId?: string;
  placement: DevPreviewPlacement;
  /** Stale once the server stopped. The user's browser tab stays open. */
  status: "live" | "stale";
  /** Counts server starts on this port, so each start is offered again. */
  start: number;
  detectedAt: number;
  dismissed: boolean;
  opened: boolean;
  /** Open without asking: the setting was on and the line named a page. */
  autoOpen: boolean;
};

export type DevServerReport = {
  project: string;
  cwd: string;
  address: DevServerAddress;
  source: DevPreviewSource;
  sourceId: string;
  sessionId?: string;
  placement: DevPreviewPlacement;
};

const MAX_PREVIEWS = 24;

let previews: readonly DevPreview[] = [];
const listeners = new Set<() => void>();

function commit(next: readonly DevPreview[]) {
  previews = next;
  for (const listener of [...listeners]) listener();
}

export function subscribeDevPreviews(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function devPreviewsSnapshot(): readonly DevPreview[] {
  return previews;
}

export function devPreviewKey(project: string, port: number): string {
  return `${pathKey(project)}\n${port}`;
}

export function terminalPreviewSource(terminalId: string): string {
  return `terminal:${terminalId}`;
}

export function agentPreviewSource(sessionId: string): string {
  return `agent:${sessionId}`;
}

/** A server started in the project, or in a folder inside it. */
export function previewBelongsTo(
  preview: Pick<DevPreview, "project" | "cwd">,
  project: string,
): boolean {
  if (!project) return false;
  if (pathKey(preview.project) === pathKey(project)) return true;
  return (
    looksLikeProject(project) &&
    (isEqualOrInside(preview.project, project) ||
      isEqualOrInside(preview.cwd, project))
  );
}

function autoOpenEnabled(): boolean {
  return SETTINGS.devPreviewAutoOpen.load();
}

/** Stopped servers are forgotten first, oldest first. */
function bounded(list: DevPreview[]): DevPreview[] {
  if (list.length <= MAX_PREVIEWS) return list;
  const drop = new Set(
    list
      .filter((preview) => preview.status === "stale")
      .slice(0, list.length - MAX_PREVIEWS),
  );
  const kept = list.filter((preview) => !drop.has(preview));
  return kept.slice(Math.max(0, kept.length - MAX_PREVIEWS));
}

/**
 * Record a server announcement. Repeats while it runs change nothing; an
 * announcement after it stopped is a new start, offered (and opened) again.
 */
export function reportDevServer(
  report: DevServerReport,
  now = Date.now(),
): DevPreview {
  const { address } = report;
  const key = devPreviewKey(report.project, address.port);
  const existing = previews.find((preview) => preview.key === key);
  if (existing?.status === "live") {
    if (existing.strength === "strong" || address.strength === "weak")
      return existing;
    // A framework's own address line names the page better than an earlier
    // "listening on port" notice from the same server.
    const upgraded: DevPreview = {
      ...existing,
      url: address.url,
      label: address.label,
      strength: "strong",
      autoOpen: existing.autoOpen || autoOpenEnabled(),
    };
    commit(
      previews.map((preview) => (preview.key === key ? upgraded : preview)),
    );
    return upgraded;
  }
  const preview: DevPreview = {
    key,
    project: report.project,
    cwd: report.cwd,
    url: address.url,
    label: address.label,
    port: address.port,
    strength: address.strength,
    source: report.source,
    sourceId: report.sourceId,
    ...(report.sessionId ? { sessionId: report.sessionId } : {}),
    placement: report.placement,
    status: "live",
    start: (existing?.start ?? 0) + 1,
    detectedAt: now,
    dismissed: false,
    opened: false,
    autoOpen: address.strength === "strong" && autoOpenEnabled(),
  };
  commit(bounded([...previews.filter((entry) => entry.key !== key), preview]));
  return preview;
}

/** Mark a source's servers stale: all of them, or only these ports. */
export function stopDevServers(
  sourceId: string,
  ports?: Iterable<number>,
): void {
  const only = ports ? new Set(ports) : null;
  let changed = false;
  const next = previews.map((preview) => {
    if (
      preview.status !== "live" ||
      preview.sourceId !== sourceId ||
      (only && !only.has(preview.port))
    )
      return preview;
    changed = true;
    return { ...preview, status: "stale" as const };
  });
  if (changed) commit(next);
}

function patchPreview(key: string, patch: Partial<DevPreview>) {
  let changed = false;
  const next = previews.map((preview) => {
    if (
      preview.key !== key ||
      Object.entries(patch).every(
        ([field, value]) => preview[field as keyof DevPreview] === value,
      )
    )
      return preview;
    changed = true;
    return { ...preview, ...patch };
  });
  if (changed) commit(next);
}

export function dismissDevPreview(key: string): void {
  patchPreview(key, { dismissed: true });
}

/**
 * The preview a chip offers for a project: running servers first, pages
 * before bare ports, newest first. A stopped server is shown (quietly) only
 * while it is still the latest one the project announced.
 */
export function chipPreview(
  list: readonly DevPreview[],
  project: string,
  placement: DevPreviewPlacement,
): DevPreview | undefined {
  let best: DevPreview | undefined;
  let latest = 0;
  for (const preview of list) {
    if (preview.placement !== placement || !previewBelongsTo(preview, project))
      continue;
    latest = Math.max(latest, preview.detectedAt);
    if (preview.dismissed || preview.opened) continue;
    if (!best || rank(preview) > rank(best)) best = preview;
  }
  if (best?.status === "stale" && best.detectedAt < latest) return undefined;
  return best;
}

function rank(preview: DevPreview): number {
  return (
    (preview.status === "live" ? 4e13 : 0) +
    (preview.strength === "strong" ? 2e13 : 0) +
    preview.detectedAt
  );
}

/** Live servers in this project that should open without asking. */
export function pendingAutoOpen(
  list: readonly DevPreview[],
  project: string,
): DevPreview[] {
  return list.filter(
    (preview) =>
      preview.status === "live" &&
      preview.autoOpen &&
      !preview.opened &&
      !preview.dismissed &&
      previewBelongsTo(preview, project),
  );
}

export type DevPreviewOpenRequest = {
  /** The chat to show it beside; the active chat when absent. */
  requesterSessionId?: string;
  /** Opened by the setting rather than a click: never take over a pane in use. */
  automatic?: boolean;
};

export type DevPreviewOpener = (
  preview: DevPreview,
  request: DevPreviewOpenRequest,
) => boolean;

let opener: DevPreviewOpener | null = null;

/** The workspace window shows previews; other windows only offer them. */
export function installDevPreviewOpener(next: DevPreviewOpener): () => void {
  opener = next;
  return () => {
    if (opener === next) opener = null;
  };
}

/** Show a preview beside the chat. Returns whether the workspace opened it. */
export function openDevPreview(
  key: string,
  request: DevPreviewOpenRequest = {},
): boolean {
  const preview = previews.find((entry) => entry.key === key);
  if (!preview || !opener) return false;
  let opened = false;
  try {
    opened = opener(preview, request);
  } catch (error) {
    logError("Could not open the dev preview", error);
  }
  if (opened) patchPreview(key, { opened: true });
  return opened;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function sameServer(a: URL, b: URL): boolean {
  if (a.protocol !== b.protocol || a.port !== b.port) return false;
  const host = a.hostname.toLowerCase();
  const other = b.hostname.toLowerCase();
  return (
    host === other || (LOOPBACK_HOSTS.has(host) && LOOPBACK_HOSTS.has(other))
  );
}

/** A browser tab already showing this server, on any of its pages. */
export function previewTabMatch<T extends { id: string; url: string }>(
  tabs: readonly T[],
  previewUrl: string,
  preferredId?: string | null,
): T | undefined {
  let target: URL;
  try {
    target = new URL(previewUrl);
  } catch {
    return undefined;
  }
  const matches = (tab: T) => {
    try {
      return sameServer(new URL(tab.url), target);
    } catch {
      return false;
    }
  };
  const preferred = tabs.find((tab) => tab.id === preferredId);
  return preferred && matches(preferred) ? preferred : tabs.find(matches);
}

/** Per-turn context for agents with Aven's browser: what is already running. */
export function devPreviewPromptLine(context: {
  cwd: string;
  sessionId?: string;
}): string | undefined {
  const live = previews
    .filter(
      (preview) =>
        preview.status === "live" &&
        ((context.sessionId && preview.sessionId === context.sessionId) ||
          previewBelongsTo(preview, context.cwd) ||
          (looksLikeProject(preview.cwd) &&
            isEqualOrInside(context.cwd, preview.cwd))),
    )
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, 3);
  if (!live.length) return undefined;
  const items = live.map((preview) => {
    const origin =
      preview.source === "terminal"
        ? "started in an Aven terminal"
        : preview.sessionId === context.sessionId
          ? "started by you"
          : "started by another chat";
    return `${preview.url} (${origin})`;
  });
  const list =
    items.length === 1
      ? `This project's dev server is running at ${items[0]}.`
      : `This project's dev servers are running at ${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}.`;
  return `<aven-preview>${list} To check visible changes, list the browser pages and reuse one already showing it, or open it once; reload after edits instead of starting another server. If it does not load, it may have stopped since.</aven-preview>`;
}

/** Feeds one terminal's output; the terminal reports when its server ended. */
export type TerminalPreviewWatch = {
  push(text: string): void;
  /**
   * The terminal's foreground program, or null for the shell. Only a program
   * giving the shell back counts as a stop: a server started with `&` never
   * held the foreground, and a script the system names as a shell never shows.
   */
  foreground(label: string | null): void;
  /** The shell exited or the terminal closed. */
  stopped(): void;
};

export function watchTerminalOutput(terminal: {
  id: string;
  project: string;
  cwd: string;
  placement: DevPreviewPlacement;
}): TerminalPreviewWatch {
  const scanner = createDevOutputScanner();
  const sourceId = terminalPreviewSource(terminal.id);
  let running = false;
  return {
    push(text) {
      for (const signal of scanner.push(text)) {
        if (signal.kind === "stopped") stopDevServers(sourceId);
        else
          reportDevServer({
            project: terminal.project,
            cwd: terminal.cwd,
            address: signal.address,
            source: "terminal",
            sourceId,
            placement: terminal.placement,
          });
      }
    },
    foreground(label) {
      if (label) running = true;
      else if (running) {
        running = false;
        stopDevServers(sourceId);
      }
    },
    stopped() {
      running = false;
      stopDevServers(sourceId);
    },
  };
}

const SHELL_KIND = /exec|shell|bash|terminal|command|process/i;
/** `kill …`, `lsof -ti:3000 | xargs kill`, `npx kill-port 3000`, "Kill the dev server". */
const KILL_COMMAND =
  /(?:^|[|;&]\s*|\bxargs\s+(?:-\S+\s+)*|\bsudo\s+|\$\(\s*)(?:kill|pkill|killall)\b|\bkill-port\b|\bfuser\b.*\s-k\b|\bkill ?shell\b|^(?:kill|stop)\b.*\b(?:server|dev|preview|port)\b/i;
const KILLED_SHELL = /\bkilled shell\b/i;
const PORT_MENTION = /(?::|\bport\s+|\s)(\d{2,5})\b/g;
/** Output beyond this per command is logs; servers announce themselves early. */
const MAX_TOOL_SCAN = 256 * 1024;
const MAX_TOOL_WATCHES = 64;
const PREVIOUS_HEAD = 4_096;
const MIN_CUMULATIVE = 16;

type ToolWatch = {
  kind?: string;
  title?: string;
  scanner?: DevOutputScanner;
  previousHead: string;
  previousLength: number;
  updates: number;
  scanned: number;
  ports: Set<number>;
};

const toolWatches = new Map<string, ToolWatch>();

export type AgentPreviewPlace = { project: string; cwd: string };

/**
 * Some providers resend a command's whole output with each update; others
 * send only new text. Scan just what this update adds.
 */
function unseenOutput(
  watch: ToolWatch,
  detail: string,
  finished: boolean,
): string {
  const { previousHead, previousLength } = watch;
  watch.previousHead = detail.slice(0, PREVIOUS_HEAD);
  watch.previousLength = detail.length;
  watch.updates += 1;
  if (
    previousLength >= MIN_CUMULATIVE &&
    detail.length >= previousLength &&
    detail.startsWith(previousHead)
  )
    return detail.slice(previousLength);
  // A final summary after streamed chunks repeats output already scanned.
  if (finished && watch.updates > 1) return "";
  return detail;
}

function stopAgentServers(sessionId: string, title: string) {
  const source = agentPreviewSource(sessionId);
  const live = new Set(
    previews
      .filter(
        (preview) => preview.status === "live" && preview.sourceId === source,
      )
      .map((preview) => preview.port),
  );
  const named = [...title.matchAll(PORT_MENTION)]
    .map((match) => Number(match[1]))
    .filter((port) => live.has(port));
  stopDevServers(source, named.length ? named : undefined);
}

function forgetSessionWatches(sessionId: string) {
  const prefix = `${sessionId}\n`;
  for (const key of [...toolWatches.keys()])
    if (key.startsWith(prefix)) toolWatches.delete(key);
}

/**
 * Watch an agent's shell commands for dev servers. Called for every harness
 * event, so anything that is not shell output returns at once; output is
 * scanned incrementally and assistant text is never examined.
 */
export function observeAgentPreviewEvent(
  sessionId: string,
  event: HarnessEvent,
  /** The session's project and checkout; looked up only when a server is found. */
  place: (sessionId: string) => AgentPreviewPlace | undefined,
): void {
  if (event.type === "session.ended") {
    forgetSessionWatches(sessionId);
    stopDevServers(agentPreviewSource(sessionId));
    return;
  }
  if (event.type !== "tool.started" && event.type !== "tool.updated") return;
  const watchKey = `${sessionId}\n${event.callId}`;
  let watch = toolWatches.get(watchKey);
  const kind = event.kind ?? watch?.kind;
  const shell =
    (!!kind && SHELL_KIND.test(kind)) || event.preview?.kind === "shell";
  const finished =
    event.type === "tool.updated" &&
    (event.status === "completed" || event.status === "failed");
  if (!shell) {
    if (watch) toolWatches.delete(watchKey);
    return;
  }
  if (!watch) {
    watch = {
      previousHead: "",
      previousLength: 0,
      updates: 0,
      scanned: 0,
      ports: new Set(),
    };
    toolWatches.set(watchKey, watch);
    if (toolWatches.size > MAX_TOOL_WATCHES) {
      const oldest = toolWatches.keys().next().value;
      if (oldest !== undefined) toolWatches.delete(oldest);
    }
  }
  watch.kind = kind;
  if (event.title) watch.title = event.title;
  const signals: DevOutputSignal[] = [];
  const detail = event.type === "tool.updated" ? event.detail : undefined;
  if (detail) {
    const fresh = unseenOutput(watch, detail, finished);
    if (fresh && watch.scanned < MAX_TOOL_SCAN) {
      watch.scanner ??= createDevOutputScanner();
      watch.scanned += fresh.length;
      signals.push(...watch.scanner.push(fresh));
    }
  }
  if (finished) {
    if (watch.scanner) signals.push(...watch.scanner.finish());
    toolWatches.delete(watchKey);
  }
  const source = agentPreviewSource(sessionId);
  if (finished) {
    const title = watch.title ?? "";
    if (
      event.status === "completed" &&
      (KILL_COMMAND.test(title) || KILLED_SHELL.test(detail ?? ""))
    ) {
      stopAgentServers(sessionId, title);
      return;
    }
    // A finished read of a process that already ended (a background shell's
    // final output) holds both the address and its stop.
    if (signals.some((signal) => signal.kind === "stopped")) {
      const ports = [...watch.ports];
      for (const signal of signals)
        if (signal.kind === "address") ports.push(signal.address.port);
      if (ports.length) stopDevServers(source, ports);
      return;
    }
  }
  for (const signal of signals) {
    if (signal.kind === "stopped") {
      if (watch.ports.size) stopDevServers(source, watch.ports);
      continue;
    }
    const where = place(sessionId);
    if (!where) return;
    watch.ports.add(signal.address.port);
    reportDevServer({
      project: where.project,
      cwd: where.cwd,
      address: signal.address,
      source: "agent",
      sourceId: source,
      sessionId,
      placement: "chat",
    });
  }
}

/** Tests only: start from an empty store. */
export function resetDevPreviews(): void {
  previews = [];
  toolWatches.clear();
  opener = null;
  for (const listener of [...listeners]) listener();
}

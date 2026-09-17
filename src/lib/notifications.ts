import { invoke } from "@tauri-apps/api/core";
import { HARNESS_TITLE, sessionDisplayTitle, type Session } from "./session";
import { loadSoundsEnabled } from "./sounds";
import { recordActivity, type ActivityOutcome } from "./activity";

const KEY = "monocode.notifications";

/** Off until the user opts in; enabling asks the OS for permission. */
export const NOTIFICATIONS_DEFAULT = false;

export const NOTIFICATIONS_CHANGE_EVENT = "monocode:notifications-change";

/** Rust emits this with the session id when a notification is clicked. */
export const NOTIFICATION_CLICK_EVENT = "monocode:notification-click";

export type NotificationPermission =
  "prompt" | "granted" | "denied" | "unsupported";

export function loadNotificationsEnabled(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw == null) return NOTIFICATIONS_DEFAULT;
    return raw === "1" || raw === "true";
  } catch {
    return NOTIFICATIONS_DEFAULT;
  }
}

export function saveNotificationsEnabled(value: boolean) {
  try {
    localStorage.setItem(KEY, value ? "1" : "0");
  } catch {
    // private mode / quota
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<boolean>(NOTIFICATIONS_CHANGE_EVENT, { detail: value }),
  );
}

let permission: NotificationPermission = "prompt";

/** Last permission the OS reported; refreshed by the probes below. */
export function cachedNotificationPermission(): NotificationPermission {
  return permission;
}

export async function probeNotificationPermission(): Promise<NotificationPermission> {
  try {
    permission = await invoke<NotificationPermission>(
      "notification_permission",
    );
  } catch {
    permission = "unsupported";
  }
  return permission;
}

/** Shows the OS prompt when undecided; otherwise reports the current state. */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  try {
    permission = await invoke<NotificationPermission>(
      "request_notification_permission",
    );
  } catch {
    permission = "unsupported";
  }
  return permission;
}

export function openNotificationSettings(): Promise<void> {
  return invoke<void>("open_notification_settings");
}

/**
 * Tracked from Tauri's focus event rather than `document.hasFocus()`, which
 * WKWebView keeps reporting true after the window drops to the background.
 */
let windowFocused =
  typeof document !== "undefined" ? document.hasFocus() : true;

export function setWindowFocused(focused: boolean) {
  windowFocused = focused;
}

/**
 * A banner only earns its place while the user is looking elsewhere: another
 * app, or another session. The transcript already shows the change on the
 * session that is on screen.
 */
export function shouldNotify({
  enabled,
  permission,
  windowFocused,
  sessionVisible,
}: {
  enabled: boolean;
  permission: NotificationPermission;
  windowFocused: boolean;
  sessionVisible: boolean;
}): boolean {
  if (!enabled || (windowFocused && sessionVisible)) return false;
  return permission === "granted" || permission === "prompt";
}

export type NotificationEvent = ActivityOutcome | "finished" | "needsInput";
export type SessionActivityEvent = {
  /** Turn ID or request ID, qualified by session; stable across repeat renders. */
  id: string;
  outcome: ActivityOutcome;
  summary?: string;
  occurredAt?: number;
};
export type NotificationPreferences = {
  needsInput: boolean;
  failures: boolean;
  finished: boolean;
  sound: boolean;
  quiet: boolean;
};
export const NOTIFICATION_PREFERENCES_EVENT =
  "monocode:notification-preferences-change";
const PREFERENCES_KEY = "monocode.notification-preferences.v1";
export const DEFAULT_NOTIFICATION_PREFERENCES: Readonly<NotificationPreferences> =
  {
    needsInput: true,
    failures: true,
    finished: true,
    sound: true,
    quiet: false,
  };
export function loadNotificationPreferences(): NotificationPreferences {
  const result = { ...DEFAULT_NOTIFICATION_PREFERENCES };
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? "null");
    for (const key of Object.keys(
      result,
    ) as (keyof NotificationPreferences)[]) {
      if (typeof parsed?.[key] === "boolean") result[key] = parsed[key];
    }
  } catch {
    /* Defaults still retain every outcome in Activity. */
  }
  return result;
}
export function saveNotificationPreferences(
  patch: Partial<NotificationPreferences>,
) {
  const next = { ...loadNotificationPreferences(), ...patch };
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
  if (typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent(NOTIFICATION_PREFERENCES_EVENT, { detail: next }),
    );
}
export function activityInterruptionsEnabled(
  outcome: ActivityOutcome,
  prefs = loadNotificationPreferences(),
): boolean {
  if (prefs.quiet) return false;
  if (outcome === "approval" || outcome === "question") return prefs.needsInput;
  if (outcome === "failed") return prefs.failures;
  return prefs.finished;
}

export function sessionTurnActivityId(session: Session): string {
  const users = [...session.blocks]
    .reverse()
    .filter((block) => block.role === "user");
  const user =
    users.find((block) => block.startedAt !== undefined || block.turnModel) ??
    users[0];
  return `${session.id}:turn:${user?.id ?? "initial"}`;
}
/** Each request gets its own identity, including consecutive requests in one turn. */
export function pendingSessionActivityEvents(
  session: Session,
): SessionActivityEvent[] {
  if (session.inboxAsk) return [];
  const turn = sessionTurnActivityId(session);
  const events: SessionActivityEvent[] = session.blocks.flatMap((block) =>
    block.approval && !block.approval.decided
      ? [
          {
            id: `${turn}:approval:${block.id}:${block.approval.requestId}`,
            outcome: "approval" as const,
            summary: clip(
              `Approve: ${block.tool?.title || block.text || HARNESS_TITLE[session.harness]}`,
            ),
          },
        ]
      : [],
  );
  if (session.pendingQuestion)
    events.push({
      id: `${turn}:question:${session.pendingQuestion.requestId}`,
      outcome: "question",
      summary: clip(
        session.pendingQuestion.title ||
          session.pendingQuestion.questions[0]?.prompt ||
          `${HARNESS_TITLE[session.harness]} has a question for you`,
      ),
    });
  return events;
}

/** App name, then the session title, then the reply itself. */
export type NotificationText = {
  title: string;
  subtitle: string;
  body: string;
};

const BODY_MAX = 240;

export function notificationText(
  session: Session,
  event: NotificationEvent,
): NotificationText {
  const title = "Aven";
  const subtitle = sessionDisplayTitle(session.title, session.harness);
  const harness = HARNESS_TITLE[session.harness];
  if (event === "needsInput" || event === "approval" || event === "question") {
    const question = session.pendingQuestion;
    if (question && event !== "approval") {
      const prompt = question.title || question.questions[0]?.prompt;
      return {
        title,
        subtitle,
        body: clip(prompt || `${harness} has a question for you`),
      };
    }
    const pending = [...session.blocks]
      .reverse()
      .find((block) => block.approval && !block.approval.decided);
    const what = pending?.tool?.title || pending?.text;
    return {
      title,
      subtitle,
      body: clip(what ? `Approve: ${what}` : `${harness} needs your approval`),
    };
  }
  if (event === "failed")
    return {
      title,
      subtitle,
      body: `${harness} could not finish. Open the task for details.`,
    };
  if (event === "stopped")
    return { title, subtitle, body: `${harness} stopped before finishing` };
  const reply = [] as Session["blocks"];
  for (let index = session.blocks.length - 1; index >= 0; index--) {
    const block = session.blocks[index];
    if (block.role === "user") break;
    if (block.role === "assistant" && block.text.trim()) {
      reply.push(block);
      break;
    }
  }
  return {
    title,
    subtitle,
    body: clip(reply[0]?.text || `${harness} finished`),
  };
}

/** First paragraph, whitespace collapsed; macOS wraps and truncates the rest. */
function clip(text: string): string {
  const paragraph =
    text
      .split(/\n\s*\n/)
      .map((part) => part.replace(/\s+/g, " ").trim())
      .find((part) => part.length > 0) ?? "";
  return paragraph.length > BODY_MAX
    ? `${paragraph.slice(0, BODY_MAX - 1)}…`
    : paragraph;
}

/** Local history never depends on notification permission or delivery success. */
export async function publishSessionActivity(
  session: Session,
  event: SessionActivityEvent,
  sessionVisible: boolean,
  presentationFocused = windowFocused,
): Promise<{ added: boolean; bannerSent: boolean; playSound: boolean }> {
  const quietResult = { added: false, bannerSent: false, playSound: false };
  if (session.inboxAsk) return quietResult;
  const text = notificationText(session, event.outcome);
  const body = event.summary ? clip(event.summary) : text.body;
  const turnModel = [...session.blocks]
    .reverse()
    .find((block) => block.role === "user" && block.turnModel)?.turnModel;
  const recorded = recordActivity(
    {
      id: event.id,
      sessionId: session.id,
      outcome: event.outcome,
      title: text.subtitle,
      summary: body,
      cwd: session.cwd,
      harness: turnModel?.harness ?? session.harness,
      model: turnModel?.model ?? session.model,
      createdAt: event.occurredAt,
    },
    presentationFocused && sessionVisible,
  );
  if (!recorded.added) return quietResult;
  const prefs = loadNotificationPreferences();
  const interrupts = activityInterruptionsEnabled(event.outcome, prefs);
  // Only successful completion has a success cue. Failure/stop never reuse it.
  const playSound =
    event.outcome === "completed" &&
    interrupts &&
    prefs.sound &&
    loadSoundsEnabled();
  if (
    !interrupts ||
    !shouldNotify({
      enabled: loadNotificationsEnabled(),
      permission,
      windowFocused: presentationFocused,
      sessionVisible,
    })
  ) {
    return { added: true, bannerSent: false, playSound };
  }
  try {
    await invoke("show_notification", {
      sessionId: session.id,
      title: text.title,
      subtitle: text.subtitle,
      body,
      sound: prefs.sound && loadSoundsEnabled(),
    });
    return { added: true, bannerSent: true, playSound: false };
  } catch {
    return { added: true, bannerSent: false, playSound };
  }
}

/** Compatibility for callers migrating to explicit per-turn/per-request identities. */
export async function notifySession(
  session: Session,
  event: NotificationEvent,
  sessionVisible: boolean,
): Promise<boolean> {
  const outcome =
    event === "finished"
      ? "completed"
      : event === "needsInput"
        ? session.pendingQuestion
          ? "question"
          : "approval"
        : event;
  const pending = pendingSessionActivityEvents(session).find(
    (item) => item.outcome === outcome,
  );
  const result = await publishSessionActivity(
    session,
    pending ?? {
      id: `${sessionTurnActivityId(session)}:${outcome}`,
      outcome,
    },
    sessionVisible,
  );
  return result.bannerSent;
}

import { reviewHeading } from "./automationReview";
import { avosJobRuns, avosJobs } from "./avosJobs";
import {
  cardBuilder,
  cardChecker,
  cardSecurity,
  crewCard,
  crewLead,
  crewMember,
  crewMemberById,
  isTime,
  memberCritter,
  type Crew,
  type CrewFeedAction,
  type CrewFeedEntry,
  type CrewMember,
  type CrewMessageFrom,
  type CrewMessageKind,
  type CrewRole,
} from "./crews";
import {
  describeSchedule,
  type ScheduledAgent,
  type ScheduledRun,
} from "./scheduledAgents";

/**
 * The team chat's thread: the team's Feed read as short posts by the
 * teammate who did each thing (a handoff, a verdict, ideas, a question),
 * with your own messages among them, and what Aven said as quiet lines.
 * Worked out from the store alone, so it can be tested without rendering.
 * Nothing here is ever raw JSON: every post is the Feed's plain words.
 */

/** A teammate as a post names it: its id, role, mark and name. */
export type TeamAuthor = {
  id: string;
  role: CrewRole;
  /** Its mark, when it isn't its role's. */
  critter?: string;
  name: string;
};

/** Work passed on: "Builder → Checker", "Back to Builder · round 2". */
export type TeamHandoff = {
  from: TeamAuthor;
  /** The teammate it went to, or you (Ready for you). */
  to: TeamAuthor | "you";
  label: string;
};

export type TeamPost =
  | {
      kind: "post";
      id: string;
      at: number;
      author: TeamAuthor;
      text: string;
      /** The card it is about. */
      card?: string;
      handoff?: TeamHandoff;
      /** It waits on you (a question). */
      needsYou?: boolean;
      /** What it offers you: Set up Git, when building needs it. */
      action?: CrewFeedAction;
    }
  | {
      kind: "you";
      id: string;
      at: number;
      text: string;
      /** The teammate you wrote to; none for everyone. */
      to?: TeamAuthor;
      /** What a message to everyone became. */
      as?: CrewMessageKind;
      /** The chat you wrote it from with @Avos. */
      from?: CrewMessageFrom;
    }
  | {
      kind: "event";
      id: string;
      at: number;
      text: string;
      /** The teammate it is about, when it is about one. */
      about?: string;
      needsYou?: boolean;
    }
  | {
      /** A job the team keeps: "Keeping an eye on … · <schedule> · Change". */
      kind: "job";
      id: string;
      at: number;
      /** The automation it is. */
      jobId: string;
      name: string;
      schedule: string;
      /** "Keeping an eye on “…”", for a screen reader and a search. */
      text: string;
      /** The Lead that keeps it, for its posts alone. */
      by?: string;
    }
  | {
      /**
       * A job's run that needs you: the card it left (a draft to publish),
       * or its latest run failing.
       */
      kind: "run";
      id: string;
      at: number;
      run: ScheduledRun;
      /** "Ready to publish: …", or what went wrong. */
      text: string;
      failed?: boolean;
      needsYou: true;
      by?: string;
    };

/** The team's jobs and their runs, from the automations store. */
export type TeamJobs = {
  agents: readonly ScheduledAgent[];
  runs: readonly ScheduledRun[];
};

export type TeamDay = { key: string; label: string; posts: TeamPost[] };

/** A post's words: one paragraph, as plain as the Feed's, never too long. */
const POST_MAX = 600;

function plain(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > POST_MAX
    ? `${flat.slice(0, POST_MAX).replace(/\s+\S*$/, "")}…`
    : flat;
}

/**
 * Aven's and your lines as they read now: ones saved before the crew was
 * called a team ("You gave the crew …") say team. What comes after the
 * first colon may be someone's own words, so it stays; so do a quoted
 * title, a file's name (crews.ts) and a branch's (aven/bot/crew-…).
 */
export function teamWording(text: string): string {
  let spoken = false;
  return text
    .split(/(“[^”]*”)/)
    .map((part) => {
      if (spoken || part.startsWith("“")) return part;
      const colon = part.indexOf(": ");
      if (colon >= 0) spoken = true;
      const words = colon >= 0 ? part.slice(0, colon) : part;
      return (
        words
          .replace(
            /(?<![\w/.-])([Cc])rew(s?)(?![\w/-]|\.\w)/g,
            (_match, c: string, plural: string) =>
              `${c === "C" ? "T" : "t"}eam${plural}`,
          )
          // The team is Avos now.
          .replace(/(?<![\w/.-])[Tt]he team('s)?(?![\w/-])/g, "Avos$1") +
        (colon >= 0 ? part.slice(colon) : "")
      );
    })
    .join("");
}

/** "Builder started “X”" from Builder: "Started “X”". */
function withoutName(text: string, name: string): string {
  for (const lead of [`${name} `, `${name}'s `]) {
    if (!text.startsWith(lead)) continue;
    const rest = text.slice(lead.length);
    if (!rest || lead.endsWith("'s ")) return text;
    return rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  return text;
}

function author(
  member: CrewMember | undefined,
  role: CrewRole,
  id: string,
  name: (who: string) => string,
): TeamAuthor {
  const critter = member?.critter ? memberCritter(member) : undefined;
  return {
    id: member?.id ?? id,
    role: member?.role ?? role,
    ...(critter ? { critter } : {}),
    name: name(member?.id ?? id),
  };
}

const ROLES = new Set<string>([
  "lead",
  "builder",
  "checker",
  "security",
  "scout",
  "researcher",
  "designer",
  "fixer",
]);

/** The teammate a Feed entry is by: the member it names, else its role's first. */
function entryAuthor(
  crew: Crew,
  entry: CrewFeedEntry,
  name: (who: string) => string,
): TeamAuthor | undefined {
  if (!entry.who || !ROLES.has(entry.who)) return undefined;
  const role = entry.who as CrewRole;
  const member =
    crewMemberById(crew, entry.member) ??
    (entry.member ? undefined : crewMember(crew, role));
  return author(member, role, entry.member ?? role, name);
}

/** Who a handoff or verdict went to: its card's Checker, Security or Builder. */
function handedTo(
  crew: Crew,
  entry: CrewFeedEntry,
  name: (who: string) => string,
): TeamAuthor | undefined {
  if (!entry.to) return undefined;
  const card = entry.cardId ? crewCard(crew, entry.cardId) : undefined;
  const member =
    entry.to === "checker"
      ? (crewMemberById(crew, card?.checkerId) ??
        (card ? cardChecker(crew, card) : crewMember(crew, "checker")))
      : entry.to === "security"
        ? cardSecurity(crew)
        : entry.to === "builder"
          ? (crewMemberById(crew, card?.builderId) ??
            (card ? cardBuilder(crew, card) : crewMember(crew, "builder")))
          : crewMember(crew, entry.to);
  return author(member, entry.to, entry.to, name);
}

/** Your own words, as the Feed kept them before messages: a rule, a nudge. */
function yourWords(entry: CrewFeedEntry): boolean {
  return (
    entry.who === "you" &&
    entry.kind === "note" &&
    !entry.cardId &&
    !entry.member &&
    !entry.text.startsWith("You ")
  );
}

/** One Feed entry as the thread shows it, or null when it isn't shown. */
function postOf(
  crew: Crew,
  entry: CrewFeedEntry,
  name: (who: string) => string,
  rules: ReadonlySet<string>,
  /** Whether this stuck line still waits on you. */
  waiting: (entry: CrewFeedEntry) => boolean,
): TeamPost | null {
  if (entry.who === "you") {
    if (yourWords(entry))
      return {
        kind: "you",
        id: entry.id,
        at: entry.at,
        text: entry.text,
        ...(rules.has(`${entry.at}\n${entry.text}`)
          ? { as: "rule" as const }
          : {}),
      };
    return {
      kind: "event",
      id: entry.id,
      at: entry.at,
      text: plain(teamWording(entry.text)),
      ...(entry.member ? { about: entry.member } : {}),
    };
  }
  const by = entryAuthor(crew, entry, name);
  if (!by)
    return {
      kind: "event",
      id: entry.id,
      at: entry.at,
      text: plain(teamWording(entry.text)),
      ...(entry.member ? { about: entry.member } : {}),
      ...(entry.kind === "stuck" && waiting(entry) ? { needsYou: true } : {}),
    };
  const base = {
    kind: "post" as const,
    id: entry.id,
    at: entry.at,
    author: by,
    ...(entry.title ? { card: entry.title } : {}),
    ...(entry.action ? { action: entry.action } : {}),
  };
  const round = entry.round ?? 1;
  switch (entry.kind) {
    case "handoff": {
      const to = handedTo(crew, entry, name);
      return {
        ...base,
        text: plain(withoutName(entry.text, by.name)),
        ...(to
          ? {
              handoff: {
                from: by,
                to,
                label:
                  round > 1
                    ? `Handed to ${to.name} · round ${round}`
                    : `Handed to ${to.name}`,
              },
            }
          : {}),
      };
    }
    case "verdict": {
      const to = handedTo(crew, entry, name);
      return {
        ...base,
        text: plain(entry.text),
        ...(to
          ? {
              handoff: {
                from: by,
                to,
                label: `Back to ${to.name} · round ${round + 1}`,
              },
            }
          : {}),
      };
    }
    case "ready": {
      const secured = entry.who === "security";
      const what = entry.title ?? "It";
      return {
        ...base,
        text: `${what} passed ${secured ? "the check and the security review" : "the check"} in round ${round}. It's ready for you.`,
        handoff: { from: by, to: "you", label: "Ready for you" },
      };
    }
    case "stuck":
      return {
        ...base,
        text: plain(entry.text),
        ...(waiting(entry) ? { needsYou: true } : {}),
      };
    // "Researcher read 6 sources for “…”: …", handed to you as Findings.
    case "findings":
      return {
        ...base,
        text: plain(withoutName(entry.text, by.name)),
        handoff: { from: by, to: "you", label: "Findings for you" },
      };
    // "Designer mocked up “…”", handed to you to look at.
    case "mockup":
      return {
        ...base,
        text: plain(withoutName(entry.text, by.name)),
        handoff: { from: by, to: "you", label: "Mock-up for you" },
      };
    // The Lead answers you; teammates talking to each other stay quiet.
    case "say":
      return by.role === "lead"
        ? { ...base, text: plain(entry.text) }
        : {
            kind: "event",
            id: entry.id,
            at: entry.at,
            text: plain(entry.text),
          };
    default:
      return { ...base, text: plain(withoutName(entry.text, by.name)) };
  }
}

/**
 * Every post, oldest first: the Feed's entries and your messages, by time
 * (your message first when they share a moment, as you wrote it first).
 * The Feed's own line for a message ("You gave Avos …", its `echo`) is
 * left out: your message says it. Everything else stays.
 */
export function teamPosts(
  crew: Crew,
  name: (who: string) => string,
  jobs?: TeamJobs,
): TeamPost[] {
  const messages = crew.messages ?? [];
  // The Feed's own line for each message: the message says it. A message
  // saved before it named its line stands for the first line of yours at
  // its moment.
  const said = new Set(
    messages.flatMap((message) => (message.echo ? [message.echo] : [])),
  );
  for (const message of messages) {
    if (message.echo || message.to) continue;
    const line = crew.feed.find(
      (entry) =>
        entry.who === "you" && entry.at === message.at && !said.has(entry.id),
    );
    if (line) said.add(line.id);
  }
  const rules = new Set(crew.notes.map((note) => `${note.at}\n${note.text}`));
  // A card waits on you only while it is stuck, and only its latest stuck
  // line says so: an answered question is history.
  const lastStuck = new Map<string, string>();
  for (const entry of crew.feed)
    if (entry.kind === "stuck" && entry.cardId)
      lastStuck.set(entry.cardId, entry.id);
  const waiting = (entry: CrewFeedEntry) =>
    !!entry.cardId &&
    lastStuck.get(entry.cardId) === entry.id &&
    crewCard(crew, entry.cardId)?.stage === "stuck";
  const posts: TeamPost[] = [];
  for (const message of messages) {
    const to = message.to ? crewMemberById(crew, message.to) : undefined;
    posts.push({
      kind: "you",
      id: message.id,
      at: message.at,
      text: message.text,
      ...(message.to
        ? {
            to: author(to, to?.role ?? "builder", message.to, name),
          }
        : {}),
      ...(message.as && !message.to ? { as: message.as } : {}),
      ...(message.from ? { from: message.from } : {}),
    });
  }
  for (const entry of crew.feed) {
    // What you wrote, said once: your message.
    if (said.has(entry.id)) continue;
    const post = postOf(crew, entry, name, rules, waiting);
    if (post) posts.push(post);
  }
  if (jobs) posts.push(...jobPosts(crew, jobs));
  const order = (post: TeamPost) => (post.kind === "you" ? 0 : 1);
  return (
    posts
      // A moment no Date can show is left out, never drawn.
      .filter((post) => isTime(post.at))
      .map((post, index) => ({ post, index }))
      .sort(
        (a, b) =>
          a.post.at - b.post.at ||
          order(a.post) - order(b.post) ||
          a.index - b.index,
      )
      .map((item) => item.post)
  );
}

/**
 * The team's jobs, each where it was set up (after the Lead's line that
 * led to it), and their runs that need you, where each did.
 */
function jobPosts(crew: Crew, jobs: TeamJobs): TeamPost[] {
  const owned = avosJobs(crew.path, jobs.agents);
  if (!owned.length) return [];
  const lead = crewLead(crew)?.id;
  const by = lead ? { by: lead } : {};
  const posts: TeamPost[] = owned.map((agent) => ({
    kind: "job",
    id: `job:${agent.id}`,
    at: agent.createdAt,
    jobId: agent.id,
    name: agent.name,
    schedule: describeSchedule(agent.schedule),
    text: `Keeping an eye on “${agent.name}”`,
    ...by,
  }));
  for (const run of avosJobRuns(owned, jobs.runs))
    posts.push(
      run.review?.status === "open"
        ? {
            kind: "run",
            id: `run:${run.id}`,
            at: run.review.postedAt,
            run,
            text: plain(`${reviewHeading(run.review)}: ${run.review.title}`),
            needsYou: true,
            ...by,
          }
        : {
            kind: "run",
            id: `run:${run.id}:failed`,
            at: run.finishedAt ?? run.startedAt,
            run,
            text: plain(
              `“${run.name}” didn't finish${run.error ? `: ${run.error}` : "."}`,
            ),
            failed: true,
            needsYou: true,
            ...by,
          },
    );
  return posts;
}

/** Whether a post is a teammate's: its own, your message to it, or Aven's about it. */
export function postIsMember(post: TeamPost, memberId: string): boolean {
  if (post.kind === "post") return post.author.id === memberId;
  if (post.kind === "you") return post.to?.id === memberId;
  if (post.kind === "job" || post.kind === "run") return post.by === memberId;
  return post.about === memberId;
}

/** The time of each teammate's latest post, by its id. */
export function latestPosts(
  posts: readonly TeamPost[],
): ReadonlyMap<string, number> {
  const latest = new Map<string, number>();
  for (const post of posts)
    if (post.kind === "post")
      latest.set(
        post.author.id,
        Math.max(latest.get(post.author.id) ?? 0, post.at),
      );
  return latest;
}

function dayKey(at: number): string {
  if (!isTime(at)) return "";
  const date = new Date(at);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** "Today", "Yesterday", or the date. */
export function dayLabel(at: number, now: number): string {
  if (!isTime(at) || !isTime(now)) return "";
  if (dayKey(at) === dayKey(now)) return "Today";
  // The calendar day before, not 24 hours before: a day can be 23 or 25
  // hours long when the clocks change.
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey(at) === dayKey(yesterday.getTime())) return "Yesterday";
  try {
    return new Date(at).toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  } catch {
    return new Date(at).toDateString();
  }
}

/**
 * The thread as shown: one teammate's posts (or everyone's), the newest
 * `shown` of them, grouped by day. `earlier` says how many more there are.
 */
export function teamThread(
  posts: readonly TeamPost[],
  input: { now: number; member?: string | null; shown: number },
): { days: TeamDay[]; earlier: number; total: number } {
  const kept = input.member
    ? posts.filter((post) => postIsMember(post, input.member!))
    : posts;
  const shown = kept.slice(-Math.max(1, input.shown));
  const days: TeamDay[] = [];
  for (const post of shown) {
    const key = dayKey(post.at);
    const last = days.at(-1);
    if (last?.key === key) last.posts.push(post);
    else days.push({ key, label: dayLabel(post.at, input.now), posts: [post] });
  }
  return { days, earlier: kept.length - shown.length, total: kept.length };
}

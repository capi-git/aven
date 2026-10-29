import { crewStageDetail, crewStageLabel } from "./crewLoop";
import {
  CREW_ROLE_INFO,
  cardInCopy,
  crewMembers,
  type Crew,
  type CrewCard,
  type CrewIdea,
  type CrewRole,
} from "./crews";
import type { BotStatus } from "./projectBots";

/**
 * What the crew UI shows, worked out from the store alone: the sidebar's
 * one word per crew and per bot, and how a Board card looks while the crew
 * has it. Data only, so it can be compared and tested without rendering.
 */

export type CrewStatus =
  "needs-you" | "ready" | "working" | "watching" | "paused";

export const CREW_STATUS_LABEL: Readonly<Record<CrewStatus, string>> = {
  "needs-you": "Needs you",
  ready: "Ready",
  working: "Working",
  watching: "Watching",
  paused: "Paused",
};

/** The chat pill tone each status borrows (see ChatStatusPill.css). */
export const CREW_STATUS_STAGE: Readonly<Record<CrewStatus, string>> = {
  "needs-you": "needs-you",
  ready: "review",
  working: "working",
  watching: "shipped",
  paused: "shipped",
};

const FIXER_STATUS: Readonly<Record<BotStatus, CrewStatus>> = {
  "needs-you": "needs-you",
  "fix-ready": "ready",
  working: "working",
  watching: "watching",
  paused: "paused",
};

/**
 * The crew's one word, most urgent first: Needs you, Ready, Working, then
 * Paused (by you or a limit) or Watching.
 */
export function crewStatus(
  crew: Crew,
  input: { fixer?: BotStatus; busy?: ReadonlySet<string> } = {},
): CrewStatus {
  const fixer = input.fixer ? FIXER_STATUS[input.fixer] : undefined;
  const active = crew.on ? crew.cards : [];
  if (active.some((card) => card.stage === "stuck") || fixer === "needs-you")
    return "needs-you";
  if (active.some((card) => card.stage === "ready") || fixer === "ready")
    return "ready";
  const memberBusy =
    crew.on &&
    crew.members.some(
      (member) =>
        member.role !== "fixer" &&
        (!!member.doing ||
          (!!member.sessionId && !!input.busy?.has(member.sessionId))),
    );
  if (
    memberBusy ||
    active.some(
      (card) =>
        (card.stage === "building" || card.stage === "checking") &&
        !card.paused,
    ) ||
    fixer === "working"
  )
    return "working";
  if (crew.on && (crew.paused || crew.hold)) return "paused";
  if (!crew.on && fixer === "paused") return "paused";
  return "watching";
}

export type CrewMemberView = {
  role: CrewRole;
  name: string;
  /** "Builder". */
  roleLabel: string;
  status?: CrewStatus;
  /** What it is doing: "Fixing Dark mode toggle · round 2". */
  line?: string;
  sessionId?: string;
  active: boolean;
};

/**
 * Each bot as the sidebar and the crew strip list it: its name, its role,
 * and a word only while it is doing something (or waiting on you).
 */
export function crewMemberViews(
  crew: Crew,
  input: {
    name: (role: CrewRole) => string;
    fixer?: { status: BotStatus; line?: string; sessionId?: string };
  },
): CrewMemberView[] {
  const card = cardInCopy(crew);
  return crewMembers(crew)
    .filter((member) => member.role !== "fixer" || !!input.fixer)
    .filter((member) => member.role === "fixer" || crew.on)
    .map((member): CrewMemberView => {
      const base = {
        role: member.role,
        name: input.name(member.role),
        roleLabel: CREW_ROLE_INFO[member.role].label,
      };
      if (member.role === "fixer") {
        const status = FIXER_STATUS[input.fixer!.status];
        // Its line, unless it only repeats its word.
        const line =
          input.fixer!.line &&
          input.fixer!.line !== CREW_STATUS_LABEL[status] &&
          input.fixer!.line !== "Fix ready"
            ? input.fixer!.line
            : undefined;
        return {
          ...base,
          status,
          ...(line ? { line } : {}),
          ...(input.fixer!.sessionId
            ? { sessionId: input.fixer!.sessionId }
            : {}),
          active: status === "working",
        };
      }
      const holds =
        !!card &&
        card.holder === member.role &&
        (card.stage === "building" ||
          card.stage === "checking" ||
          card.stage === "stuck");
      const waiting = holds && card?.stage === "stuck";
      const working = !!member.doing || (holds && !waiting && !card?.paused);
      return {
        ...base,
        ...(waiting
          ? { status: "needs-you" as const }
          : working
            ? { status: "working" as const }
            : member.paused
              ? { status: "paused" as const }
              : {}),
        ...(waiting && card
          ? { line: card.stuck?.text ?? `Waiting on you · ${card.title}` }
          : member.doing
            ? { line: member.doing.text }
            : holds && card
              ? {
                  line: `${crewStageLabel(card)} ${card.title} · round ${card.round}`,
                }
              : {}),
        ...(member.sessionId ? { sessionId: member.sessionId } : {}),
        active: working,
      };
    });
}

// ---------------------------------------------------------------------------
// Board cards

export type CrewBoardActionId =
  | "give"
  | "not-now"
  | "watch"
  | "review"
  | "apply"
  | "more"
  | "answer"
  | "take-over"
  | "back-to-ideas"
  | "throw-away"
  | "resume"
  | "pause"
  | "stop"
  | "open";

export type CrewBoardAction = {
  id: CrewBoardActionId;
  label: string;
  primary?: boolean;
};

/** How a Board card looks while the crew has it, or offers to. */
export type CrewBoardInfo = {
  /** The column the crew's stage puts it in, whatever was saved. */
  column?: "idea" | "building" | "review" | "shipped";
  /** The critters drawn on it: who works on it, or who found it. */
  roles: CrewRole[];
  /** The bot at work on it now, whose critter moves. */
  holder?: "builder" | "checker";
  /** "Fixing", in bold, then "round 2 of 3". */
  label?: string;
  detail?: string;
  /** Round dots: one per round, filled up to the current one. */
  rounds?: { current: number; total: number };
  /** The line under it: "Owl asked for 2 fixes", "From Fox · small". */
  line?: string;
  /** The Ready change's size. */
  change?: { files: number; additions: number; deletions: number };
  /** It waits on you (amber). */
  needsYou?: boolean;
  /** The chat Watch, Answer and Take over open. */
  sessionId?: string;
  /** When its current step started, for the elapsed time. */
  since?: number;
  actions: CrewBoardAction[];
};

const A = {
  give: { id: "give", label: "Give to crew", primary: true },
  notNow: { id: "not-now", label: "Not now" },
  watch: { id: "watch", label: "Watch" },
  review: { id: "review", label: "Review" },
  apply: { id: "apply", label: "Apply", primary: true },
  more: { id: "more", label: "One more round", primary: true },
  answer: { id: "answer", label: "Answer", primary: true },
  takeOver: { id: "take-over", label: "Take over in a chat" },
  backToIdeas: { id: "back-to-ideas", label: "Back to Ideas" },
  throwAway: { id: "throw-away", label: "Throw away" },
  resume: { id: "resume", label: "Resume", primary: true },
  open: { id: "open", label: "Open" },
} as const satisfies Record<string, CrewBoardAction>;

function stageColumn(card: CrewCard): CrewBoardInfo["column"] {
  switch (card.stage) {
    case "ready":
      return "review";
    case "applied":
      return "shipped";
    case "discarded":
      return undefined;
    default:
      return "building";
  }
}

/** "Owl asked for 2 fixes", for a card on its way back to the Builder. */
function fixingLine(card: CrewCard, checker: string): string | undefined {
  const asked = card.rounds.find((round) => round.n === card.round - 1)?.verdict
    ?.mustFix.length;
  return asked
    ? `${checker} asked for ${asked} ${asked === 1 ? "fix" : "fixes"}`
    : undefined;
}

/**
 * A crew card on the Board. Every button is Aven's word for the card's
 * stage: Watch while it works; Review and Apply when Ready; One more round,
 * Take over in a chat, Back to Ideas and Throw away when Stuck; Answer for a
 * question.
 */
export function crewBoardInfo(
  card: CrewCard,
  names: { builder: string; checker: string },
): CrewBoardInfo {
  const roles: CrewRole[] =
    card.stage === "queued" ? ["builder"] : ["builder", "checker"];
  const base = {
    column: stageColumn(card),
    roles,
    label: crewStageLabel(card),
    detail: crewStageDetail(card),
  };
  const turnChat = card.turn?.sessionId;
  switch (card.stage) {
    case "queued":
      return { ...base, actions: [] };
    case "building":
    case "checking": {
      const holder = card.holder ?? "builder";
      if (card.paused)
        return {
          ...base,
          label: "Paused",
          rounds: { current: card.round, total: card.maxRounds },
          actions: [A.resume],
        };
      return {
        ...base,
        holder,
        rounds: { current: card.round, total: card.maxRounds },
        ...(holder === "builder" && card.round > 1
          ? { line: fixingLine(card, names.checker) }
          : {}),
        ...(turnChat ? { sessionId: turnChat } : {}),
        ...(card.turn ? { since: card.turn.sentAt } : {}),
        actions: [A.watch],
      };
    }
    case "ready":
      return {
        ...base,
        ...(card.fix
          ? {
              change: {
                files: card.fix.files,
                additions: card.fix.additions,
                deletions: card.fix.deletions,
              },
            }
          : {}),
        actions: [A.review, A.apply],
      };
    case "stuck": {
      const question = card.stuck?.reason === "question";
      const rounds = { current: card.round, total: card.maxRounds };
      if (question)
        return {
          ...base,
          needsYou: true,
          rounds,
          holder: card.holder,
          ...(turnChat ? { sessionId: turnChat } : {}),
          actions: [A.answer],
        };
      return {
        ...base,
        needsYou: true,
        rounds,
        actions: [A.more, A.takeOver, A.backToIdeas, A.throwAway],
      };
    }
    case "applied":
      return { ...base, actions: [] };
    case "discarded":
      return { ...base, actions: [] };
  }
}

/**
 * A Board card in Ideas while the crew is on: Give to crew, and for a Scout
 * idea where it came from, its size and Not now.
 */
export function crewIdeaInfo(
  idea: CrewIdea | undefined,
  scout: string,
): CrewBoardInfo {
  if (!idea) return { roles: [], actions: [A.give] };
  const from = [
    `From ${scout}`,
    idea.size,
    idea.sourceUrl || idea.outside ? "from outside" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    roles: ["scout"],
    line: from,
    actions: idea.declined ? [A.give] : [A.give, A.notNow],
  };
}

/** What a crew card's ⋯ adds while the crew works on it: Pause or Resume, and Stop. */
export function crewCardMenu(card: CrewCard): CrewBoardAction[] {
  if (card.stage !== "building" && card.stage !== "checking") return [];
  return [
    card.paused
      ? { id: "resume", label: "Resume this card" }
      : { id: "pause", label: "Pause this card" },
    { id: "stop", label: "Stop now" },
  ];
}

type BoardColumn = "idea" | "building" | "review" | "shipped";
const BOARD_COLUMN_ORDER: readonly BoardColumn[] = [
  "idea",
  "building",
  "review",
  "shipped",
];

/**
 * The Board's columns with the crew on them: a card the crew has (queued,
 * in the loop, Ready or Stuck) shows its crew face in the column its stage
 * puts it in, whatever was saved; a card in Ideas offers Give to crew. A
 * card the crew finished is an ordinary card again.
 */
export function crewBoardColumns<
  C extends { id: string; column: BoardColumn; crew?: CrewBoardInfo },
>(
  columns: Readonly<Record<BoardColumn, readonly C[]>>,
  crew: Crew,
  names: { builder: string; checker: string; scout: string },
): Record<BoardColumn, C[]> {
  const out: Record<BoardColumn, C[]> = {
    idea: [],
    building: [],
    review: [],
    shipped: [],
  };
  const live = new Map(
    crew.cards
      .filter((card) => card.stage !== "applied" && card.stage !== "discarded")
      .map((card) => [card.id, card]),
  );
  for (const column of BOARD_COLUMN_ORDER)
    for (const card of columns[column]) {
      const held = live.get(card.id);
      if (held) {
        const info = crewBoardInfo(held, names);
        const target = info.column ?? column;
        out[target].push({ ...card, column: target, crew: info });
      } else if (column === "idea")
        out.idea.push({
          ...card,
          crew: crewIdeaInfo(crew.ideas?.[card.id], names.scout),
        });
      else out[column].push(card);
    }
  return out;
}

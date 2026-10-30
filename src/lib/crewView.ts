import {
  cardTriesAgain,
  crewStageDetail,
  crewStageLabel,
  roundLimit,
} from "./crewLoop";
import {
  cardBuilder,
  cardChecker,
  cardHolderId,
  cardSecurity,
  cardInCopy,
  crewMemberById,
  crewMembers,
  memberCritter,
  memberLabel,
  type Crew,
  type CrewCard,
  type CrewIdea,
  type CrewLoopRole,
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
 * The crew is on with nothing to build: no card queued, in its loop, Ready
 * or Stuck. (Paused, it says Paused instead.)
 */
export function crewIdle(crew: Crew): boolean {
  return (
    crew.on &&
    !crew.paused &&
    !crew.cards.some(
      (card) => card.stage !== "applied" && card.stage !== "discarded",
    )
  );
}

/** The crew has no Scout to suggest ideas. */
export function crewWithoutScout(crew: Crew): boolean {
  return !crew.members.some((member) => member.role === "scout");
}

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
  // A turn running now is Working, even while paused (it finishes).
  if (memberBusy || active.some((card) => !!card.turn) || fixer === "working")
    return "working";
  // Paused by you or a limit: a card waiting for its next turn waits too.
  if (crew.on && (crew.paused || crew.hold)) return "paused";
  if (
    active.some(
      (card) =>
        (card.stage === "building" || card.stage === "checking") &&
        !card.paused,
    )
  )
    return "working";
  if (!crew.on && fixer === "paused") return "paused";
  return "watching";
}

/**
 * The title shown beside a member's name, or null when the name already
 * says it: "Builder", "Builder 2".
 */
export function titleBeside(name: string, title: string): string | null {
  return name === title || name.startsWith(`${title} `) ? null : title;
}

export type CrewMemberView = {
  /** Its member id: the sidebar's and strip's key, and what opens its chat. */
  id: string;
  role: CrewRole;
  /** The mark it wears, when not its role's. */
  critter?: string;
  name: string;
  /** "Builder", or a custom member's own title. */
  roleLabel: string;
  /** A custom member's own job line. */
  job?: string;
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
    /** A member's name, by its id. */
    name: (who: string) => string;
    fixer?: { status: BotStatus; line?: string; sessionId?: string };
  },
): CrewMemberView[] {
  const card = cardInCopy(crew);
  const holderId = card ? cardHolderId(crew, card) : undefined;
  return crewMembers(crew)
    .filter((member) => member.role !== "fixer" || !!input.fixer)
    .filter((member) => member.role === "fixer" || crew.on)
    .map((member): CrewMemberView => {
      const critter = member.critter ? memberCritter(member) : undefined;
      const base = {
        id: member.id,
        role: member.role,
        ...(critter ? { critter } : {}),
        name: input.name(member.id),
        roleLabel: memberLabel(member),
        ...(member.job ? { job: member.job } : {}),
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
        holderId === member.id &&
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
  /** The same, as members (a chosen critter included), when known. */
  members?: { id: string; role: CrewRole; critter?: string }[];
  /** The bot at work on it now, whose critter moves. */
  holder?: CrewLoopRole;
  /** That bot's member id, whose chat Watch opens. */
  holderId?: string;
  /** Who it went to, and what you set for it: "Mole builds · Owl checks · Opus, high · 2 rounds". */
  assigned?: string;
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
 * stage: Back to Ideas while Queued; Watch while it works; Review and Apply
 * when Ready; One more round, Take over in a chat, Back to Ideas and Throw
 * away when Stuck; Answer for a question.
 */
export function crewBoardInfo(
  card: CrewCard,
  names: { builder: string; checker: string; security?: string },
  who?: {
    builder?: { id: string; critter?: string };
    checker?: { id: string; critter?: string };
    security?: { id: string; critter?: string };
    holderId?: string;
    /** "Mole builds · Owl checks · Opus, high": shown while the crew has it. */
    assigned?: string;
  },
): CrewBoardInfo {
  // Security joins once the Checker has passed it.
  const secured =
    card.holder === "security" || card.rounds.some((round) => round.security);
  const roles: CrewRole[] =
    card.stage === "queued"
      ? ["builder"]
      : secured
        ? ["builder", "checker", "security"]
        : ["builder", "checker"];
  const members = who
    ? roles
        .map((role) => {
          const member = who[role as "builder" | "checker" | "security"];
          return member
            ? {
                id: member.id,
                role,
                ...(member.critter ? { critter: member.critter } : {}),
              }
            : null;
        })
        .filter((member): member is NonNullable<typeof member> => !!member)
    : undefined;
  const live =
    card.stage !== "ready" &&
    card.stage !== "applied" &&
    card.stage !== "discarded";
  const base = {
    column: stageColumn(card),
    roles,
    ...(members?.length ? { members } : {}),
    label: crewStageLabel(card),
    detail: crewStageDetail(card),
    ...(who?.holderId ? { holderId: who.holderId } : {}),
    ...(live && who?.assigned ? { assigned: who.assigned } : {}),
  };
  const turnChat = card.turn?.sessionId;
  switch (card.stage) {
    case "queued":
      // Not started yet: you can take it back.
      return { ...base, actions: [A.backToIdeas] };
    case "building":
    case "checking": {
      const holder = card.holder ?? "builder";
      if (card.paused)
        return {
          ...base,
          label: "Paused",
          rounds: { current: card.round, total: roundLimit(card) },
          actions: [A.resume],
        };
      return {
        ...base,
        holder,
        rounds: { current: card.round, total: roundLimit(card) },
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
        ...(card.rounds.some(
          (round) => round.n === card.round && round.security,
        )
          ? {
              line: `${names.checker} passed it · Security: passed`,
            }
          : {}),
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
      const rounds = { current: card.round, total: roundLimit(card) };
      if (question)
        return {
          ...base,
          needsYou: true,
          rounds,
          holder: card.holder,
          ...(turnChat ? { sessionId: turnChat } : {}),
          actions: [A.answer],
        };
      // A turn that didn't finish runs again in the same round: Try again.
      const retry = cardTriesAgain(card);
      return {
        ...base,
        needsYou: true,
        rounds,
        actions: [
          retry ? { ...A.more, label: "Try again" } : A.more,
          A.takeOver,
          A.backToIdeas,
          A.throwAway,
        ],
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
  security = "Security",
): CrewBoardInfo {
  if (!idea) return { roles: [], actions: [A.give] };
  // A sweep's security card waits for you: it never starts by itself.
  if (idea.by === "security")
    return {
      roles: ["security"],
      line: `From ${security} · security`,
      actions: idea.declined ? [A.give] : [A.give, A.notNow],
    };
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
  // Ready: Apply is the way; a fix Apply won't take can be taken over.
  if (card.stage === "ready") return [A.takeOver];
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
/**
 * A card's Builder and Checker, as its face shows them: who it went to (or
 * the rules' pick while it waits), their critters, and what you set for it.
 */
export function crewCardWho(
  crew: Crew,
  card: CrewCard,
  name: (who: string) => string,
  modelName: (id: string) => string = (id) => id,
): {
  names: { builder: string; checker: string };
  who: NonNullable<Parameters<typeof crewBoardInfo>[2]>;
} {
  const builder =
    crewMemberById(crew, card.builderId) ?? cardBuilder(crew, card);
  const checker =
    crewMemberById(crew, card.checkerId) ?? cardChecker(crew, card);
  const security = cardSecurity(crew);
  const names = {
    builder: name(builder?.id ?? "builder"),
    checker: name(checker?.id ?? "checker"),
    security: name(security?.id ?? "security"),
  };
  const several = (role: CrewRole) =>
    crew.members.filter((member) => member.role === role).length > 1;
  const chose =
    !!card.builderId ||
    !!card.checkerId ||
    !!card.override ||
    card.maxRounds !== crew.limits.roundsPerCard ||
    several("builder") ||
    several("checker");
  const assigned = chose
    ? [
        `${names.builder} builds`,
        `${names.checker} checks`,
        [
          card.override?.model ? modelName(card.override.model) : "",
          card.override?.effort ?? "",
        ]
          .filter(Boolean)
          .join(", "),
        card.maxRounds !== crew.limits.roundsPerCard
          ? `${card.maxRounds} ${card.maxRounds === 1 ? "round" : "rounds"}`
          : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;
  const face = (member: typeof builder) =>
    member
      ? {
          id: member.id,
          ...(member.critter ? { critter: memberCritter(member) } : {}),
        }
      : undefined;
  const holderId = cardHolderId(crew, card);
  return {
    names,
    who: {
      ...(face(builder) ? { builder: face(builder) } : {}),
      ...(face(checker) ? { checker: face(checker) } : {}),
      ...(face(security) ? { security: face(security) } : {}),
      ...(holderId ? { holderId } : {}),
      ...(assigned ? { assigned } : {}),
    },
  };
}

export function crewBoardColumns<
  C extends { id: string; column: BoardColumn; crew?: CrewBoardInfo },
>(
  columns: Readonly<Record<BoardColumn, readonly C[]>>,
  crew: Crew,
  names: { builder: string; checker: string; scout: string; security?: string },
  /** A member's name by id, and a model's: each card names its own Builder and Checker. */
  name?: (who: string) => string,
  modelName?: (id: string) => string,
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
        const faced = name ? crewCardWho(crew, held, name, modelName) : null;
        const info = faced
          ? crewBoardInfo(held, faced.names, faced.who)
          : crewBoardInfo(held, names);
        const target = info.column ?? column;
        out[target].push({ ...card, column: target, crew: info });
      } else if (column === "idea")
        out.idea.push({
          ...card,
          crew: crewIdeaInfo(
            crew.ideas?.[card.id],
            names.scout,
            names.security,
          ),
        });
      else out[column].push(card);
    }
  return out;
}

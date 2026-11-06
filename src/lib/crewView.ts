import {
  cardCanGoOn,
  cardTriesAgain,
  crewStageLabel,
  roundLimit,
  roundOf,
} from "./crewLoop";
import {
  cardBuilder,
  cardChecker,
  cardHolderId,
  cardDesigner,
  cardResearcher,
  cardSecurity,
  cardSteppedAside,
  cardInCopy,
  crewMemberById,
  crewMembers,
  memberCritter,
  memberLabel,
  type Crew,
  type CrewCard,
  type CrewCardHolder,
  type CrewIdea,
  type CrewRole,
} from "./crews";
import { ideaWaits } from "./crewLimits";
import type { BotStatus } from "./projectBots";
import { plural } from "./words";

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
  | "open"
  /** An idea becomes a question for the Researcher. */
  | "research"
  /** Open the Researcher's findings. */
  | "read"
  /** Put the ideas it proposes in Ideas (each waits for you). */
  | "add-ideas"
  /** An idea becomes a screen for the Designer to mock up. */
  | "design"
  /** Open the Designer's mock-up. */
  | "look"
  /** An idea of yours to build what the mock-up shows. */
  | "build-mockup"
  /** You looked, and want nothing built. */
  | "dismiss-mockup";

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
  holder?: CrewCardHolder;
  /** That bot's member id, whose chat Watch opens. */
  holderId?: string;
  /** "Fixing", in bold, then "round 2 of 3". */
  label?: string;
  detail?: string;
  /** The line under it: "Owl asked for 2 fixes", "From Fox · small". */
  line?: string;
  /** It waits on you (amber). */
  needsYou?: boolean;
  /** The chat Watch, Answer and Take over open. */
  sessionId?: string;
  /** When its current step started, for the elapsed time. */
  since?: number;
  actions: CrewBoardAction[];
  /** More, in its ⋯: an idea's Build it next and Not now. */
  menu?: CrewBoardAction[];
  /** It builds by itself another day: it isn't waiting on you. */
  later?: boolean;
};

const A = {
  give: { id: "give", label: "Build it", primary: true },
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
  research: { id: "research", label: "Ask Researcher" },
  read: { id: "read", label: "Read" },
  design: { id: "design", label: "Ask Designer" },
  look: { id: "look", label: "Look" },
  buildMockup: { id: "build-mockup", label: "Build it", primary: true },
  dismissMockup: { id: "dismiss-mockup", label: "Dismiss" },
} as const satisfies Record<string, CrewBoardAction>;

/**
 * A mock-up card: one mark (the Designer), Mocking up while it draws, then
 * Mock-up in Ready for you with Look, Build it and Dismiss, and Mock-up ·
 * built or · dismissed once done. Never Apply: nothing of it is a change.
 */
function mockupBoardInfo(
  card: CrewCard,
  designer: string,
  member: { id: string; critter?: string } | undefined,
  holderId: string | undefined,
): CrewBoardInfo {
  const base = {
    column: stageColumn(card),
    roles: ["designer" as const],
    ...(member
      ? {
          members: [
            {
              id: member.id,
              role: "designer" as const,
              ...(member.critter ? { critter: member.critter } : {}),
            },
          ],
        }
      : {}),
    label: crewStageLabel(card),
    ...(holderId ? { holderId } : {}),
  };
  const turnChat = card.turn?.sessionId;
  switch (card.stage) {
    case "queued":
      return { ...base, label: "Up next", detail: designer, actions: [] };
    case "building":
    case "checking":
      if (card.paused)
        return {
          ...base,
          label: "Paused",
          detail: designer,
          actions: [A.resume],
        };
      return {
        ...base,
        holder: "designer",
        detail: `${designer} is on it`,
        ...(turnChat ? { sessionId: turnChat } : {}),
        ...(card.turn ? { since: card.turn.sentAt } : {}),
        actions: [],
      };
    case "ready":
      return {
        ...base,
        detail: designer,
        ...(card.mockup?.note ? { line: card.mockup.note } : {}),
        actions: [A.look, A.buildMockup],
      };
    case "stuck":
      return {
        ...base,
        needsYou: true,
        line: card.stuck?.text,
        holder: "designer",
        ...(turnChat ? { sessionId: turnChat } : {}),
        actions: [
          cardTriesAgain(card) ? { ...A.more, label: "Try again" } : A.more,
          A.throwAway,
        ],
      };
    case "applied":
      return {
        ...base,
        detail: card.mockup?.outcome === "built" ? "built" : "dismissed",
        actions: card.mockup ? [A.look] : [],
      };
    case "discarded":
      return { ...base, actions: [] };
  }
}

/** "6 sources", "1 source", "no sources": what the Researcher read. */
export function sourcesText(count: number): string {
  return count === 1 ? "1 source" : count ? `${count} sources` : "no sources";
}

/** "3 findings · 2 ideas proposed" (or "added", once they are). */
export function findingsLine(
  findings: Pick<CrewCard, "findings">["findings"],
  done = false,
): string {
  const count = findings?.findings.length ?? 0;
  const ideas = done ? (findings?.added ?? 0) : (findings?.ideas.length ?? 0);
  return [
    plural(count, "finding"),
    done
      ? ideas
        ? `${plural(ideas, "idea")} added`
        : "read"
      : `${plural(ideas, "idea")} proposed`,
  ].join(" · ");
}

/**
 * A research card: one mark (the Researcher), Reading while it reads, then
 * Findings in Ready for you with Read and Add ideas, and Read once done.
 * Never Apply: nothing changed.
 */
function researchBoardInfo(
  card: CrewCard,
  researcher: string,
  member: { id: string; critter?: string } | undefined,
  holderId: string | undefined,
): CrewBoardInfo {
  const base = {
    column: stageColumn(card),
    roles: ["researcher" as const],
    ...(member
      ? {
          members: [
            {
              id: member.id,
              role: "researcher" as const,
              ...(member.critter ? { critter: member.critter } : {}),
            },
          ],
        }
      : {}),
    label: crewStageLabel(card),
    ...(holderId ? { holderId } : {}),
  };
  const turnChat = card.turn?.sessionId;
  switch (card.stage) {
    case "queued":
      return { ...base, label: "Up next", detail: researcher, actions: [] };
    case "building":
    case "checking":
      if (card.paused)
        return {
          ...base,
          label: "Paused",
          detail: researcher,
          actions: [A.resume],
        };
      return {
        ...base,
        holder: "researcher",
        detail: researcher,
        ...(turnChat ? { sessionId: turnChat } : {}),
        ...(card.turn ? { since: card.turn.sentAt } : {}),
        actions: [],
      };
    case "ready": {
      const ideas = card.findings?.ideas.length ?? 0;
      return {
        ...base,
        detail: findingsLine(card.findings),
        actions: [
          A.read,
          ...(ideas
            ? [
                {
                  id: "add-ideas" as const,
                  label: `Add ${plural(ideas, "idea")}`,
                  primary: true,
                },
              ]
            : []),
        ],
      };
    }
    case "stuck":
      return {
        ...base,
        needsYou: true,
        line: card.stuck?.text,
        holder: "researcher",
        ...(turnChat ? { sessionId: turnChat } : {}),
        actions: [
          cardTriesAgain(card) ? { ...A.more, label: "Try again" } : A.more,
          A.throwAway,
        ],
      };
    case "applied":
      return {
        ...base,
        detail: findingsLine(card.findings, true),
        actions: card.findings ? [{ ...A.read, label: "Findings" }] : [],
      };
    case "discarded":
      return { ...base, actions: [] };
  }
}

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
 * A team card on the Board, kept simple: one mark (who has it now), one
 * line on where it stands, and at most two buttons. Ready: Review and
 * Apply. Needs you: Answer for a question, else Try again (or One more
 * round) and Throw away. A card at work opens its teammate's chat; the rest
 * is in its ⋯ (see `crewCardMenu`).
 */
export function crewBoardInfo(
  card: CrewCard,
  names: {
    builder: string;
    checker: string;
    security?: string;
    researcher?: string;
    designer?: string;
  },
  who?: {
    builder?: { id: string; critter?: string };
    checker?: { id: string; critter?: string };
    security?: { id: string; critter?: string };
    researcher?: { id: string; critter?: string };
    designer?: { id: string; critter?: string };
    holderId?: string;
  },
): CrewBoardInfo {
  if (card.kind === "research")
    return researchBoardInfo(
      card,
      names.researcher ?? "Researcher",
      who?.researcher,
      who?.holderId,
    );
  if (card.kind === "mockup")
    return mockupBoardInfo(
      card,
      names.designer ?? "Designer",
      who?.designer,
      who?.holderId,
    );
  // The one mark: whoever has it now, else its Builder.
  const role: CrewRole =
    card.holder === "security"
      ? "security"
      : card.holder === "checker" || card.stage === "checking"
        ? "checker"
        : "builder";
  const member = who?.[role as "builder" | "checker" | "security"];
  const base = {
    column: stageColumn(card),
    roles: [role],
    ...(member
      ? {
          members: [
            {
              id: member.id,
              role,
              ...(member.critter ? { critter: member.critter } : {}),
            },
          ],
        }
      : {}),
    label: crewStageLabel(card),
    ...(who?.holderId ? { holderId: who.holderId } : {}),
  };
  const turnChat = card.turn?.sessionId;
  const holderName =
    role === "security"
      ? (names.security ?? "Security")
      : role === "checker"
        ? names.checker
        : names.builder;
  switch (card.stage) {
    case "queued":
      return { ...base, label: "Up next", actions: [] };
    case "building":
    case "checking": {
      const holder = card.holder ?? "builder";
      const rounds =
        card.round > 1 ? ` · round ${card.round} of ${roundLimit(card)}` : "";
      if (card.paused)
        return {
          ...base,
          label: "Paused",
          detail: `${holderName}${rounds}`,
          actions: [A.resume],
        };
      return {
        ...base,
        holder: holder === "researcher" ? "builder" : holder,
        detail: `${holderName} is on it${rounds}`,
        ...(holder === "builder" && card.round > 1
          ? { line: fixingLine(card, names.checker) }
          : {}),
        ...(turnChat ? { sessionId: turnChat } : {}),
        ...(card.turn ? { since: card.turn.sentAt } : {}),
        actions: [],
      };
    }
    case "ready": {
      const secured = card.rounds.some(
        (round) => round.n === card.round && round.security,
      );
      return {
        ...base,
        detail: secured
          ? `checked by ${names.checker} and ${names.security ?? "Security"}`
          : `checked by ${names.checker}`,
        actions: [A.review, A.apply],
      };
    }
    case "stuck": {
      if (card.stuck?.reason === "question")
        return {
          ...base,
          needsYou: true,
          line: card.stuck.text,
          // One that stepped aside has no chat to open: Avos's copy has
          // moved on to other work. It's answered on the card.
          ...(cardSteppedAside(card) || card.holder === "researcher"
            ? {}
            : { holder: card.holder }),
          ...(turnChat ? { sessionId: turnChat } : {}),
          actions: [A.answer],
        };
      // The Builder's own words on why it changed nothing ("it was already
      // done"), after the reason.
      const said =
        card.stuck?.reason === "no-change"
          ? roundOf(card)?.handoff?.summary
          : undefined;
      return {
        ...base,
        needsYou: true,
        line: [card.stuck?.text, said].filter(Boolean).join(" · "),
        actions: [
          // A file's name the team can't bring to you: yours to change.
          cardCanGoOn(card)
            ? cardTriesAgain(card)
              ? { ...A.more, label: "Try again" }
              : A.more
            : { ...A.takeOver, primary: true },
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

/** Why an idea in Ideas waits for you, in words. */
const WAITS: Record<IdeaWait, string> = {
  "not-now": "Not now",
  outside: "From outside · waits for you",
  security: "Waits for you",
  researcher: "Waits for you",
  setup: "From setup · waits for you",
  chat: "Has its own chat · waits for you",
  large: "Large · waits for you",
  cap: "Waits for tomorrow: today's Scout ideas are used",
};

type IdeaWait = NonNullable<ReturnType<typeof ideaWaits>>;

/**
 * A Board card in Ideas while the team is on. It builds by itself in its
 * turn (the first says Next); one that waits for you says why, with Build
 * it. A Scout's, Security's or the Researcher's idea says whose it is. With
 * a Researcher on, its ⋯ offers Ask Researcher: the idea becomes a question.
 */
export function crewIdeaInfo(
  idea: CrewIdea | undefined,
  scout: string,
  security = "Security",
  place: {
    waits?: IdeaWait | null;
    next?: boolean;
    /** The Researcher's name, when the team has one on. */
    researcher?: string;
    /** The Designer's name, when the team has one on. */
    designer?: string;
  } = {},
): CrewBoardInfo {
  // An idea Aven suggested at setup wears no mark; its wait line says so.
  const from =
    idea?.by === "security"
      ? `From ${security}`
      : idea?.by === "researcher"
        ? `From ${place.researcher ?? "Researcher"}`
        : idea && idea.by !== "setup"
          ? `From ${scout}`
          : "";
  const roles: CrewRole[] =
    idea?.by === "security"
      ? ["security"]
      : idea?.by === "researcher"
        ? ["researcher"]
        : idea && idea.by !== "setup"
          ? ["scout"]
          : [];
  const ask = [
    ...(place.researcher
      ? [{ ...A.research, label: `Ask ${place.researcher}` }]
      : []),
    ...(place.designer
      ? [{ ...A.design, label: `Ask ${place.designer}` }]
      : []),
  ];
  if (place.waits)
    return {
      roles,
      line: [from, WAITS[place.waits]].filter(Boolean).join(" · "),
      actions: [{ ...A.give, label: "Build it" }],
      ...(place.waits === "cap" ? { later: true } : {}),
      ...(place.waits === "not-now" && !ask.length
        ? {}
        : {
            menu: [...ask, ...(place.waits === "not-now" ? [] : [A.notNow])],
          }),
    };
  return {
    roles,
    ...(place.next ? { label: "Next" } : {}),
    ...(from ? { line: from } : {}),
    actions: [],
    menu: [
      { ...A.give, label: "Build it next", primary: false },
      ...ask,
      A.notNow,
    ],
  };
}

/**
 * What a team card's ⋯ adds: Pause or Resume and Stop while it's worked on,
 * Not now while it waits its turn, and the rest of a stopped card's ways on.
 */
export function crewCardMenu(card: CrewCard): CrewBoardAction[] {
  const research = card.kind === "research" || card.kind === "mockup";
  switch (card.stage) {
    case "queued":
      return [{ ...A.backToIdeas, label: "Not now" }];
    case "building":
    case "checking":
      return [
        card.paused
          ? { id: "resume", label: "Resume this card" }
          : { id: "pause", label: "Pause this card" },
        { id: "stop", label: "Stop now" },
      ];
    // Ready: Apply is the way; a fix Apply won't take can be taken over.
    // Findings have nothing to take over: they go back to Ideas, or away.
    // A mock-up's Dismiss lives here too: the card keeps Look and Build it.
    case "ready":
      return card.kind === "mockup"
        ? [A.dismissMockup, A.backToIdeas, A.throwAway]
        : research
          ? [A.backToIdeas, A.throwAway]
          : [A.takeOver];
    case "stuck": {
      // Stepped aside: the copy isn't its own, so there's nothing to take over.
      const takeOver = cardSteppedAside(card) || research ? [] : [A.takeOver];
      return card.stuck?.reason === "question"
        ? [...takeOver, A.backToIdeas, A.throwAway]
        : [...(cardCanGoOn(card) ? takeOver : []), A.backToIdeas];
    }
    default:
      return [];
  }
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
 * the rules' pick while it waits), and their critters.
 */
export function crewCardWho(
  crew: Crew,
  card: CrewCard,
  name: (who: string) => string,
): {
  names: {
    builder: string;
    checker: string;
    security: string;
    researcher: string;
    designer: string;
  };
  who: NonNullable<Parameters<typeof crewBoardInfo>[2]>;
} {
  const builder =
    crewMemberById(crew, card.builderId) ?? cardBuilder(crew, card);
  const checker =
    crewMemberById(crew, card.checkerId) ?? cardChecker(crew, card);
  const security = cardSecurity(crew);
  const researcher = cardResearcher(crew);
  const designer = cardDesigner(crew);
  const names = {
    builder: name(builder?.id ?? "builder"),
    checker: name(checker?.id ?? "checker"),
    security: name(security?.id ?? "security"),
    researcher: name(researcher?.id ?? "researcher"),
    designer: name(designer?.id ?? "designer"),
  };
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
      ...(face(researcher) ? { researcher: face(researcher) } : {}),
      ...(face(designer) ? { designer: face(designer) } : {}),
      ...(holderId ? { holderId } : {}),
    },
  };
}

export function crewBoardColumns<
  C extends {
    id: string;
    column: BoardColumn;
    crew?: CrewBoardInfo;
    source?: { url: string };
    chatIds?: readonly string[];
  },
>(
  columns: Readonly<Record<BoardColumn, readonly C[]>>,
  crew: Crew,
  names: {
    builder: string;
    checker: string;
    scout: string;
    security?: string;
    researcher?: string;
    designer?: string;
  },
  /** A member's name by id: each card names its own Builder and Checker. */
  name?: (who: string) => string,
  now = Date.now(),
): Record<BoardColumn, C[]> {
  const out: Record<BoardColumn, C[]> = {
    idea: [],
    building: [],
    review: [],
    shipped: [],
  };
  // Findings you read stay readable from Done; other finished cards are
  // ordinary cards again.
  const live = new Map(
    crew.cards
      .filter(
        (card) =>
          (card.stage !== "applied" && card.stage !== "discarded") ||
          (card.kind === "research" &&
            card.stage === "applied" &&
            !!card.findings) ||
          (card.kind === "mockup" && card.stage === "applied" && !!card.mockup),
      )
      .map((card) => [card.id, card]),
  );
  // With a Researcher or a Designer on, an idea's ⋯ offers to ask them.
  const researcher = cardResearcher(crew);
  const researcherName = researcher
    ? (name?.(researcher.id) ?? names.researcher ?? "Researcher")
    : undefined;
  const designer = cardDesigner(crew);
  const designerName = designer
    ? (name?.(designer.id) ?? names.designer ?? "Designer")
    : undefined;
  // Ideas build top first: the first that doesn't wait for you is Next,
  // once nothing queued goes before it.
  let next = !crew.cards.some((card) => card.stage === "queued");
  for (const column of BOARD_COLUMN_ORDER)
    for (const card of columns[column]) {
      const held = live.get(card.id);
      // Findings you read keep their face in Done; moved elsewhere by hand,
      // the card is an ordinary card again.
      if (held && (held.stage !== "applied" || column === "shipped")) {
        const faced = name ? crewCardWho(crew, held, name) : null;
        const info = faced
          ? crewBoardInfo(held, faced.names, faced.who)
          : crewBoardInfo(held, names);
        const target = info.column ?? column;
        out[target].push({ ...card, column: target, crew: info });
      } else if (column === "idea") {
        const waits = ideaWaits(
          crew,
          {
            id: card.id,
            ...(card.source ? { sourceUrl: card.source.url } : {}),
            ...(card.chatIds ? { chatIds: card.chatIds } : {}),
          },
          now,
        );
        out.idea.push({
          ...card,
          crew: crewIdeaInfo(
            crew.ideas?.[card.id],
            names.scout,
            names.security,
            {
              waits,
              next: next && !waits,
              ...(researcherName ? { researcher: researcherName } : {}),
              ...(designerName ? { designer: designerName } : {}),
            },
          ),
        });
        if (!waits) next = false;
      } else out[column].push(card);
    }
  return out;
}

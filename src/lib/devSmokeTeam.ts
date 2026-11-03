import {
  addCrewPreset,
  addResearchIdeas,
  crewWorkspace,
  dismissResearch,
  setCrewAccess,
  setCrewQuietHours,
  turnOffCrew,
  updateCrewMember,
} from "./crewActions";
import {
  crewAccess,
  crewCard,
  ensureCrewSaved,
  getCrew,
  MOCKUP_DIR,
  type Crew,
  type CrewCard,
} from "./crews";
import { waitFor } from "./devSmoke";
import { crewDiagnostics, type SmokeCrew } from "./devSmokeCrew";
import { errorText } from "./errors";
import { deleteFeatureCard } from "./featureCards";
import { createPath, gitDiffIndex, writeTextFile } from "./fs";
import { parentPath, projectName } from "./paths";
import { setUpProjectGit } from "./projectGitSetup";
import { sameProjectPath } from "./recents";
import type { Session } from "./session";

/**
 * The real-app check's team steps, each in a Git project of its own beside
 * the check's, with the stand-in as every teammate: a team sets itself up
 * from a description, the Researcher hands back findings whose ideas go on
 * the Board, the Designer draws one mock-up (and is refused when it strays
 * outside its folder), a teammate's notes are kept between turns, and the
 * Team sheet's Access choices persist. Each step turns its team off at its
 * end, so one failure never holds the next.
 */

/** On a research card: the stand-in Researcher answers with findings. */
export const SMOKE_RESEARCH_WORD = "AVEN_SMOKE_RESEARCH";
/** With it, the stand-in's reply also rewrites the member's notes. */
export const SMOKE_NOTES_WORD = "AVEN_SMOKE_NOTES";
/** In the notes the stand-in writes. */
export const SMOKE_NOTES_TEXT = "AVEN_SMOKE_NOTES_OK";
/** On a mock-up card: the stand-in Designer writes one file in its folder. */
export const SMOKE_DESIGN_WORD = "AVEN_SMOKE_DESIGN";
/** With it, the stand-in Designer also writes a file outside its folder. */
export const SMOKE_STRAY_WORD = "AVEN_SMOKE_STRAY";
/** The stray file it writes at the top of the copy. */
export const SMOKE_STRAY_FILE = "aven-stray.txt";
/** In the mock-up's page and the Designer's note. */
export const SMOKE_MOCKUP_WORD = "AVEN_SMOKE_MOCKUP";
/** What Aven's message says when the Researcher has no web this turn. */
export const NO_WEB_LINE = "You have no web access this turn";
/** The tag a member's notes are quoted inside in its next turn. */
export const NOTES_TAG = "<your-notes>";

/** The description the setup step types; stored as the team's `about`. */
export const SETUP_DESCRIPTION =
  "A small to-do app for one person. I want a calm today list and nothing else.";
/** The idea the setup step adds as its own. */
export const SETUP_OWN_IDEA = "Show the date at the top";
/** The ideas the stand-in Researcher proposes, as its findings list them. */
export const RESEARCH_IDEAS = ["Open on today's list", "Cap the list at five"];

export type SmokeTeam = SmokeCrew & {
  /** New team for a project, as the sidebar's New team does. */
  newTeam: (path: string) => void;
  listDir: (path: string) => Promise<{ name: string }[]>;
};

type Get = () => { sessions: readonly Session[] };

/** One stand-in turn as its log records it (`fake-claude.log`). */
export type StandInTurn = {
  crew?: string;
  web?: boolean;
  notes?: boolean;
  stray?: boolean;
  [key: string]: unknown;
};

/** The stand-in's team turns from its log, oldest first; bad lines skipped. */
export function standInTeamTurns(log: string): StandInTurn[] {
  const turns: StandInTurn[] = [];
  for (const line of log.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as unknown;
      if (
        entry &&
        typeof entry === "object" &&
        typeof (entry as StandInTurn).crew === "string"
      )
        turns.push(entry as StandInTurn);
    } catch {
      // A line cut mid-write: not a turn.
    }
  }
  return turns;
}

/**
 * Why a card the Board shows isn't what the step expects: its column, its
 * stage line ("Findings · 2 findings · 2 ideas proposed"), the line under
 * it, and the buttons it offers. Null when it all matches.
 */
export function boardCardProblem(
  shown: {
    column: string | undefined;
    stage: string;
    line: string;
    buttons: readonly string[];
  },
  expected: {
    column?: string | readonly string[];
    stage?: string | RegExp;
    line?: string | RegExp;
    buttons?: readonly string[];
  },
): string | null {
  const columns =
    typeof expected.column === "string"
      ? [expected.column]
      : (expected.column ?? []);
  if (columns.length && !columns.includes(shown.column ?? ""))
    return `is under ${shown.column ?? "no column"}, not ${columns.join(" or ")}`;
  const matches = (text: string, want: string | RegExp) =>
    typeof want === "string" ? text === want : want.test(text);
  if (expected.stage !== undefined && !matches(shown.stage, expected.stage))
    return `reads "${shown.stage}", not ${typeof expected.stage === "string" ? `"${expected.stage}"` : expected.stage}`;
  if (expected.line !== undefined && !matches(shown.line, expected.line))
    return `says "${shown.line}" under its title, not ${typeof expected.line === "string" ? `"${expected.line}"` : expected.line}`;
  if (expected.buttons) {
    const missing = expected.buttons.filter(
      (label) => !shown.buttons.includes(label),
    );
    if (missing.length)
      return `offers ${shown.buttons.map((label) => `"${label}"`).join(", ") || "nothing"}, without ${missing.map((label) => `"${label}"`).join(", ")}`;
  }
  return null;
}

/**
 * Why the folder listing of the team's copy isn't clean after a turn: the
 * Designer's folder must be gone and no stray file left. Null when it is.
 */
export function copyLeftoversProblem(
  entries: readonly { name: string }[],
  changed: readonly { relative: string }[],
): string | null {
  const names = entries.map((entry) => entry.name);
  const left = names.filter(
    (name) => name === MOCKUP_DIR || name === SMOKE_STRAY_FILE,
  );
  if (left.length) return `the copy still holds ${left.join(", ")}`;
  if (changed.length)
    return `the copy's git status isn't clean: ${changed.map((file) => file.relative).join(", ")}`;
  return null;
}

// ---------------------------------------------------------------------------
// Pieces the steps share

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A problem that may still be clearing (a folder being deleted): read it
 * again every half second until it is null or the time is up, and give the
 * last problem.
 */
async function settles(
  read: () => Promise<string | null>,
  timeoutMs: number,
): Promise<string | null> {
  const started = Date.now();
  let problem = await read();
  while (problem && Date.now() - started < timeoutMs) {
    await wait(500);
    problem = await read();
  }
  return problem;
}

const onScreen = (
  element: Element | null | undefined,
): element is HTMLElement => !!element && element.getClientRects().length > 0;

/** A fresh Git project beside the check's, for one step's own team. */
async function newTeamProject(beside: string, name: string): Promise<string> {
  const path = await createPath(parentPath(beside), name, true);
  await writeTextFile(
    `${path}/README.md`,
    `Aven Dev real-app check: ${name}.\n`,
  );
  await setUpProjectGit(path);
  return path;
}

/** The project's team on, with the ready-made members added, quiet hours off. */
async function startTeam(
  team: SmokeTeam,
  path: string,
  presets: readonly string[],
): Promise<Crew> {
  const crew = ensureCrewSaved(path);
  // Quiet hours would hold the team on a runner whose clock is at night.
  setCrewQuietHours(path, { ...crew.limits.quiet, on: false });
  for (const key of presets) {
    const added = addCrewPreset(path, key);
    if ("error" in added)
      throw new Error(`Couldn't add the ${key} preset: ${added.error}`);
  }
  const off = await team.turnOn(path);
  if (off) throw new Error(`The team didn't turn on: ${off}`);
  return getCrew(path)!;
}

function workspace() {
  const found = crewWorkspace();
  if (!found) throw new Error("The crew workspace isn't installed");
  return found;
}

/** The project's Board on screen, if it is. */
function boardOnScreen(project: string): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>("[data-work-board]")].find(
      (board) =>
        sameProjectPath(board.dataset.workBoard ?? "", project) &&
        onScreen(board),
    ) ?? null
  );
}

async function openBoard(project: string): Promise<HTMLElement> {
  workspace().openCrew(project);
  return waitFor(() => boardOnScreen(project), 15_000, "the team's Board");
}

/** The Board card with this title, on the project's Board on screen. */
function boardCardByTitle(project: string, title: string): HTMLElement | null {
  const board = boardOnScreen(project);
  if (!board) return null;
  return (
    [...board.querySelectorAll<HTMLElement>("[data-board-card]")].find(
      (card) =>
        card.querySelector(".work-board-card-name")?.textContent?.trim() ===
        title,
    ) ?? null
  );
}

/** What a Board card shows, for `boardCardProblem` and failure messages. */
function shownCard(card: HTMLElement) {
  return {
    column: card.closest<HTMLElement>("[data-board-column]")?.dataset
      .boardColumn,
    stage: card.querySelector(".crew-card-stage")?.textContent?.trim() ?? "",
    line: card.querySelector(".crew-card-line")?.textContent?.trim() ?? "",
    buttons: [...card.querySelectorAll(".work-board-action")]
      .map((button) => button.textContent?.trim() ?? "")
      .filter(Boolean),
  };
}

function describeCard(card: HTMLElement): string {
  const shown = shownCard(card);
  return `under ${shown.column ?? "no column"}, "${shown.stage}"${shown.line ? ` / "${shown.line}"` : ""}, offering ${shown.buttons.map((label) => `"${label}"`).join(", ") || "nothing"}`;
}

/** Wait until the card with this title shows as expected, naming what it shows instead. */
async function expectCard(
  project: string,
  title: string,
  expected: Parameters<typeof boardCardProblem>[1],
  what: string,
  timeoutMs = 15_000,
): Promise<HTMLElement> {
  let last: HTMLElement | null = null;
  try {
    return await waitFor(
      () => {
        const card = boardCardByTitle(project, title);
        last = card;
        return card && !boardCardProblem(shownCard(card), expected)
          ? card
          : null;
      },
      timeoutMs,
      what,
    );
  } catch (error) {
    const card = last as HTMLElement | null;
    throw new Error(
      card
        ? `${what}: the card ${boardCardProblem(shownCard(card), expected) ?? "is wrong"} (${describeCard(card)})`
        : `${errorText(error)}: no card titled "${title}" on the Board`,
    );
  }
}

function pressCardButton(card: HTMLElement, label: string) {
  const button = [
    ...card.querySelectorAll<HTMLButtonElement>(".work-board-action"),
  ].find((item) => item.textContent?.trim() === label);
  if (!button)
    throw new Error(
      `The card has no "${label}" button (${describeCard(card)})`,
    );
  button.click();
}

/** Put words in a React-controlled field, as typing does. */
function typeInto(field: HTMLInputElement | HTMLTextAreaElement, text: string) {
  field.focus();
  const proto =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(field, text);
  field.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
}

/** Add an idea from the Board's own box: "Research: …" and "Design: …" ask a teammate. */
function addIdeaFromBoard(board: HTMLElement, text: string) {
  const field = board.querySelector<HTMLInputElement>(
    'input[aria-label="Add an idea"]',
  );
  if (!field) throw new Error("The Board has no Add an idea box");
  typeInto(field, text);
  const form = field.closest("form");
  if (!form) throw new Error("The Add an idea box isn't in a form");
  form.requestSubmit();
}

/** The team's card by its Board card id, failing on a stuck one unless allowed. */
function teamCard(
  project: string,
  cardId: string,
  allowStuck = false,
): CrewCard | undefined {
  const crew = getCrew(project);
  const card = crew ? crewCard(crew, cardId) : undefined;
  if (card?.stage === "stuck" && !allowStuck)
    throw new Error(`The card stopped: ${card.stuck?.text ?? "no reason"}`);
  return card;
}

function withDiagnostics(
  get: Get,
  project: string,
  cardId: string | undefined,
  error: unknown,
): never {
  throw new Error(
    `${errorText(error)} (${crewDiagnostics(getCrew(project), cardId ?? "", get().sessions)})`,
  );
}

/** Close the sheet that holds `inside`, by its Close button, and wait for it to go. */
async function closeSheet(inside: HTMLElement, what: string) {
  const dialog = inside.closest<HTMLElement>('[role="dialog"]');
  const close = dialog?.querySelector<HTMLButtonElement>(
    'button[aria-label="Close"]',
  );
  if (!close) throw new Error(`${what} has no Close button`);
  close.click();
  await waitFor(() => !onScreen(dialog), 5_000, `${what} to close`);
}

/** The stand-in's team turns from its log beside it, or null when unreadable. */
async function standInTurns(
  team: SmokeTeam,
  binDir: string,
): Promise<StandInTurn[] | null> {
  try {
    return standInTeamTurns(await team.readFile(`${binDir}/fake-claude.log`));
  } catch {
    return null;
  }
}

/** The last message Aven sent to a member's chat, or "" when none is loaded. */
function lastSentTo(get: Get, crew: Crew | undefined, role: string): string {
  const member = crew?.members.find((item) => item.role === role);
  const chat = member?.sessionId
    ? get().sessions.find((session) => session.id === member.sessionId)
    : undefined;
  return (
    chat?.blocks
      .filter((block) => block.role === "user")
      .map((block) => block.text)
      .at(-1) ?? ""
  );
}

/**
 * Best effort at a step's end: its team off, and any sheet it left open
 * closed, so the next step starts from the workspace as it is.
 */
async function tidy(project: string) {
  await turnOffCrew(project).catch(() => undefined);
  for (const close of document.querySelectorAll<HTMLButtonElement>(
    '[role="dialog"] button[aria-label="Close"]',
  ))
    if (onScreen(close)) close.click();
}

// ---------------------------------------------------------------------------
// Self-setup

export async function checkTeamSetup(
  get: Get,
  config: { projectPath: string },
  team: SmokeTeam,
): Promise<string> {
  const project = await newTeamProject(config.projectPath, "team-setup");
  const name = projectName(project);
  try {
    team.newTeam(project);
    const sheet = await waitFor(
      () => {
        const found = document.querySelector<HTMLElement>("[data-crew-setup]");
        return onScreen(found) ? found : null;
      },
      15_000,
      "the New team sheet",
    );
    const heading =
      sheet.closest('[role="dialog"]')?.querySelector("header")?.textContent ??
      "";
    if (!heading.includes(`New team for ${name}`))
      throw new Error(`The sheet is headed "${heading.trim()}"`);
    const field = sheet.querySelector<HTMLTextAreaElement>("textarea");
    if (!field) throw new Error("The sheet has no description box");
    typeInto(field, SETUP_DESCRIPTION);
    const pressable = (selector: string) => {
      const button = sheet.querySelector<HTMLButtonElement>(selector);
      return button && !button.disabled ? button : null;
    };
    const suggest = await waitFor(
      () => pressable("[data-crew-setup-suggest]"),
      5_000,
      "Suggest to be pressable after typing",
    );
    suggest.click();
    const roles = () =>
      [...sheet.querySelectorAll<HTMLElement>("[data-crew-setup-role]")].map(
        (tile) => tile.dataset.crewSetupRole,
      );
    await waitFor(
      () => {
        const problem = sheet.querySelector("[data-crew-setup-problem]");
        if (problem)
          throw new Error(`Suggest failed: ${problem.textContent?.trim()}`);
        return roles().length > 0;
      },
      90_000,
      "the suggested team",
    );
    if (roles().join() !== "builder,checker,researcher,designer")
      throw new Error(`The tiles are ${roles().join(", ")}`);
    const ideaRows = () =>
      [...sheet.querySelectorAll<HTMLElement>("[data-crew-setup-idea]")].map(
        (row) => ({
          source: row.dataset.crewSetupIdea ?? "",
          title:
            row.querySelector<HTMLInputElement>("input")?.value.trim() ?? "",
          label:
            row.querySelector(".team-setup-idea-source")?.textContent?.trim() ??
            "",
        }),
      );
    const proposed = ideaRows();
    if (
      proposed.map((row) => row.source).join() !== "setup,researcher,designer"
    )
      throw new Error(
        `The idea rows are ${proposed.map((row) => `${row.source} (${row.label})`).join(", ")}`,
      );
    if (
      proposed.map((row) => row.label).join() !==
      "suggested,Researcher,Designer first"
    )
      throw new Error(
        `The idea rows say ${proposed.map((row) => row.label).join(", ")}`,
      );
    const [suggested, research, design] = proposed.map((row) => row.title) as [
      string,
      string,
      string,
    ];
    // One tile fewer: the Checker.
    sheet
      .querySelector<HTMLButtonElement>('button[aria-label="Drop Checker"]')
      ?.click();
    await waitFor(
      () => roles().join() === "builder,researcher,designer",
      5_000,
      "the Checker's tile to go",
    );
    // One idea more, the user's own.
    const newIdea = sheet.querySelector<HTMLInputElement>(
      "[data-crew-setup-new-idea] input",
    );
    if (!newIdea) throw new Error("The sheet has no Add an idea row");
    typeInto(newIdea, SETUP_OWN_IDEA);
    newIdea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await waitFor(
      () => ideaRows().some((row) => row.source === "you"),
      5_000,
      "the added idea's row",
    );
    const rows = ideaRows();
    if (rows.length !== 4 || rows[3]?.title !== SETUP_OWN_IDEA)
      throw new Error(
        `The idea rows are now ${rows.map((row) => `"${row.title}" (${row.source})`).join(", ")}`,
      );
    const start = await waitFor(
      () => pressable("[data-crew-setup-start]"),
      5_000,
      "Start team to be pressable",
    );
    start.click();
    await waitFor(
      () => {
        const problem = sheet.querySelector("[data-crew-setup-problem]");
        if (problem)
          throw new Error(`Start team failed: ${problem.textContent?.trim()}`);
        return getCrew(project)?.on;
      },
      90_000,
      "the team to turn on",
    );
    await waitFor(
      () => !onScreen(document.querySelector("[data-crew-setup]")),
      10_000,
      "the setup sheet to close",
    );
    await waitFor(() => boardOnScreen(project), 15_000, "the team's Board");
    const crew = getCrew(project)!;
    if (crew.about !== SETUP_DESCRIPTION)
      throw new Error(
        `The team's about reads ${JSON.stringify(crew.about ?? null)}`,
      );
    const members = crew.members
      .filter((member) => member.role !== "fixer")
      .map((member) => member.role)
      .sort()
      .join();
    if (members !== "builder,designer,researcher")
      throw new Error(`The team's members are ${members}`);
    // The user's idea is an ordinary idea; a suggestion waits for a tick;
    // the question and the screen are the Researcher's and the Designer's.
    await expectCard(
      project,
      SETUP_OWN_IDEA,
      { column: ["idea", "building"], line: /^(?!.*waits for you)/ },
      "the user's own idea on the Board",
    );
    await expectCard(
      project,
      suggested,
      { column: "idea", line: "From setup · waits for you" },
      "the suggested idea on the Board",
    );
    const researchCard = await expectCard(
      project,
      research,
      { column: ["building", "review"], stage: /^(Up next|Reading|Findings)/ },
      "the research card on the Board",
      30_000,
    );
    const researchId = researchCard.dataset.boardCard ?? "";
    if (teamCard(project, researchId, true)?.kind !== "research")
      throw new Error("The question isn't a research card of the team's");
    const designCard = await expectCard(
      project,
      design,
      {
        column: ["building", "review"],
        stage: /^(Up next|Mocking up|Mock-up)/,
      },
      "the mock-up card on the Board",
      30_000,
    );
    if (
      teamCard(project, designCard.dataset.boardCard ?? "", true)?.kind !==
      "mockup"
    )
      throw new Error("The screen isn't a mock-up card of the team's");
    return `"New team for ${name}" suggested Builder, Checker, Researcher and Designer with three ideas; without the Checker and with "${SETUP_OWN_IDEA}" added, Start team turned the team on with its about kept, the suggestion waiting for a tick and the question and screen with the Researcher and Designer`;
  } catch (error) {
    withDiagnostics(get, project, undefined, error);
  } finally {
    await tidy(project);
  }
}

// ---------------------------------------------------------------------------
// The Researcher

export async function checkResearcher(
  get: Get,
  config: { projectPath: string; binDir: string },
  team: SmokeTeam,
): Promise<string> {
  const project = await newTeamProject(config.projectPath, "team-researcher");
  let cardId: string | undefined;
  try {
    await startTeam(team, project, ["researcher"]);
    const board = await openBoard(project);
    const question = `What do similar apps do first? ${SMOKE_RESEARCH_WORD}`;
    addIdeaFromBoard(board, `Research: ${question}`);
    const card = await waitFor(
      () => boardCardByTitle(project, question),
      10_000,
      "the research card",
    );
    cardId = card.dataset.boardCard ?? "";
    const id = cardId;
    await waitFor(
      () => teamCard(project, id)?.kind === "research",
      10_000,
      "the question to become the Researcher's card",
    );
    const ready = await waitFor(
      () => {
        const current = teamCard(project, id);
        return current?.stage === "ready" ? current : null;
      },
      180_000,
      "the Researcher's findings",
    );
    const findings = ready.findings;
    if (
      findings?.findings.length !== 2 ||
      findings.ideas.length !== 2 ||
      findings.sources !== 2
    )
      throw new Error(
        `The findings hold ${findings?.findings.length ?? 0} findings, ${findings?.ideas.length ?? 0} ideas and ${findings?.sources ?? 0} sources`,
      );
    const shown = await expectCard(
      project,
      question,
      {
        column: "review",
        stage: "Findings · 2 findings · 2 ideas proposed",
        buttons: ["Read", "Add 2 ideas"],
      },
      "the Findings card in Ready for you",
    );
    pressCardButton(shown, "Read");
    const sheet = await waitFor(
      () => {
        const found = document.querySelector<HTMLElement>(
          `[data-crew-findings="${id}"]`,
        );
        return onScreen(found) ? found : null;
      },
      10_000,
      "the findings sheet",
    );
    const items = [...sheet.querySelectorAll(".crew-findings-list > li")];
    if (items.length !== 2)
      throw new Error(`The sheet numbers ${items.length} findings, not 2`);
    const links = items.filter((item) =>
      item.querySelector(".crew-findings-source[data-link]"),
    );
    if (links.length !== 2)
      throw new Error(`${links.length} of the findings show a link`);
    const ticks = [
      ...sheet.querySelectorAll<HTMLInputElement>(
        '[data-crew-findings-ideas] input[type="checkbox"]',
      ),
    ];
    if (ticks.length !== 2 || !ticks.every((tick) => tick.checked))
      throw new Error(
        `The sheet lists ${ticks.length} ideas, ${ticks.filter((tick) => tick.checked).length} ticked`,
      );
    const add = [...sheet.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Add 2 ideas to Board",
    );
    if (!add) throw new Error('The sheet has no "Add 2 ideas to Board"');
    add.click();
    await waitFor(
      () => !onScreen(sheet),
      15_000,
      "the findings sheet to close",
    );
    for (const title of RESEARCH_IDEAS)
      await expectCard(
        project,
        title,
        { column: "idea", line: "From Researcher · Waits for you" },
        `the idea "${title}" from the findings`,
      );
    await expectCard(
      project,
      question,
      { column: "shipped", stage: "Read · 2 findings · 2 ideas added" },
      "the research card in Done",
    );
    // Added already: pressing Add again adds nothing.
    const before =
      boardOnScreen(project)?.querySelectorAll("[data-board-card]").length;
    const again = await addResearchIdeas(project, id);
    await wait(1_000);
    const after =
      boardOnScreen(project)?.querySelectorAll("[data-board-card]").length;
    if (!again || after !== before)
      throw new Error(
        `Add again ${again ? `was refused ("${again}")` : "went through"} and the Board went from ${before} to ${after} cards`,
      );

    // With the web for no one, the Researcher's next turn is told so.
    setCrewAccess(project, { web: "none" });
    const logged = await standInTurns(team, config.binDir);
    const was =
      logged?.filter((turn) => turn.crew === "researcher").length ?? 0;
    const second = `And with no web? ${SMOKE_RESEARCH_WORD}`;
    addIdeaFromBoard(board, `Research: ${second}`);
    const secondCard = await waitFor(
      () => boardCardByTitle(project, second),
      10_000,
      "the second research card",
    );
    const secondId = secondCard.dataset.boardCard ?? "";
    await waitFor(
      () => teamCard(project, secondId)?.stage === "ready",
      180_000,
      "the second findings",
    );
    let web: string;
    if (logged) {
      const turns = (await standInTurns(team, config.binDir)) ?? [];
      const researcher = turns.filter((turn) => turn.crew === "researcher");
      const last = researcher.at(-1);
      if (researcher.length <= was || !last)
        throw new Error(
          "The stand-in logged no Researcher turn for the second question",
        );
      if (last.web !== false)
        throw new Error(
          "The stand-in Researcher's turn said it had the web although Access says No one",
        );
      web = "the stand-in's log shows its turn was told it has no web";
    } else {
      const sent = lastSentTo(get, getCrew(project), "researcher");
      if (!sent)
        web =
          "the stand-in's log and the Researcher's chat were unreadable, so the no-web line wasn't checked";
      else if (!sent.includes(NO_WEB_LINE))
        throw new Error(
          "The Researcher's turn wasn't told it has no web although Access says No one",
        );
      else web = "the Researcher's chat shows its turn was told it has no web";
    }
    await dismissResearch(project, secondId);
    return `Findings · 2 findings · 2 ideas proposed; Read numbered both with a link each and ticked both ideas; Add 2 ideas to Board put "${RESEARCH_IDEAS.join('" and "')}" in Ideas as From Researcher · Waits for you and the card in Done; Add again added nothing; with Access → web No one, ${web}`;
  } catch (error) {
    withDiagnostics(get, project, cardId, error);
  } finally {
    await tidy(project);
  }
}

// ---------------------------------------------------------------------------
// The Designer

export async function checkDesigner(
  get: Get,
  config: { projectPath: string },
  team: SmokeTeam,
): Promise<string> {
  const project = await newTeamProject(config.projectPath, "team-designer");
  let cardId: string | undefined;
  try {
    const crew = await startTeam(team, project, ["designer"]);
    // The Builder would pick up Build it's idea: it sits this step out.
    const builder = crew.members.find((member) => member.role === "builder");
    if (builder) updateCrewMember(project, builder.id, { paused: true });
    const board = await openBoard(project);
    const screen = `The today screen ${SMOKE_DESIGN_WORD}`;
    addIdeaFromBoard(board, `Design: ${screen}`);
    const card = await waitFor(
      () => boardCardByTitle(project, screen),
      10_000,
      "the mock-up card",
    );
    cardId = card.dataset.boardCard ?? "";
    const id = cardId;
    await waitFor(
      () => teamCard(project, id)?.kind === "mockup",
      10_000,
      "the screen to become the Designer's card",
    );
    const ready = await waitFor(
      () => {
        const current = teamCard(project, id);
        return current?.stage === "ready" ? current : null;
      },
      180_000,
      "the Designer's mock-up",
    );
    if (!ready.mockup?.file)
      throw new Error("The Ready card has no mock-up file");
    const copy = getCrew(project)?.copy?.path;
    if (!copy) throw new Error("The team has no copy");
    if (ready.mockup.file.startsWith(`${copy}/`))
      throw new Error(
        `Aven kept the mock-up inside the copy: ${ready.mockup.file}`,
      );
    const shown = await expectCard(
      project,
      screen,
      {
        column: "review",
        stage: "Mock-up · Designer",
        line: new RegExp(SMOKE_MOCKUP_WORD),
        buttons: ["Look", "Build it"],
      },
      "the Mock-up card in Ready for you",
    );
    pressCardButton(shown, "Look");
    const sheet = await waitFor(
      () => {
        const found = document.querySelector<HTMLElement>(
          `[data-crew-mockup="${id}"]`,
        );
        return onScreen(found) ? found : null;
      },
      10_000,
      "the mock-up sheet",
    );
    const description =
      sheet.closest('[role="dialog"]')?.querySelector("header")?.textContent ??
      "";
    if (!description.includes("Mock-up · Designer"))
      throw new Error(`The sheet is headed "${description.trim()}"`);
    await waitFor(
      () => {
        const problem = sheet.querySelector('[role="alert"]');
        if (problem)
          throw new Error(`The sheet says: ${problem.textContent?.trim()}`);
        return sheet
          .querySelector(".crew-mockup-page")
          ?.shadowRoot?.textContent?.includes(SMOKE_MOCKUP_WORD);
      },
      10_000,
      "the page to render in the sheet",
    );
    const build = sheet.querySelector<HTMLButtonElement>(
      "[data-crew-mockup-build]",
    );
    if (!build) throw new Error("The sheet has no Build it");
    build.click();
    await waitFor(() => !onScreen(sheet), 15_000, "the mock-up sheet to close");
    const buildIdea = await expectCard(
      project,
      `Build the mock-up: ${screen}`,
      { column: ["idea", "building"] },
      "the Build the mock-up idea",
    );
    await expectCard(
      project,
      screen,
      { column: "shipped", stage: "Mock-up · built", buttons: ["Look"] },
      "the mock-up card in Done",
    );
    // Nothing of the turn stays in the copy.
    const leftovers = () =>
      settles(
        async () =>
          copyLeftoversProblem(
            await team.listDir(copy),
            (await gitDiffIndex(copy)).files,
          ),
        10_000,
      );
    const clean = await leftovers();
    if (clean) throw new Error(`After the mock-up, ${clean}`);
    await deleteFeatureCard(project, buildIdea.dataset.boardCard ?? "").catch(
      () => false,
    );

    // A turn that writes outside its folder is refused, and Throw away
    // leaves the copy clean.
    const strayScreen = `The settings screen ${SMOKE_DESIGN_WORD} ${SMOKE_STRAY_WORD}`;
    addIdeaFromBoard(board, `Design: ${strayScreen}`);
    const strayCard = await waitFor(
      () => boardCardByTitle(project, strayScreen),
      10_000,
      "the straying mock-up card",
    );
    const strayId = strayCard.dataset.boardCard ?? "";
    cardId = strayId;
    const stuck = await waitFor(
      () => {
        const current = teamCard(project, strayId, true);
        if (current?.stage === "ready")
          throw new Error(
            "Aven kept a mock-up from a turn that wrote outside its folder",
          );
        return current?.stage === "stuck" ? current : null;
      },
      180_000,
      "the straying turn to stop",
    );
    if (!stuck.stuck?.text.includes(`wrote outside ${MOCKUP_DIR}`))
      throw new Error(`The card stopped for "${stuck.stuck?.text}"`);
    const needsYou = await expectCard(
      project,
      strayScreen,
      {
        column: "building",
        stage: "Needs you",
        line: new RegExp(`wrote outside ${MOCKUP_DIR}.*${SMOKE_STRAY_FILE}`),
        buttons: ["Throw away"],
      },
      "the straying card as Needs you",
    );
    const strayed = (await team.listDir(copy)).some(
      (entry) => entry.name === SMOKE_STRAY_FILE,
    );
    if (!strayed)
      throw new Error(`${SMOKE_STRAY_FILE} isn't in the copy for you to see`);
    pressCardButton(needsYou, "Throw away");
    const confirm = await waitFor(
      () => {
        const found = document.querySelector<HTMLElement>(
          "[data-crew-throw-confirm]",
        );
        return onScreen(found) ? found : null;
      },
      10_000,
      "the Throw away question",
    );
    const sure = [
      ...confirm.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.trim() === "Throw away");
    if (!sure) throw new Error("The question has no Throw away button");
    sure.click();
    await waitFor(
      () => !boardCardByTitle(project, strayScreen),
      15_000,
      "the thrown-away card to leave the Board",
    );
    const left = await leftovers();
    if (left) throw new Error(`After Throw away, ${left}`);
    return `Mock-up · Designer with Look and Build it; Look rendered the page; Build it added "Build the mock-up: …" and put the card in Done with the copy clean; a turn that wrote ${SMOKE_STRAY_FILE} outside ${MOCKUP_DIR} ended as Needs you with why, and Throw away left the copy clean`;
  } catch (error) {
    withDiagnostics(get, project, cardId, error);
  } finally {
    await tidy(project);
  }
}

// ---------------------------------------------------------------------------
// A teammate's notes

export async function checkTeammateNotes(
  get: Get,
  config: { projectPath: string; binDir: string },
  team: SmokeTeam,
): Promise<string> {
  const project = await newTeamProject(config.projectPath, "team-notes");
  let cardId: string | undefined;
  try {
    const crew = await startTeam(team, project, ["researcher"]);
    const researcher = crew.members.find(
      (member) => member.role === "researcher",
    );
    if (!researcher) throw new Error("The team has no Researcher");
    const board = await openBoard(project);
    const question = `What is worth remembering here? ${SMOKE_RESEARCH_WORD} ${SMOKE_NOTES_WORD}`;
    addIdeaFromBoard(board, `Research: ${question}`);
    const card = await waitFor(
      () => boardCardByTitle(project, question),
      10_000,
      "the research card",
    );
    cardId = card.dataset.boardCard ?? "";
    const id = cardId;
    await waitFor(
      () => teamCard(project, id)?.stage === "ready",
      180_000,
      "the Researcher's turn to end",
    );
    const memory = await waitFor(
      () => {
        const member = getCrew(project)?.members.find(
          (item) => item.id === researcher.id,
        );
        return member?.memory?.includes(SMOKE_NOTES_TEXT) && member.memoryAt
          ? member.memory
          : null;
      },
      10_000,
      "the Researcher's notes to be kept",
    );
    // Its page shows them, with when.
    workspace().openSettings(project, researcher.id);
    const notes = await waitFor(
      () => {
        const found = document.querySelector<HTMLTextAreaElement>(
          "[data-crew-member-notes]",
        );
        return onScreen(found) ? found : null;
      },
      10_000,
      "the teammate's page",
    );
    if (!notes.value.includes(SMOKE_NOTES_TEXT))
      throw new Error(`The Notes box reads ${JSON.stringify(notes.value)}`);
    const hint =
      notes
        .closest(".teammate-field")
        ?.querySelector(".teammate-field-label span")?.textContent ?? "";
    if (!hint.includes("Updated"))
      throw new Error(
        `The Notes label says "${hint.trim()}", not when they were updated`,
      );
    await closeSheet(notes, "the teammate's page");
    await dismissResearch(project, id);

    // The next turn reads them back.
    const logged = await standInTurns(team, config.binDir);
    const was =
      logged?.filter((turn) => turn.crew === "researcher").length ?? 0;
    const second = `And again? ${SMOKE_RESEARCH_WORD}`;
    addIdeaFromBoard(board, `Research: ${second}`);
    const secondCard = await waitFor(
      () => boardCardByTitle(project, second),
      10_000,
      "the second research card",
    );
    const secondId = secondCard.dataset.boardCard ?? "";
    cardId = secondId;
    await waitFor(
      () => teamCard(project, secondId)?.stage === "ready",
      180_000,
      "the second turn to end",
    );
    let read: string;
    const sent = lastSentTo(get, getCrew(project), "researcher");
    if (logged) {
      const turns = (await standInTurns(team, config.binDir)) ?? [];
      const researcherTurns = turns.filter(
        (turn) => turn.crew === "researcher",
      );
      const last = researcherTurns.at(-1);
      if (researcherTurns.length <= was || !last)
        throw new Error(
          "The stand-in logged no Researcher turn for the second question",
        );
      if (last.notes !== true)
        throw new Error(
          "The stand-in Researcher's second turn wasn't given its notes",
        );
      read = "the stand-in's log shows the next turn got them";
    } else if (sent) {
      if (!sent.includes(NOTES_TAG) || !sent.includes(SMOKE_NOTES_TEXT))
        throw new Error("The Researcher's second turn wasn't given its notes");
      read = "the Researcher's chat shows the next turn got them";
    } else
      read =
        "the stand-in's log and the Researcher's chat were unreadable, so the next turn's notes weren't checked";
    await dismissResearch(project, secondId);

    // Clear empties them.
    workspace().openSettings(project, researcher.id);
    const again = await waitFor(
      () => {
        const found = document.querySelector<HTMLTextAreaElement>(
          "[data-crew-member-notes]",
        );
        return onScreen(found) ? found : null;
      },
      10_000,
      "the teammate's page again",
    );
    const clear = again
      .closest(".teammate-field")
      ?.querySelector<HTMLButtonElement>("[data-crew-member-notes-clear]");
    if (!clear) throw new Error("The Notes box has no Clear");
    clear.click();
    await waitFor(
      () =>
        again.value === "" &&
        !getCrew(project)?.members.find((item) => item.id === researcher.id)
          ?.memory,
      5_000,
      "Clear to empty the notes",
    );
    await closeSheet(again, "the teammate's page");
    return `the turn's notes block set the Researcher's Notes (${memory.length} characters, with Updated); ${read}; Clear emptied them`;
  } catch (error) {
    withDiagnostics(get, project, cardId, error);
  } finally {
    await tidy(project);
  }
}

// ---------------------------------------------------------------------------
// Access

export async function checkTeamAccess(
  get: Get,
  config: { projectPath: string },
): Promise<string> {
  const project = await newTeamProject(config.projectPath, "team-access");
  ensureCrewSaved(project);
  const open = async (what: string) => {
    workspace().openSettings(project);
    return waitFor(
      () => {
        const found = document.querySelector<HTMLElement>("[data-crew-access]");
        return onScreen(found) ? found : null;
      },
      10_000,
      what,
    );
  };
  const controls = (section: HTMLElement) => {
    const deletes = section.querySelector<HTMLButtonElement>(
      'button[role="switch"][aria-label="Delete files in its copy"]',
    );
    const radio = (group: string, label: string) =>
      [
        ...(section
          .querySelector(`[role="radiogroup"][aria-label="${group}"]`)
          ?.querySelectorAll<HTMLButtonElement>('button[role="radio"]') ?? []),
      ].find((button) => button.textContent?.trim() === label);
    const noOne = radio("Who uses the web", "No one");
    const askMe = radio("When a teammate wants anything else", "Ask me");
    if (!deletes || !noOne || !askMe)
      throw new Error(
        `Access is missing ${[
          deletes ? "" : "Delete files in its copy",
          noOne ? "" : "No one",
          askMe ? "" : "Ask me",
        ]
          .filter(Boolean)
          .join(", ")}`,
      );
    return { deletes, noOne, askMe };
  };
  const checked = (button: HTMLButtonElement) =>
    button.getAttribute("aria-checked") === "true";
  try {
    const section = await open("the Team sheet's Access");
    const first = controls(section);
    if (!checked(first.deletes) || checked(first.noOne) || checked(first.askMe))
      throw new Error(
        `Access starts with deletes ${checked(first.deletes)}, No one ${checked(first.noOne)}, Ask me ${checked(first.askMe)}`,
      );
    first.deletes.click();
    first.noOne.click();
    first.askMe.click();
    await waitFor(
      () => {
        const access = crewAccess(getCrew(project) ?? { access: {} });
        return (
          !access.deletes && access.web === "none" && access.others === "ask"
        );
      },
      5_000,
      "the choices to be saved",
    );
    const now = controls(section);
    if (checked(now.deletes) || !checked(now.noOne) || !checked(now.askMe))
      throw new Error(
        `After pressing them, deletes shows ${checked(now.deletes)}, No one ${checked(now.noOne)}, Ask me ${checked(now.askMe)}`,
      );
    await closeSheet(section, "the Team sheet");
    const reopened = await open("the Team sheet's Access again");
    const kept = controls(reopened);
    if (checked(kept.deletes) || !checked(kept.noOne) || !checked(kept.askMe))
      throw new Error(
        `Reopened, deletes shows ${checked(kept.deletes)}, No one ${checked(kept.noOne)}, Ask me ${checked(kept.askMe)}`,
      );
    await closeSheet(reopened, "the Team sheet");
    const access = crewAccess(getCrew(project) ?? { access: {} });
    return `Delete files in its copy off, web No one and Ask me stayed so after the sheet was closed and opened again (stored as ${JSON.stringify(access)})`;
  } catch (error) {
    withDiagnostics(get, project, undefined, error);
  }
  // Unreachable: withDiagnostics throws.
  return "";
}

import {
  applyCrewBatch,
  crewBatch,
  giveCardToCrew,
  reviewCrewBatch,
  setCrewQuietHours,
  turnOffCrew,
} from "./crewActions";
import { holdNextCrewSend } from "./crewSmoke";
import { crewCard, getCrew, newCrew, type Crew } from "./crews";
import { waitFor } from "./devSmoke";
import { errorText } from "./errors";
import { addFeatureIdea } from "./featureCards";
import { gitDiffIndex, type GitChangedFile } from "./fs";
import {
  launchRefusal,
  sessionPermissions,
} from "./harness/sessionPermissions";
import type { Session } from "./session";

/**
 * The real-app check's crew step: a crew in the check's project builds a
 * card with the stand-in agents (the Builder in the crew's copy with its
 * rules, the Checker saying "not yet" once, Security passing), the card is
 * Ready after round 2 and stacked on the crew's branch, the Pipeline's
 * Apply all changes the project by exactly the reviewed change, and a turn
 * held while it was prepared never goes once the crew is turned off.
 */

/** In a card's note: the stand-in answers its crew turns by role. */
export const SMOKE_CREW_WORD = "AVEN_SMOKE_CREW";
/** The file the stand-in Builder writes, "round N". */
export const SMOKE_CREW_FILE = "aven-crew-check.txt";
/** How the stand-in reports what it was started with. */
export const SMOKE_CREW_ENV = "AVEN_SMOKE_CREW_ENV";

export type SmokeCrew = {
  /** Turn the project's crew on, as its switch does; resolves with why not. */
  turnOn: (path: string) => Promise<string | null>;
  readFile: (path: string) => Promise<string>;
};

/** macOS names the same folder with and without /private. */
function samePath(a: string, b: string): boolean {
  const plain = (path: string) =>
    path.replace(/^\/private(?=\/)/, "").replace(/\/+$/, "");
  return plain(a) === plain(b);
}

/**
 * Why the stand-in's report of how it was started (in a handoff or verdict)
 * isn't a crew member's: in the copy, with the user's settings only, no
 * hooks, its sandbox on and a strict, empty MCP config. Null when it is.
 */
export function crewLaunchProblem(
  text: string | undefined,
  copy: string,
  who: string,
): string | null {
  const at = text?.indexOf(SMOKE_CREW_ENV) ?? -1;
  if (!text || at < 0) return `${who} didn't report how it was started`;
  const line = text.slice(at + SMOKE_CREW_ENV.length).trim();
  const cwd = /cwd=(.*)$/.exec(line)?.[1]?.trim() ?? "";
  const field = (name: string) =>
    new RegExp(`${name}=(\\S+)`).exec(line)?.[1] ?? "none";
  const problems = [
    samePath(cwd, copy) ? "" : `ran in ${cwd || "an unknown folder"}`,
    field("sources") === "user"
      ? ""
      : `loaded settings from ${field("sources")}`,
    field("hooks") === "off" ? "" : "ran with hooks",
    field("sandbox") === "on" ? "" : "ran without its sandbox",
    field("mcp") === "strict" ? "" : "could load MCP servers",
  ].filter(Boolean);
  return problems.length ? `${who} ${problems.join(", ")}` : null;
}

/**
 * Why Apply changed the project by anything but the reviewed change: every
 * file whose state differs between `before` and `after` must be one of the
 * fix's paths, and each of those must have changed.
 */
export function appliedProblem(
  before: readonly Pick<
    GitChangedFile,
    "relative" | "status" | "additions" | "deletions"
  >[],
  after: readonly Pick<
    GitChangedFile,
    "relative" | "status" | "additions" | "deletions"
  >[],
  fixPaths: readonly string[],
): string | null {
  const state = (file: (typeof before)[number]) =>
    `${file.status}:${file.additions}:${file.deletions}`;
  const was = new Map(before.map((file) => [file.relative, state(file)]));
  const now = new Map(after.map((file) => [file.relative, state(file)]));
  const changed = [...new Set([...was.keys(), ...now.keys()])].filter(
    (path) => was.get(path) !== now.get(path),
  );
  const expected = new Set(fixPaths);
  const extra = changed.filter((path) => !expected.has(path));
  const missing = [...expected].filter((path) => !changed.includes(path));
  if (extra.length)
    return `Apply also changed ${extra.join(", ")}, which wasn't in the reviewed change`;
  if (missing.length)
    return `Apply didn't change ${missing.join(", ")} from the reviewed change`;
  return null;
}

/**
 * Why a Ready card isn't waiting as the Pipeline shows it: committed on the
 * crew's branch as the batch's only card, and the batch's Review (`shown`,
 * its files) is the card's reviewed change. Null when it is.
 */
export function stackProblem(
  crew: Crew | undefined,
  cardId: string,
  shown: readonly string[],
): string | null {
  const card = crew ? crewCard(crew, cardId) : undefined;
  if (!card?.stacked)
    return "The Ready card isn't stacked on the crew's branch";
  const ids = crewBatch(crew)?.cards.map((item) => item.id) ?? [];
  if (ids.length !== 1 || ids[0] !== cardId)
    return `The crew's branch holds ${ids.join(", ") || "nothing"}, not just the check's card`;
  const fix = (card.fix?.paths ?? []).map((entry) => entry.path).sort();
  const seen = [...shown].sort();
  if (fix.join("\n") !== seen.join("\n"))
    return `The batch's Review shows ${seen.join(", ") || "nothing"}, not the card's reviewed change (${fix.join(", ")})`;
  return null;
}

/** What the crew and its card show, for a failure's message. */
export function crewDiagnostics(
  crew: Crew | undefined,
  cardId: string,
  sessions: readonly Session[],
): string {
  if (!crew) return "no crew";
  const card = crewCard(crew, cardId);
  const chats = crew.members
    .filter((member) => member.sessionId)
    .map((member) => {
      const chat = sessions.find((session) => session.id === member.sessionId);
      const note = chat?.blocks
        .filter((block) => block.role === "system")
        .map((block) => block.text)
        .at(-1);
      return `${member.id}${chat?.busy ? " (busy)" : ""}${note ? `: ${note.slice(0, 160)}` : ""}`;
    });
  return [
    `crew ${crew.on ? "on" : "off"}${crew.paused ? ", paused" : ""}${crew.hold ? `, held (${crew.hold.reason})` : ""}`,
    card
      ? `card ${card.stage} round ${card.round}${card.holder ? ` with ${card.holder}` : ""}${card.stuck ? `: ${card.stuck.text}` : ""}`
      : "no card",
    crew.lastError ? `last error: ${crew.lastError.text}` : "",
    `feed: ${crew.feed
      .slice(-4)
      .map((entry) => entry.text.slice(0, 120))
      .join(" | ")}`,
    chats.length ? `chats: ${chats.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function checkCrew(
  get: () => { sessions: readonly Session[] },
  project: string,
  crew: SmokeCrew,
): Promise<string> {
  // Quiet hours would hold the crew on a runner whose clock is at night. In a
  // fresh profile the crew doesn't exist yet; this creates it with them off.
  const quiet = (getCrew(project) ?? newCrew(project)).limits.quiet;
  setCrewQuietHours(project, { ...quiet, on: false });
  const off = await crew.turnOn(project);
  if (off) throw new Error(`The crew didn't turn on: ${off}`);
  const idea = await addFeatureIdea(project, {
    title: "Crew check",
    note: `Write the check file. ${SMOKE_CREW_WORD}`,
  });
  if (!idea) throw new Error("Couldn't add the check's card to the Board");
  const fail = (error: unknown, cardId: string): never => {
    throw new Error(
      `${errorText(error)} (${crewDiagnostics(getCrew(project), cardId, get().sessions)})`,
    );
  };
  let summary = "";
  try {
    const refused = await giveCardToCrew(project, idea);
    if (refused) throw new Error(`Give to crew refused: ${refused}`);

    // The Builder's turn runs in the crew's copy, with its rules.
    const started = await waitFor(
      () => {
        const current = getCrew(project);
        const card = current ? crewCard(current, idea.id) : undefined;
        if (card?.stage === "stuck") throw new Error(card.stuck?.text);
        return card?.turn?.role === "builder" && current?.copy
          ? { sessionId: card.turn.sessionId, copy: current.copy.path }
          : null;
      },
      90_000,
      "the Builder's first turn",
    );
    const chat = get().sessions.find(
      (session) => session.id === started.sessionId,
    );
    if (!chat) throw new Error("The Builder's chat isn't loaded");
    if (!chat.worktreeCwd || !samePath(chat.worktreeCwd, started.copy))
      throw new Error(
        `The Builder's chat runs in ${chat.worktreeCwd ?? chat.cwd}, not the crew's copy`,
      );
    const permissions = sessionPermissions(chat.id);
    if (
      !permissions?.sandbox?.enabled ||
      !permissions.workFolder ||
      !samePath(permissions.workFolder, started.copy) ||
      !permissions.userSettingsOnly ||
      !permissions.noMcp ||
      permissions.refuse
    )
      throw new Error(
        `The Builder's chat didn't resolve its rules: ${JSON.stringify({
          sandbox: permissions?.sandbox?.enabled ?? false,
          workFolder: permissions?.workFolder ?? null,
          userSettingsOnly: permissions?.userSettingsOnly ?? false,
          noMcp: permissions?.noMcp ?? false,
          refuse: permissions?.refuse ?? null,
        })}`,
      );

    // Not yet once, then a pass from the Checker and Security: Ready in round 2.
    const ready = await waitFor(
      () => {
        const current = getCrew(project);
        const card = current ? crewCard(current, idea.id) : undefined;
        if (card?.stage === "stuck") throw new Error(card.stuck?.text);
        return card?.stage === "ready" ? card : null;
      },
      180_000,
      "the card to be Ready",
    );
    const round = (n: number) => ready.rounds.find((item) => item.n === n);
    if (ready.round !== 2)
      throw new Error(`The card was Ready after round ${ready.round}, not 2`);
    if (round(1)?.verdict?.pass !== false)
      throw new Error("The Checker didn't say not yet to round 1");
    if (round(2)?.verdict?.pass !== true)
      throw new Error("The Checker didn't pass round 2");
    if (round(2)?.security?.pass !== true)
      throw new Error("Security didn't pass round 2");
    const launched = [
      crewLaunchProblem(
        round(1)?.handoff?.summary,
        started.copy,
        "The Builder",
      ),
      crewLaunchProblem(
        round(1)?.verdict?.summary,
        started.copy,
        "The Checker",
      ),
      crewLaunchProblem(round(2)?.security?.summary, started.copy, "Security"),
    ].filter(Boolean);
    if (launched.length) throw new Error(launched.join("; "));
    const fix = ready.fix;
    if (!fix) throw new Error("The Ready card has no reviewed change");

    // Passed work waits on the crew's branch: one batch, reviewed as the
    // Pipeline's Review shows it, then Apply all by that fingerprint changes
    // your files by exactly the reviewed change.
    const review = await reviewCrewBatch(project);
    if ("error" in review)
      throw new Error(`The batch's Review failed: ${review.error}`);
    const stacked = stackProblem(
      getCrew(project),
      idea.id,
      review.diff.files.map((file) => file.path),
    );
    if (stacked) throw new Error(stacked);
    const before = await gitDiffIndex(project);
    const applied = await applyCrewBatch(project, {
      to: review.to,
      hash: review.diff.hash,
      reviewed: true,
    });
    if (applied) throw new Error(`Apply all refused: ${applied}`);
    const after = await gitDiffIndex(project);
    const left = getCrew(project);
    if (left?.stack)
      throw new Error("The crew's branch still holds a batch after Apply all");
    const done = left ? crewCard(left, idea.id) : undefined;
    if (done?.stage !== "applied")
      throw new Error(
        `The card is ${done?.stage ?? "gone"} after Apply all, not applied`,
      );
    const problem = appliedProblem(
      before.files,
      after.files,
      fix.paths.map((entry) => entry.path),
    );
    if (problem) throw new Error(problem);
    const written = await crew.readFile(`${project}/${SMOKE_CREW_FILE}`);
    if (written !== "round 2\n")
      throw new Error(
        `${SMOKE_CREW_FILE} reads ${JSON.stringify(written)} after Apply, not round 2's`,
      );
    summary = `Ready after round 2 (${fix.files} file, fingerprint ${fix.hash.slice(0, 8)}), stacked on the crew's branch and applied as reviewed with Apply all`;
  } catch (error) {
    fail(error, idea.id);
  }

  // Turned off while a turn is prepared: nothing goes, and its chat can't start.
  const second = await addFeatureIdea(project, {
    title: "Crew off check",
    note: `Write the check file again. ${SMOKE_CREW_WORD}`,
  });
  if (!second) throw new Error("Couldn't add the second check card");
  const hold = holdNextCrewSend();
  try {
    const refused = await giveCardToCrew(project, second);
    if (refused) throw new Error(`Give to crew refused: ${refused}`);
    const held = await Promise.race([
      hold.reached,
      wait(90_000).then(() => {
        throw new Error("The next turn was never prepared");
      }),
    ]);
    const blocks = () =>
      get().sessions.find((session) => session.id === held)?.blocks.length ?? 0;
    const sent = blocks();
    await turnOffCrew(project);
    hold.release();
    await wait(2_000);
    const current = getCrew(project);
    const card = current ? crewCard(current, second.id) : undefined;
    if (current?.on) throw new Error("The crew is still on");
    if (card?.turn) throw new Error("A turn went to the crew after it was off");
    if (blocks() !== sent)
      throw new Error("The held chat got a message after the crew was off");
    if (get().sessions.find((session) => session.id === held)?.busy)
      throw new Error("The held chat is working after the crew was off");
    const copy = current?.copy?.path ?? "";
    if (!launchRefusal(held, copy))
      throw new Error("The crew's chat would still start with the crew off");
  } catch (error) {
    hold.release();
    fail(error, second.id);
  }
  return `${summary}; a turn held while prepared didn't go once the crew was off`;
}

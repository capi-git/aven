import { getActivitySnapshot, type ActivityEntry } from "./activity";
import { errorText, logError } from "./errors";
import { homeDir } from "./fs";
import { isHarnessAvailable } from "./harness/availability";
import { claudeTextModel, runClaudeTextPrompt } from "./harness/claudeText";
import { codexTextModel, runCodexTextPrompt } from "./harness/codexText";
import {
  getKeeperProject,
  updateKeeperProject,
  KEEPER_RUN_LEASE_MS,
  type KeeperChange,
  type KeeperKind,
} from "./memoryKeeper";
import {
  buildGitDigest,
  buildProjectDigest,
  NATIVE_DIGEST_SOURCES,
  projectTurns,
  recentWorkDigest,
  type DigestSources,
} from "./memoryKeeperDigest";
import {
  analyzeMemory,
  FILL_SECTIONS,
  keeperBudget,
  lineDiff,
  mergeKeeperReply,
  renderSections,
  restoreKeeperBlock,
  UPDATE_SECTIONS,
  type MemoryAnalysis,
} from "./memoryKeeperFormat";
import {
  buildFillPrompt,
  buildUpdatePrompt,
  MEMORY_KEEPER_SYSTEM_PROMPT,
  parseKeeperReply,
  promptWithRules,
} from "./memoryKeeperPrompt";
import { cleanUntrusted } from "./memoryKeeperSafety";
import { projectName } from "./paths";
import {
  isProjectMemoryConflict,
  loadProjectMemory,
  PROJECT_MEMORY_MAX_CHARS,
  saveProjectMemory,
  type ProjectMemory,
} from "./projectMemory";
import type { RateLimitProvider } from "./rateLimits";

/** The model that keeps memories: the cheapest one Aven can run without tools. */
export type KeeperModel = { harness: RateLimitProvider; label: string };

export function pickKeeperModel(
  available: (id: RateLimitProvider) => boolean = isHarnessAvailable,
): KeeperModel | null {
  if (available("claude"))
    return { harness: "claude", label: `Claude · ${claudeTextModel().name}` };
  if (available("codex"))
    return { harness: "codex", label: `Codex · ${codexTextModel().name}` };
  return null;
}

const KEEPER_TIMEOUT_MS = 120_000;
const MEMORY_FULL =
  "Your notes leave no room for Aven's sections. Shorten them to let it keep the memory.";
/** A first fill also reads chats from this far back. */
const FILL_LOOKBACK_MS = 14 * 24 * 60 * 60_000;

/**
 * One text-only model call: no tools, no project folder (it runs from the
 * home folder, so no project instructions load), and for Claude its own
 * system prompt in place of Claude Code's.
 */
export async function generateKeeperText(
  model: KeeperModel,
  input: { system: string; prompt: string },
): Promise<string> {
  const cwd = await homeDir();
  if (model.harness === "claude")
    return runClaudeTextPrompt({
      cwd,
      prompt: input.prompt,
      timeoutMs: KEEPER_TIMEOUT_MS,
      profile: { systemPrompt: input.system, textOnly: true },
    });
  return runCodexTextPrompt({
    cwd,
    prompt: promptWithRules(input.prompt),
    timeoutMs: KEEPER_TIMEOUT_MS,
    textOnly: true,
  });
}

export type KeeperDeps = {
  loadMemory: (path: string) => Promise<ProjectMemory | null>;
  saveMemory: (
    path: string,
    body: string,
    baseUpdatedAt: number,
  ) => Promise<ProjectMemory | null>;
  generate: (
    model: KeeperModel,
    input: { system: string; prompt: string },
  ) => Promise<string>;
  digestSources: DigestSources;
  activity: () => readonly ActivityEntry[];
  now: () => number;
};

export const NATIVE_KEEPER_DEPS: KeeperDeps = {
  loadMemory: loadProjectMemory,
  saveMemory: saveProjectMemory,
  generate: generateKeeperText,
  digestSources: NATIVE_DIGEST_SOURCES,
  activity: getActivitySnapshot,
  now: Date.now,
};

/** Finished turns in the project since the keeper's last pass. */
export function keeperTurnsSince(
  project: string,
  entries: readonly ActivityEntry[],
): number {
  const state = getKeeperProject(project);
  const since = state.lastRunAt ?? state.enabledAt ?? 0;
  return projectTurns(entries, project, since).filter(
    (entry) => entry.outcome === "completed",
  ).length;
}

export type KeeperPassResult =
  | { status: "written"; change: KeeperChange }
  | { status: "unchanged" }
  | { status: "full" }
  | { status: "skipped" }
  | { status: "failed"; error: string };

function sameBody(a: string, b: string) {
  return a.replace(/\r\n?/g, "\n").trim() === b.replace(/\r\n?/g, "\n").trim();
}

async function buildPrompt(
  project: string,
  kind: KeeperKind,
  analysis: MemoryAnalysis,
  deps: KeeperDeps,
  since: number,
): Promise<string> {
  const name = projectName(project);
  const maxChars = keeperBudget(analysis.userText, PROJECT_MEMORY_MAX_CHARS);
  const [gitHistory, digest] = await Promise.all([
    buildGitDigest(project, deps.digestSources),
    kind === "fill"
      ? buildProjectDigest(project, deps.digestSources)
      : Promise.resolve(""),
  ]);
  const recentWork = recentWorkDigest(deps.activity(), project, since);
  const userNotes = cleanUntrusted(analysis.userText, 2_500);
  if (kind === "fill")
    return buildFillPrompt({
      project: name,
      sections: FILL_SECTIONS,
      digest,
      gitHistory,
      recentWork,
      userNotes,
      maxChars,
    });
  return buildUpdatePrompt({
    project: name,
    sections: UPDATE_SECTIONS,
    currentMemory: cleanUntrusted(renderSections(analysis.kept), 4_500),
    gitHistory,
    recentWork,
    userNotes,
    removedLines: analysis.removed.map((line) => cleanUntrusted(line, 300)),
    maxChars,
  });
}

/**
 * One keeper pass over a project: read the memory, ask the model with a
 * digest Aven built, merge the reply into the keeper's block and save it
 * against the version read. A save that meets a newer memory merges again
 * onto that one, once. Failures are logged and recorded, never thrown.
 */
export async function runKeeperPass(
  input: {
    project: string;
    kind: KeeperKind;
    model: KeeperModel;
    /** This window, so two windows never run the same pass. */
    owner: string;
  },
  deps: KeeperDeps = NATIVE_KEEPER_DEPS,
): Promise<KeeperPassResult> {
  const { project, model, owner } = input;
  const started = deps.now();
  let claimed = false;
  const before = getKeeperProject(project);
  updateKeeperProject(project, (state) => {
    if (
      state.running &&
      state.running.owner !== owner &&
      started - state.running.since < KEEPER_RUN_LEASE_MS
    )
      return state;
    claimed = true;
    return {
      ...state,
      running: { since: started, owner },
      lastAttemptAt: started,
      requested: undefined,
    };
  });
  if (!claimed) return { status: "skipped" };

  try {
    let memory = await deps.loadMemory(project);
    let analysis = analyzeMemory(memory?.body ?? "", before.baseline ?? null);
    const kind: KeeperKind = analysis.parts.auto == null ? "fill" : input.kind;
    const sections = kind === "fill" ? FILL_SECTIONS : UPDATE_SECTIONS;
    if (keeperBudget(analysis.userText, PROJECT_MEMORY_MAX_CHARS) < 300) {
      finish(project, { lastRunAt: started, lastError: MEMORY_FULL });
      return { status: "full" };
    }
    const since =
      kind === "fill"
        ? started - FILL_LOOKBACK_MS
        : (before.lastRunAt ?? before.enabledAt ?? 0);
    const prompt = await buildPrompt(project, kind, analysis, deps, since);
    const reply = await deps.generate(model, {
      system: MEMORY_KEEPER_SYSTEM_PROMPT,
      prompt,
    });
    const parsed = parseKeeperReply(reply, sections);

    for (let attempt = 0; ; attempt += 1) {
      const body = memory?.body ?? "";
      const merged = mergeKeeperReply({
        analysis,
        reply: parsed,
        replace: sections,
        maxChars: PROJECT_MEMORY_MAX_CHARS,
      });
      if (!merged) {
        finish(project, { lastRunAt: started, lastError: MEMORY_FULL });
        return { status: "full" };
      }
      if (sameBody(body, merged.body)) {
        finish(project, {
          lastRunAt: started,
          baseline: merged.baseline,
          model: model.label,
        });
        return { status: "unchanged" };
      }
      try {
        const saved = await deps.saveMemory(
          project,
          merged.body,
          memory?.updatedAt ?? 0,
        );
        const change: KeeperChange = {
          at: deps.now(),
          kind,
          ...lineDiff(body, merged.body),
          before: body,
          baselineBefore: before.baseline ?? null,
          updatedAt: saved?.updatedAt ?? 0,
          seen: false,
        };
        finish(project, {
          lastRunAt: started,
          baseline: merged.baseline,
          model: model.label,
          change,
        });
        return { status: "written", change };
      } catch (error) {
        if (attempt > 0 || !isProjectMemoryConflict(error)) throw error;
        // The user saved meanwhile: merge the same reply onto their version.
        memory = await deps.loadMemory(project);
        analysis = analyzeMemory(memory?.body ?? "", before.baseline ?? null);
      }
    }
  } catch (error) {
    logError("Memory keeper", error);
    const reason = errorText(error).split("\n")[0].slice(0, 200);
    finish(project, { lastError: reason || "Failed" });
    return { status: "failed", error: reason };
  }
}

/** End a pass: release the claim and record what happened. */
function finish(
  project: string,
  outcome: {
    lastRunAt?: number;
    baseline?: string;
    model?: string;
    change?: KeeperChange;
    lastError?: string;
  },
) {
  updateKeeperProject(project, (state) => ({
    ...state,
    running: undefined,
    ...(outcome.lastRunAt != null ? { lastRunAt: outcome.lastRunAt } : {}),
    ...(outcome.baseline != null ? { baseline: outcome.baseline } : {}),
    ...(outcome.model ? { model: outcome.model } : {}),
    ...(outcome.change ? { change: outcome.change } : {}),
    lastError: outcome.lastError,
  }));
}

/**
 * Undo the keeper's last change. When nothing changed since, the memory
 * returns exactly to what it was; otherwise only the keeper's block goes
 * back, and everything the user wrote since stays. Undoing a first fill also
 * stops keeping the memory, so it is not filled again an hour later.
 */
export async function undoKeeperChange(
  project: string,
  deps: Pick<KeeperDeps, "loadMemory" | "saveMemory"> = NATIVE_KEEPER_DEPS,
): Promise<void> {
  const change = getKeeperProject(project).change;
  if (!change || change.undone) return;
  const memory = await deps.loadMemory(project);
  const current = memory?.body ?? "";
  const next =
    memory && memory.updatedAt === change.updatedAt
      ? change.before
      : restoreKeeperBlock(current, change.before);
  await deps.saveMemory(project, next, memory?.updatedAt ?? 0);
  const firstFill = change.kind === "fill" && !change.baselineBefore;
  updateKeeperProject(project, (state) => ({
    ...state,
    baseline: change.baselineBefore ?? undefined,
    change: { ...change, undone: true, seen: true },
    ...(firstFill
      ? { consent: "off" as const, requested: undefined, enabledAt: undefined }
      : {}),
  }));
}

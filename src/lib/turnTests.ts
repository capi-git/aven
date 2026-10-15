import { isExecuteTool } from "./harness/preview";
import { isEqualOrInside } from "./paths";
import { sessionWorkCwd, type Block, type Session } from "./session";

export type TestRunStatus = "passed" | "failed" | "running" | "stopped";

export type TestRun = {
  command: string;
  status: TestRunStatus;
  /** Counts read from the runner's output, when it printed them. */
  passed?: number;
  failed?: number;
};

/** What the agent's latest turn did about tests. */
export type TurnTests = {
  runs: TestRun[];
  /** The last run decides: an agent often fixes a failure and runs again. */
  latest: TestRun | null;
};

// Runners and package scripts that run a test suite. A command line may chain
// several commands; each part is checked on its own.
const TEST_COMMANDS: RegExp[] = [
  /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|t)(?::[\w:-]+)?(?:\s|$)/,
  /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:[\w-]+:)?(?:test|tests|spec|e2e|unit)(?::[\w:-]+)?(?:\s|$)/,
  /^(?:npx|pnpx|bunx|pnpm\s+exec|pnpm\s+dlx|yarn\s+dlx|pnpm|yarn)\s+(?:vitest|jest|mocha|ava|tap|playwright\s+test|cypress\s+run)(?:\s|$)/,
  /^(?:vitest|jest|mocha|ava|tap)(?:\s|$)/,
  /^(?:playwright\s+test|cypress\s+run)(?:\s|$)/,
  /^bun\s+test(?:\s|$)/,
  /^deno\s+test(?:\s|$)/,
  /^node\s+--test(?:\s|$)/,
  /^(?:python3?|py)\s+-m\s+(?:pytest|unittest)(?:\s|$)/,
  /^(?:pytest|py\.test|tox|nox)(?:\s|$)/,
  /^(?:uv|poetry|pdm|hatch)\s+run\s+(?:pytest|tox|python3?\s+-m\s+pytest)(?:\s|$)/,
  /^cargo\s+(?:\+\S+\s+)?(?:test|nextest)(?:\s|$)/,
  /^go\s+test(?:\s|$)/,
  /^swift\s+test(?:\s|$)/,
  /^xcodebuild\b.*\s(?:test|test-without-building)(?:\s|$)/,
  /^dotnet\s+test(?:\s|$)/,
  /^(?:mvn|\.\/mvnw)\s+(?:\S+\s+)*(?:test|verify)(?:\s|$)/,
  /^(?:gradle|\.\/gradlew)\s+(?:\S+\s+)*(?:test|check)(?:\s|$)/,
  /^(?:bundle\s+exec\s+)?(?:rspec|rake\s+test|rails\s+test)(?:\s|$)/,
  /^mix\s+test(?:\s|$)/,
  /^(?:\.\/vendor\/bin\/)?phpunit(?:\s|$)/,
  /^ctest(?:\s|$)/,
  /^make\s+(?:\S+\s+)*(?:test|tests|check)(?:\s|$)/,
];

/** Leading words that wrap the real command: env assignments, `time`, `timeout 60`. */
function unwrapCommand(part: string): string {
  let text = part.trim().replace(/^\(+/, "").trim();
  for (;;) {
    const next = text
      .replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)/, "")
      .replace(/^(?:env|time|command|exec|nice|caffeinate)\s+/, "")
      .replace(/^timeout\s+(?:-\S+\s+)*\d+[smh]?\s+/, "")
      .replace(/^(?:sudo)\s+/, "")
      // Environment wrappers such as `./scripts/with-dev-env.sh cargo test`.
      .replace(/^\S+\.sh\s+(?=\S)/, "");
    if (next === text) return text;
    text = next.trim();
  }
}

/** Whether a shell command line runs a test suite. */
export function isTestCommand(command: string): boolean {
  const text = command.trim();
  if (!text) return false;
  // Split chains and pipes, but not `||` inside quoted text; good enough for
  // the one-line commands agents run.
  return text
    .split(/&&|\|\||;|\||\n/)
    .map(unwrapCommand)
    .some((part) => TEST_COMMANDS.some((pattern) => pattern.test(part)));
}

function count(text: string, pattern: RegExp): number | undefined {
  let total: number | undefined;
  for (const match of text.matchAll(pattern)) {
    total = (total ?? 0) + Number(match[1]);
  }
  return total;
}

/**
 * Passed and failed counts from a runner's summary line. Only summary lines
 * are read, so file-level counts ("Test Files 3 passed") are not added in.
 */
export function testCounts(output: string): {
  passed?: number;
  failed?: number;
} {
  const text = output.slice(-20_000);
  // Vitest "Tests  2 failed | 40 passed (42)", Jest "Tests: 1 failed, 3 passed, 4 total".
  const tests = [...text.matchAll(/^\s*Tests:?\s+(.+)$/gm)].pop()?.[1];
  if (tests) {
    return {
      passed: count(tests, /(\d+)\s+passed/g),
      failed: count(tests, /(\d+)\s+failed/g),
    };
  }
  // cargo: one "test result:" per test binary.
  if (/test result:/.test(text)) {
    return {
      passed: count(text, /test result: \w+\. (\d+) passed/g),
      failed: count(text, /test result: \w+\. \d+ passed; (\d+) failed/g),
    };
  }
  // pytest "===== 3 failed, 12 passed in 1.2s =====".
  const pytest = [
    ...text.matchAll(/^=+ (.+?) in [\d.]+s(?: \([^)]*\))? =+$/gm),
  ].pop()?.[1];
  if (pytest) {
    return {
      passed: count(pytest, /(\d+) passed/g),
      failed: count(pytest, /(\d+) (?:failed|errors?)/g),
    };
  }
  return {};
}

function toolStatus(block: Block): TestRunStatus {
  const status = block.tool?.status?.trim().toLowerCase() ?? "";
  if (["failed", "error"].includes(status)) return "failed";
  if (["cancelled", "canceled", "declined", "interrupted"].includes(status))
    return "stopped";
  if (block.approval?.decided === "deny") return "stopped";
  if (["completed", "success"].includes(status)) return "passed";
  return block.streaming ? "running" : "stopped";
}

function commandOf(block: Block): string {
  const title = block.tool?.title?.trim();
  return title || block.text.trim();
}

/** Where the latest turn starts: the last message the person sent. */
function latestTurnStart(blocks: readonly Block[]): number {
  let fallback = -1;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block.role !== "user") continue;
    if (!block.internal) return index;
    if (fallback < 0) fallback = index;
  }
  return fallback;
}

/**
 * Test commands the agent ran in its latest turn and how each ended, read from
 * the shell tool calls in the transcript. A command counts when it looks like
 * a test runner (npm test, vitest, pytest, cargo test, go test and so on).
 */
export function latestTurnTests(blocks: readonly Block[]): TurnTests {
  const start = latestTurnStart(blocks);
  const runs: TestRun[] = [];
  for (let index = Math.max(0, start + 1); index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.role !== "tool" || !block.tool) continue;
    const { kind, preview } = block.tool;
    const command = commandOf(block);
    if (!isExecuteTool(kind, command) && preview?.kind !== "shell") continue;
    if (!isTestCommand(command)) continue;
    let status = toolStatus(block);
    const counts = testCounts(block.tool.detail ?? preview?.output ?? "");
    // A runner can exit 0 after reporting failures (watch mode, `|| true`).
    if (status === "passed" && (counts.failed ?? 0) > 0) status = "failed";
    runs.push({
      command: command.split("\n")[0]?.trim() ?? command,
      status,
      ...(counts.passed !== undefined ? { passed: counts.passed } : {}),
      ...(counts.failed !== undefined ? { failed: counts.failed } : {}),
    });
  }
  return { runs, latest: runs[runs.length - 1] ?? null };
}

/** One plain line for the Ship flow, e.g. "Tests passed · 42 passed". */
export function describeTurnTests(tests: TurnTests | null): {
  tone: "ok" | "warn" | "busy" | "neutral";
  title: string;
  detail: string;
} {
  const latest = tests?.latest;
  if (!tests || !latest)
    return {
      tone: "neutral",
      title: "No tests ran",
      detail: "The agent didn't run a test command in its last turn.",
    };
  const counts = [
    latest.failed ? `${latest.failed} failed` : null,
    latest.passed !== undefined ? `${latest.passed} passed` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const earlier = tests.runs.length - 1;
  const again =
    earlier > 0
      ? ` after ${earlier} earlier ${earlier === 1 ? "run" : "runs"}`
      : "";
  if (latest.status === "passed")
    return {
      tone: "ok",
      title: `Tests passed${again}`,
      detail: counts ? `${latest.command} · ${counts}` : latest.command,
    };
  if (latest.status === "failed")
    return {
      tone: "warn",
      title: "Tests failed",
      detail: counts ? `${latest.command} · ${counts}` : latest.command,
    };
  if (latest.status === "running")
    return { tone: "busy", title: "Tests are running", detail: latest.command };
  return {
    tone: "neutral",
    title: "Tests didn't finish",
    detail: `${latest.command} was stopped`,
  };
}

function latestTurnAt(session: Session): number {
  for (let index = session.blocks.length - 1; index >= 0; index -= 1) {
    const block = session.blocks[index];
    if (block.role === "user" && !block.internal) return block.startedAt ?? 0;
  }
  return -1;
}

/**
 * The conversation a Ship describes: the one named by the request, otherwise
 * the one working in this folder whose latest turn started most recently.
 */
export function sessionForShip(
  sessions: readonly Session[],
  cwd: string,
  preferredId?: string,
): Session | null {
  if (preferredId) {
    const named = sessions.find((session) => session.id === preferredId);
    if (named) return named;
  }
  let best: Session | null = null;
  let bestAt = -1;
  for (const session of sessions) {
    if (session.inboxAsk) continue;
    const where = sessionWorkCwd(session);
    if (!where || !(isEqualOrInside(where, cwd) || isEqualOrInside(cwd, where)))
      continue;
    const at = latestTurnAt(session);
    if (at > bestAt) {
      best = session;
      bestAt = at;
    }
  }
  return bestAt >= 0 ? best : null;
}

import { describe, expect, it } from "vitest";
import { newSession, type Block, type Session } from "./session";
import {
  describeTurnTests,
  isTestCommand,
  latestTurnTests,
  sessionForShip,
  testCounts,
} from "./turnTests";

let id = 0;
const user = (text = "Do it", internal = false): Block => ({
  id: `u${++id}`,
  role: "user",
  text,
  ...(internal ? { internal: true } : {}),
});
const shell = (
  command: string,
  status: string,
  detail?: string,
  kind = "execute",
): Block => ({
  id: `t${++id}`,
  role: "tool",
  text: command,
  tool: { kind, title: command, status, ...(detail ? { detail } : {}) },
});

describe("isTestCommand", () => {
  it.each([
    "npm test",
    "npm run test",
    "npm run test:unit -- --run",
    "npm t",
    "pnpm test",
    "pnpm vitest run src/lib",
    "yarn test --watch=false",
    "bun test",
    "npx vitest run src/lib/turnTests.test.ts",
    "npx jest --ci",
    "vitest run",
    "npx playwright test",
    "pytest -q tests/",
    "python -m pytest -x",
    "python3 -m unittest discover",
    "uv run pytest",
    "cargo test -p aven --lib",
    "cargo +nightly test",
    "cargo nextest run",
    "go test ./...",
    "swift test",
    "dotnet test",
    "./gradlew test",
    "bundle exec rspec spec/models",
    "mix test",
    "make test",
    "deno test -A",
    "node --test src/x.test.mjs",
    "cd app && npm test 2>&1 | tail -20",
    "CI=1 npm test",
    "timeout 120 cargo test",
    "./scripts/with-dev-env.sh cargo test -p aven --lib",
  ])("recognises %s", (command) => {
    expect(isTestCommand(command)).toBe(true);
  });

  it.each([
    "npm install",
    "npm run build",
    "npm run lint",
    "cargo build",
    "cargo fmt --check",
    "go build ./...",
    "cat package.json | grep test",
    "git commit -m 'add tests'",
    "rg 'pytest' src",
    "ls tests",
    "echo npm test",
    "./scripts/build-release.sh",
    "",
  ])("ignores %s", (command) => {
    expect(isTestCommand(command)).toBe(false);
  });
});

describe("testCounts", () => {
  it("reads Vitest's test line, not its file line", () => {
    expect(
      testCounts(
        " Test Files  1 failed | 4 passed (5)\n      Tests  2 failed | 40 passed (42)\n",
      ),
    ).toEqual({ passed: 40, failed: 2 });
  });

  it("reads Jest, cargo and pytest summaries", () => {
    expect(
      testCounts("Tests:       1 failed, 3 passed, 4 total\nSnapshots: 0"),
    ).toEqual({ passed: 3, failed: 1 });
    expect(
      testCounts(
        "test result: ok. 12 passed; 0 failed; 0 ignored\ntest result: ok. 3 passed; 1 failed; 0 ignored",
      ),
    ).toEqual({ passed: 15, failed: 1 });
    expect(
      testCounts("...\n========= 2 failed, 10 passed in 0.52s =========\n"),
    ).toEqual({ passed: 10, failed: 2 });
  });

  it("returns nothing when no summary was printed", () => {
    expect(testCounts("ok  \texample.com/pkg\t0.12s")).toEqual({});
  });
});

describe("latestTurnTests", () => {
  it("only reads the latest turn, and the last run decides", () => {
    const blocks: Block[] = [
      user("first"),
      shell("npm test", "completed"),
      user("second"),
      shell("npm test", "failed", "Tests  1 failed | 9 passed (10)"),
      shell("npm run build", "completed"),
      user("continue", true),
      shell("npx vitest run", "completed", "Tests  10 passed (10)"),
    ];
    const tests = latestTurnTests(blocks);
    expect(tests.runs.map((run) => run.status)).toEqual(["failed", "passed"]);
    expect(tests.latest).toEqual({
      command: "npx vitest run",
      status: "passed",
      passed: 10,
    });
    expect(describeTurnTests(tests)).toEqual({
      tone: "ok",
      title: "Tests passed after 1 earlier run",
      detail: "npx vitest run · 10 passed",
    });
  });

  it("treats a zero exit that reported failures as failed", () => {
    const tests = latestTurnTests([
      user(),
      shell("npm test || true", "completed", "Tests  3 failed | 1 passed (4)"),
    ]);
    expect(tests.latest?.status).toBe("failed");
    expect(describeTurnTests(tests).title).toBe("Tests failed");
  });

  it("reports running, stopped and missing tests", () => {
    expect(
      latestTurnTests([
        user(),
        { ...shell("cargo test", "in_progress"), streaming: true },
      ]).latest?.status,
    ).toBe("running");
    expect(
      latestTurnTests([user(), shell("go test ./...", "cancelled")]).latest
        ?.status,
    ).toBe("stopped");
    const none = latestTurnTests([user(), shell("npm run lint", "completed")]);
    expect(none.latest).toBeNull();
    expect(describeTurnTests(none).title).toBe("No tests ran");
    expect(describeTurnTests(null).title).toBe("No tests ran");
  });

  it("recognises shell calls by preview kind and by title", () => {
    const viaPreview: Block = {
      id: "p",
      role: "tool",
      text: "pytest -q",
      tool: {
        kind: "other",
        title: "pytest -q",
        status: "completed",
        preview: { kind: "shell", output: "== 4 passed in 0.1s ==" },
      },
    };
    const tests = latestTurnTests([user(), viaPreview]);
    expect(tests.latest).toMatchObject({ status: "passed", passed: 4 });
    // A read of a test file is not a test run.
    expect(
      latestTurnTests([
        user(),
        shell("Read src/a.test.ts", "completed", "", "read"),
      ]).latest,
    ).toBeNull();
  });
});

describe("sessionForShip", () => {
  const session = (
    id: string,
    cwd: string,
    startedAt: number | undefined,
  ): Session => ({
    ...newSession("claude", cwd),
    id,
    blocks: startedAt === undefined ? [] : [{ ...user(), startedAt }],
  });

  it("prefers the named conversation, then the latest turn in this folder", () => {
    const sessions = [
      session("old", "/repo", 10),
      session("new", "/repo/", 20),
      session("other", "/elsewhere", 99),
      session("empty", "/repo", undefined),
    ];
    expect(sessionForShip(sessions, "/repo")?.id).toBe("new");
    expect(sessionForShip(sessions, "/repo", "old")?.id).toBe("old");
    expect(sessionForShip(sessions, "/repo", "missing")?.id).toBe("new");
    expect(sessionForShip(sessions, "/nowhere")).toBeNull();
  });
});

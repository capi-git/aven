import { describe, expect, it } from "vitest";
import {
  analyzeMemory,
  AUTO_END,
  AUTO_START,
  FILL_SECTIONS,
  fitSections,
  formatLineDiff,
  lineDiff,
  mergeKeeperReply,
  parseSections,
  renderSections,
  restoreKeeperBlock,
  splitMemory,
  UPDATE_SECTIONS,
  withoutKeeperMarkers,
  type KeeperSections,
} from "./memoryKeeperFormat";

const MAX = 8_000;

function block(inner: string) {
  return `${AUTO_START}\n${inner}\n${AUTO_END}`;
}

const FIRST: KeeperSections = {
  Stack: ["- TypeScript and React"],
  "How to run": ["- `npm run dev`", "- `npm test`"],
  Conventions: ["- Work on a branch"],
  "In progress": ["- Payments refactor on feat/payments"],
  Gotchas: ["- Tests need Docker"],
};

function fill(body: string, reply: KeeperSections = FIRST) {
  return mergeKeeperReply({
    analysis: analyzeMemory(body, null),
    reply,
    replace: FILL_SECTIONS,
    maxChars: MAX,
  })!;
}

describe("the keeper's block", () => {
  it("fills an empty memory with one delimited block of sections", () => {
    const merged = fill("");
    expect(merged.body.startsWith(AUTO_START)).toBe(true);
    expect(merged.body.endsWith(AUTO_END)).toBe(true);
    expect(merged.body).toContain("## Stack\n- TypeScript and React");
    expect(merged.body).toContain(
      "## How to run\n- `npm run dev`\n- `npm test`",
    );
    // Decisions had nothing yet, so it is left out.
    expect(merged.body).not.toContain("## Decisions");
    expect(merged.baseline).toBe(renderSections(FIRST));
  });

  it("puts the block above the user's existing lines and keeps them as they are", () => {
    const user = "- Use pnpm\n\n# My notes\nKeep the API stable.";
    const merged = fill(user);
    const parts = splitMemory(merged.body);
    expect(parts.auto).toBe(renderSections(FIRST));
    expect(parts.before).toBe("");
    expect(merged.body.endsWith(user)).toBe(true);
  });

  it("finds the block's end when the end marker was deleted", () => {
    const body = `${AUTO_START}\n## Stack\n- Rust\n\n## Gotchas\n- Slow builds\n\nMy own paragraph.`;
    const parts = splitMemory(body);
    expect(parts.auto).toBe("## Stack\n- Rust\n\n## Gotchas\n- Slow builds");
    expect(parts.after).toBe("My own paragraph.");
  });

  it("reads sections and keeps text under unknown headings apart", () => {
    const { sections, loose } = parseSections(
      "## Stack\n- Go\n## My section\n- mine\n### how to run\n- make",
    );
    expect(sections).toEqual({ Stack: ["- Go"], "How to run": ["- make"] });
    expect(loose).toEqual(["## My section", "- mine"]);
  });

  it("hides its markers from agents", () => {
    const body = `${block("## Stack\n- Go")}\n\n- Use pnpm`;
    expect(withoutKeeperMarkers(body)).toBe("## Stack\n- Go\n\n- Use pnpm");
  });
});

describe("user lines are theirs", () => {
  const baseline = renderSections(FIRST);
  const body = `- Use pnpm\n\n${block(baseline)}\n\n- Remembered from a chat`;

  it("never changes text outside the block", () => {
    const merged = mergeKeeperReply({
      analysis: analyzeMemory(body, baseline),
      reply: {
        "How to run": ["- `pnpm dev`"],
        "In progress": [],
        Decisions: ["- Moved to pnpm"],
        Gotchas: ["- Tests need Docker"],
      },
      replace: UPDATE_SECTIONS,
      maxChars: MAX,
    })!;
    expect(merged.body.startsWith("- Use pnpm\n\n")).toBe(true);
    expect(merged.body.endsWith("\n\n- Remembered from a chat")).toBe(true);
    const parts = splitMemory(merged.body);
    expect(parseSections(parts.auto!).sections).toEqual({
      // Stack and Conventions are not the update's to change.
      Stack: ["- TypeScript and React"],
      "How to run": ["- `pnpm dev`"],
      Conventions: ["- Work on a branch"],
      Decisions: ["- Moved to pnpm"],
      Gotchas: ["- Tests need Docker"],
    });
  });

  it("moves a line the user edited inside the block out of it, and does not write the old one again", () => {
    const edited = body.replace("- `npm test`", "- `npm test -- --run`");
    const analysis = analyzeMemory(edited, baseline);
    expect(analysis.claimed).toEqual(["- `npm test -- --run`"]);
    expect(analysis.removed).toEqual(["- `npm test`"]);
    const merged = mergeKeeperReply({
      analysis,
      reply: {
        "How to run": ["- `npm run dev`", "- `npm test`"],
        Gotchas: ["- Tests need Docker"],
      },
      replace: UPDATE_SECTIONS,
      maxChars: MAX,
    })!;
    const parts = splitMemory(merged.body);
    expect(parts.auto).not.toContain("npm test");
    expect(parts.after.startsWith("- `npm test -- --run`")).toBe(true);
    expect(merged.claimed).toBe(1);
  });

  it("does not repeat what the user already wrote", () => {
    const merged = mergeKeeperReply({
      analysis: analyzeMemory(body, baseline),
      reply: { Gotchas: ["- Tests need Docker", "- use PNPM"] },
      replace: UPDATE_SECTIONS,
      maxChars: MAX,
    })!;
    expect(splitMemory(merged.body).auto).not.toMatch(/pnpm/i);
  });

  it("keeps the keeper's room so the user can still add lines", () => {
    const long = "- ".concat("note ".repeat(1_400));
    expect(
      mergeKeeperReply({
        analysis: analyzeMemory(long, null),
        reply: FIRST,
        replace: FILL_SECTIONS,
        maxChars: MAX,
      }),
    ).toBeNull();
    const medium = "- ".concat("note ".repeat(800));
    const merged = mergeKeeperReply({
      analysis: analyzeMemory(medium, null),
      reply: {
        ...FIRST,
        Gotchas: Array.from(
          { length: 8 },
          (_, i) => `- ${"g".repeat(200)}${i}`,
        ),
      },
      replace: FILL_SECTIONS,
      maxChars: MAX,
    })!;
    expect(merged.body.length).toBeLessThanOrEqual(MAX - 800);
    expect(merged.body.endsWith(medium.trim())).toBe(true);
  });

  it("drops items from the longest section first to fit", () => {
    const fitted = fitSections(
      {
        Stack: ["- a"],
        Gotchas: ["- one", "- two", "- three", "- four"],
      },
      renderSections({ Stack: ["- a"], Gotchas: ["- one", "- two"] }).length,
    );
    expect(fitted).toEqual({ Stack: ["- a"], Gotchas: ["- one", "- two"] });
  });
});

describe("undo and change notes", () => {
  it("puts the previous block back and keeps what the user wrote since", () => {
    const before = `${block("## Stack\n- Go")}\n\n- Mine`;
    const after = `${block("## Stack\n- Go\n- Rust")}\n\n- Mine\n- Added later`;
    expect(restoreKeeperBlock(after, before)).toBe(
      `${block("## Stack\n- Go")}\n\n- Mine\n- Added later`,
    );
    // Undoing a first fill removes the block.
    expect(restoreKeeperBlock(after, "- Mine")).toBe("- Mine\n- Added later");
  });

  it("counts added and removed lines, ignoring the markers", () => {
    const diff = lineDiff(
      block("## Stack\n- Go\n- Old"),
      block("## Stack\n- Go\n- New\n- Newer"),
    );
    expect(diff).toEqual({ added: 2, removed: 1 });
    expect(formatLineDiff(diff)).toBe("+2 −1 lines");
    expect(formatLineDiff({ added: 1, removed: 0 })).toBe("+1 −0 line");
    expect(lineDiff("", block("## Stack\n- Go"))).toEqual({
      added: 2,
      removed: 0,
    });
  });
});

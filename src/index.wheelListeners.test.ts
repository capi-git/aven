import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * In WebKit each wheel listener added or removed restyles the whole page at
 * the next style pass (~35 ms with 7,000 elements), and no DOM change shows
 * it. So the interface adds wheel listeners only where one lives as long as
 * its element and that element rarely comes or goes; scrolling is contained
 * with CSS `overscroll-behavior`, and passive wheel handling goes through
 * React's `onWheel` (React's root already listens). See docs/PERFORMANCE.md.
 */
const ALLOWED: Record<string, string> = {
  // One per prompt rail, for its life (the rail stays mounted, hidden).
  "src/chrome/PromptOutline.tsx": "the rail's own scrolling",
  // One per diff view, for its life: a gesture that starts sideways over a
  // code lane latches to it in WebKit.
  "src/surfaces/UnifiedDiffView.tsx": "the code lanes' vertical scrolling",
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("wheel listeners", () => {
  it("are added only where one lives as long as its element", () => {
    const adding = sources("src").filter((file) =>
      /addEventListener\(\s*["'](?:wheel|mousewheel)["']/.test(
        readFileSync(file, "utf8"),
      ),
    );
    // The speed test's own probe counts them; it is not the interface.
    expect(
      adding.filter((file) => !file.endsWith("lib/devPerf.ts")).sort(),
    ).toEqual(Object.keys(ALLOWED).sort());
  });
});

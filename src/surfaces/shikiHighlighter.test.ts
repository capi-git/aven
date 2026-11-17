import { createJavaScriptRegexEngine, type BundledLanguage } from "shiki";
import { describe, expect, it } from "vitest";
import { createHighlighter, engine } from "./shikiHighlighter";

const SAMPLES: Partial<Record<BundledLanguage, string>> = {
  typescript: [
    "export function visible(rows: Row[], limit = 20): Row[] {",
    "  // Keep the newest rows that are not archived.",
    "  const label = `rows ${rows.length} (${limit})`;",
    "  return rows.filter((row) => !row.archived && /\\w+/u.test(row.name));",
    "}",
  ].join("\n"),
  tsx: 'export const Card = () => <div className="card">{name ?? "—"}</div>;',
  python:
    'def main(args):\n    """Run it."""\n    return f"{args!r}: {len(args)}"',
  css: ".card:is(:hover, :focus-within) > span::before { content: '\\2014'; }",
  rust: 'fn main() { let s = r#"raw"#; println!("{s:?}"); }',
  bash: 'for f in "$@"; do echo "${f%.*}" | sed -E "s/[[:space:]]+/-/g"; done',
};

describe("the Shiki engine", () => {
  it("highlights exactly as the default target does", async () => {
    const langs = Object.keys(SAMPLES) as BundledLanguage[];
    const make = (target?: "ES2024") =>
      createHighlighter({
        themes: ["github-dark"],
        langs,
        engine: target
          ? createJavaScriptRegexEngine({ forgiving: true, target })
          : engine,
      });
    const [ours, latest] = await Promise.all([make(), make("ES2024")]);
    for (const lang of langs) {
      const code = SAMPLES[lang] ?? "";
      const tokens = (highlighter: typeof ours) =>
        highlighter
          .codeToTokens(code, { lang, theme: "github-dark" })
          .tokens.flat()
          .map((token) => `${token.offset}:${token.content}:${token.color}`);
      expect(tokens(ours), lang).toEqual(tokens(latest));
    }
  });
});

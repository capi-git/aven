// Shiki, loaded by codeHighlightPlugin with the first code block to highlight
// rather than with every window. Importing it only here, and this file only
// lazily, keeps the highlighter in a chunk of its own.
import { createHighlighter, createJavaScriptRegexEngine } from "shiki";

export { createHighlighter };

/**
 * One JavaScript regex engine shared by every highlighter.
 *
 * `ES2018` keeps the grammars' regexes on the `u` flag. The default target
 * picks the `v` flag where the engine has it, and WebKit compiles and runs
 * those class sets far slower: the first TypeScript block took ~850 ms
 * (the window froze as a helper's reply reached its first code block) and
 * each later run ~2.6 times as long as with `u`. The tokens are the same
 * (`shikiHighlighter.test.ts`).
 */
export const engine = createJavaScriptRegexEngine({
  forgiving: true,
  target: "ES2018",
});

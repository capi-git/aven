// Shiki, loaded by codeHighlightPlugin with the first code block to highlight
// rather than with every window. Importing it only here, and this file only
// lazily, keeps the highlighter in a chunk of its own.
import { createHighlighter, createJavaScriptRegexEngine } from "shiki";

export { createHighlighter };

/** One JavaScript regex engine shared by every highlighter. */
export const engine = createJavaScriptRegexEngine({ forgiving: true });

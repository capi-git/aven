import type {
  CodeHighlighterPlugin,
  HighlightResult,
  ThemeInput,
} from "@streamdown/code";
import type { BundledLanguage, GrammarState, ThemedToken } from "shiki";
import {
  CODE_LANGUAGES,
  isCodeLanguage,
  normalizeCodeLanguage,
} from "../lib/codeLanguages";

/**
 * `@streamdown/code` keeps every token result in a module-level Map that is
 * never evicted. Streamdown highlights a fence again on every streamed update,
 * so each partial version of every code block an agent wrote stayed in memory
 * for the life of the window. Its key (length plus the first and last 100
 * characters) also let different blocks share a result. This keeps the same
 * `CodeHighlighterPlugin` shape with a bounded LRU and an exact key, and loads
 * languages into one highlighter per theme pair instead of one per language.
 *
 * Mounted blocks hold their tokens in component state, so eviction only means
 * a remounted block briefly shows plain text while it is highlighted again.
 *
 * Shiki itself loads with the first block to highlight rather than with every
 * window; until then blocks show plain text, as they do while a language loads.
 */
const DEFAULT_THEMES: [ThemeInput, ThemeInput] = [
  "github-light",
  "github-dark",
];
const MAX_ENTRIES = 100;
const MAX_CACHED_CHARS = 500_000;
/** Code blocks whose finished lines are kept for the next streamed update. */
const MAX_STREAMING_BLOCKS = 8;

type Highlighter = Awaited<
  ReturnType<typeof import("shiki").createHighlighter>
>;
type HighlightCallback = (result: HighlightResult) => void;
type TokenOptions = {
  lang: BundledLanguage;
  themes: { light: string; dark: string };
};

/**
 * A code block's lines up to its last newline, their tokens, and the grammar
 * state after them. A streamed update only adds lines after these.
 */
type FinishedLines = {
  key: string;
  text: string;
  tokens: ThemedToken[][];
  state: GrammarState;
};

function shiftOffsets(tokens: ThemedToken[][], by: number): ThemedToken[][] {
  if (by === 0) return tokens;
  return tokens.map((line) =>
    line.map((token) => ({ ...token, offset: token.offset + by })),
  );
}

/**
 * Shiki tokenizes line by line, carrying only a grammar state from one line
 * to the next, so continuing from the state after a block's finished lines
 * gives the tokens a full run would. A streamed fence then costs its new
 * lines, not all of them: Shiki's JavaScript engine takes about half a
 * millisecond a line in WebKit, so a 150-line fence cost ~75 ms per update.
 */
export function highlightFromFinishedLines(
  highlighter: Pick<Highlighter, "codeToTokens">,
  code: string,
  options: TokenOptions,
  finished: FinishedLines | undefined,
): { result: HighlightResult; finished?: Omit<FinishedLines, "key"> } {
  const end = code.lastIndexOf("\n");
  if (end < 0) return { result: highlighter.codeToTokens(code, options) };
  const text = code.slice(0, end);
  // A full run splits lines on "\r\n" too; tokenizing up to a CRLF's "\r"
  // would leave it on the last finished line, and in copied code.
  const lines = text.endsWith("\r") ? text.slice(0, -1) : text;
  let tokens: ThemedToken[][];
  let state: GrammarState | undefined;
  if (finished && finished.text === text) {
    tokens = finished.tokens;
    state = finished.state;
  } else {
    const start = finished ? finished.text.length + 1 : 0;
    const added = highlighter.codeToTokens(lines.slice(start), {
      ...options,
      grammarState: finished?.state,
    });
    // Plain text has no grammar state to continue from.
    if (!added.grammarState)
      return { result: highlighter.codeToTokens(code, options) };
    tokens = finished
      ? finished.tokens.concat(shiftOffsets(added.tokens, start))
      : added.tokens;
    state = added.grammarState;
  }
  const last = highlighter.codeToTokens(code.slice(end + 1), {
    ...options,
    grammarState: state,
  });
  return {
    result: {
      ...last,
      tokens: tokens.concat(shiftOffsets(last.tokens, end + 1)),
    },
    finished: { text, tokens, state },
  };
}

export type BoundedCodePlugin = CodeHighlighterPlugin & {
  /** Number of token results currently cached. */
  cachedResults(): number;
};

function themeName(theme: ThemeInput): string {
  return typeof theme === "string" ? theme : (theme.name ?? "custom");
}

export function createBoundedCodePlugin(
  options: {
    themes?: [ThemeInput, ThemeInput];
    maxEntries?: number;
    maxChars?: number;
  } = {},
): BoundedCodePlugin {
  const themes = options.themes ?? DEFAULT_THEMES;
  const maxEntries = options.maxEntries ?? MAX_ENTRIES;
  const maxChars = options.maxChars ?? MAX_CACHED_CHARS;
  const highlighters = new Map<string, Promise<Highlighter>>();
  const results = new Map<string, HighlightResult>();
  const pending = new Map<string, Set<HighlightCallback>>();
  let cachedChars = 0;
  // Most recently highlighted last.
  let streaming: FinishedLines[] = [];

  /** The longest finished lines that `code` continues, for this language. */
  const finishedFor = (key: string, code: string) => {
    let best: FinishedLines | undefined;
    for (const entry of streaming) {
      if (
        entry.key === key &&
        (!best || entry.text.length > best.text.length) &&
        code.startsWith(entry.text) &&
        code.charCodeAt(entry.text.length) === 10
      )
        best = entry;
    }
    return best;
  };

  const keepFinished = (entry: FinishedLines) => {
    // An entry this one extends is no longer needed.
    streaming = streaming.filter(
      (other) =>
        other.key !== entry.key ||
        !(
          entry.text === other.text ||
          (entry.text.startsWith(other.text) &&
            entry.text.charCodeAt(other.text.length) === 10)
        ),
    );
    streaming.push(entry);
    if (streaming.length > MAX_STREAMING_BLOCKS) streaming.shift();
  };

  const highlighterFor = (pair: [ThemeInput, ThemeInput]) => {
    const key = `${themeName(pair[0])}\u0000${themeName(pair[1])}`;
    let highlighter = highlighters.get(key);
    if (!highlighter) {
      // A failed load is forgotten, so the next block tries Shiki again.
      highlighter = import("./shikiHighlighter").then(
        ({ createHighlighter, engine }) =>
          createHighlighter({ themes: pair, langs: [], engine }),
      );
      highlighters.set(key, highlighter);
      highlighter.catch(() => highlighters.delete(key));
    }
    return highlighter;
  };

  const remember = (key: string, result: HighlightResult) => {
    if (results.delete(key)) cachedChars -= key.length;
    // A block larger than the whole budget is delivered but never cached.
    if (key.length > maxChars) return;
    results.set(key, result);
    cachedChars += key.length;
    while (results.size > maxEntries || cachedChars > maxChars) {
      const oldest = results.keys().next().value;
      if (oldest === undefined) break;
      results.delete(oldest);
      cachedChars -= oldest.length;
    }
  };

  return {
    name: "shiki",
    type: "code-highlighter",
    supportsLanguage: (language) => isCodeLanguage(language),
    getSupportedLanguages: () => [...CODE_LANGUAGES] as BundledLanguage[],
    getThemes: () => themes,
    cachedResults: () => results.size,
    highlight({ code, language, themes: pair }, callback) {
      const lang = normalizeCodeLanguage(language);
      const names = [themeName(pair[0]), themeName(pair[1])] as const;
      const key = `${lang}\u0000${names[0]}\u0000${names[1]}\u0000${code}`;
      const cached = results.get(key);
      if (cached) {
        // Refresh recency so blocks still on screen are evicted last.
        results.delete(key);
        results.set(key, cached);
        return cached;
      }
      const waiting = pending.get(key);
      if (waiting) {
        if (callback) waiting.add(callback);
        return null;
      }
      pending.set(key, new Set(callback ? [callback] : []));
      void highlighterFor(pair)
        .then(async (highlighter) => {
          if (
            isCodeLanguage(lang) &&
            !highlighter.getLoadedLanguages().includes(lang)
          ) {
            await highlighter.loadLanguage(lang as BundledLanguage);
          }
          const usable = highlighter.getLoadedLanguages().includes(lang)
            ? lang
            : "text";
          const linesKey = `${usable}\u0000${names[0]}\u0000${names[1]}`;
          const { result, finished } = highlightFromFinishedLines(
            highlighter,
            code,
            {
              lang: usable as BundledLanguage,
              themes: { light: names[0], dark: names[1] },
            },
            finishedFor(linesKey, code),
          );
          if (finished) keepFinished({ key: linesKey, ...finished });
          remember(key, result);
          const callbacks = pending.get(key);
          pending.delete(key);
          callbacks?.forEach((notify) => notify(result));
        })
        .catch((error: unknown) => {
          pending.delete(key);
          console.error("[Code highlight] Failed to highlight code:", error);
        });
      return null;
    },
  };
}

export const boundedCode = createBoundedCodePlugin();

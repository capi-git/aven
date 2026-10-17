// @vitest-environment happy-dom
import { act, createElement, memo } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  Block,
  Streamdown,
  parseMarkdownIntoBlocks,
  type BlockProps,
} from "streamdown";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mergeComparisonImages } from "../lib/streamingMarkdown";
import {
  AgentMarkdown,
  MARKDOWN_COMPONENTS,
  MARKDOWN_PLUGINS,
  markdownRehypePlugins,
} from "./AgentMarkdown";

const blockRenders = vi.hoisted(() => [] as string[]);

// Count the blocks that render; the counter renders Streamdown's own Block.
vi.mock("streamdown", async (importOriginal) => {
  const { createElement: create, memo: remember } = await import("react");
  const original = await importOriginal<typeof import("streamdown")>();
  const Counted = remember((props: BlockProps) => {
    blockRenders.push(props.content);
    return create(original.Block, props);
  });
  return { ...original, Block: Counted };
});

// Highlighting finishes at different times in the two renders; keep code plain.
vi.mock("./codeHighlightPlugin", () => ({
  boundedCode: {
    name: "shiki",
    type: "code-highlighter",
    supportsLanguage: () => true,
    getSupportedLanguages: () => [],
    getThemes: () => ["github-light", "github-dark"],
    highlight: () => null,
  },
}));

/** How AgentMarkdown used Streamdown before it split messages itself. */
const DirectionalBlock = memo(function DirectionalBlock({
  dir,
  ...props
}: BlockProps) {
  const block = createElement(Block, props);
  return dir
    ? createElement("div", { dir, className: "agent-markdown-block" }, block)
    : block;
});

const comparisonBlocks = (markdown: string) =>
  mergeComparisonImages(parseMarkdownIntoBlocks(markdown));

const rehypePlugins = markdownRehypePlugins(false, undefined, false);

function reference(text: string, streaming: boolean) {
  return createElement(Streamdown, {
    BlockComponent: DirectionalBlock,
    className: "agent-markdown min-w-0 font-sans text-sm leading-6 ",
    components: MARKDOWN_COMPONENTS,
    controls: false,
    dir: "auto",
    isAnimating: streaming,
    parseMarkdownIntoBlocksFn: comparisonBlocks,
    plugins: MARKDOWN_PLUGINS,
    rehypePlugins,
    children: text,
  });
}

const STREAMS: Record<string, string> = {
  "code fences opening and closing": [
    "Here is the change:\n\n",
    "```ts\nexport function visible(rows: Row[], limit: number) {\n",
    "  return rows.filter((row) => !row.archived).slice(0, limit);\n}\n```\n\n",
    "Then a tilde fence:\n\n~~~py\nprint('x')\n~~~\n\n",
    "````md\n```inner```\n````\n\nAnd text after it.\n\n",
    "```sh\nnpm run check:web\n",
  ].join(""),
  lists: [
    "Steps:\n\n- Load the project's history once.\n- Merge live tasks into it.\n",
    "  - Nested item with `code`\n  - Another one\n\n",
    "- A loose item after a blank line\n\n  A continuation paragraph.\n\n",
    "1. First\n2. Second with **bold**\n3) Third\n\nAfter the list.\n",
  ].join(""),
  tables: [
    "Results:\n\n| Scenario | Before | After |\n",
    "| --- | ---: | :---: |\n",
    "| Streaming | 56% | 30% |\n",
    "| Typing | 12 ms | 4 ms |\n\nDone.\n",
  ].join(""),
  "nested emphasis": [
    "Some ***bold italic*** and **bold with _italic_ inside** text. ",
    "Then `inline **not bold**` and ~~struck~~ words, 20~25 items, ",
    "a snake_case_name, *one* and _two_.\n\n",
    "Links: [the docs](https://example.com/docs) and [half](https://exa",
  ].join(""),
  structure: [
    "# Title\n\nIntro paragraph.\n\nSetext heading\n===\n\n",
    "> A quote\nwith a lazy line\n\n",
    "Paragraph\n    a continuation\n\n    indented code\n\n",
    "![Before](before.png)\n\n![After](after.png)\n\n---\n\nEnd.",
  ].join(""),
};

let ours: Root;
let oursHost: HTMLDivElement;
let before: Root;
let beforeHost: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  oursHost = document.createElement("div");
  beforeHost = document.createElement("div");
  ours = createRoot(oursHost);
  before = createRoot(beforeHost);
  blockRenders.length = 0;
});

afterEach(async () => {
  await act(async () => {
    ours.unmount();
    before.unmount();
  });
  vi.unstubAllGlobals();
});

/**
 * Both renders stay mounted through the stream, as a reply's does. That
 * matters: Streamdown's own elements skip re-rendering while their source
 * position is unchanged, so a mounted reply can differ from a fresh one.
 */
async function renderBoth(text: string, streaming: boolean) {
  await act(async () => {
    ours.render(createElement(AgentMarkdown, { text, streaming }));
    before.render(reference(text, streaming));
  });
  return { ours: oursHost.innerHTML, before: beforeHost.innerHTML };
}

/** A reply rendered once, as a finished one is when a chat opens. */
async function renderFresh(text: string) {
  const html = async (element: ReturnType<typeof createElement>) => {
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(element));
    const markup = host.innerHTML;
    await act(async () => root.unmount());
    return markup;
  };
  return {
    ours: await html(createElement(AgentMarkdown, { text })),
    before: await html(reference(text, false)),
  };
}

function steps(text: string) {
  const out: string[] = [];
  for (let length = 0; length < text.length; length += 9 + (length % 13))
    out.push(text.slice(0, length));
  return out;
}

describe("AgentMarkdown while streaming", () => {
  for (const [name, stream] of Object.entries(STREAMS)) {
    it(`renders ${name} as Streamdown did at each step and at the end`, async () => {
      for (const text of steps(stream)) {
        const step = await renderBoth(text, true);
        expect(step.ours, JSON.stringify(text)).toBe(step.before);
      }
      const end = await renderBoth(stream, false);
      expect(end.ours).toBe(end.before);
      const fresh = await renderFresh(stream);
      expect(fresh.ours).toBe(fresh.before);
    });
  }

  it("renders a message that rewrites earlier text as Streamdown did", async () => {
    const versions = [
      STREAMS.lists,
      STREAMS.lists.replace("Merge live tasks", "Merge the live tasks"),
      `Intro.\n\n${STREAMS.lists}`,
      STREAMS.lists.slice(0, 90),
      `${STREAMS.lists.slice(0, 90)}\n\n${STREAMS.tables}`,
    ];
    for (const text of versions) {
      const step = await renderBoth(text, true);
      expect(step.ours, JSON.stringify(text)).toBe(step.before);
    }
    const last = versions.at(-1)!;
    const end = await renderBoth(last, false);
    expect(end.ours).toBe(end.before);
  });

  it("renders again only the blocks a streamed update changed", async () => {
    const reply = `${STREAMS.lists}\n${STREAMS.tables}\n${STREAMS.structure}\n\nThe last paragraph`;
    await act(async () =>
      ours.render(
        createElement(AgentMarkdown, { text: reply, streaming: true }),
      ),
    );
    blockRenders.length = 0;
    await act(async () =>
      ours.render(
        createElement(AgentMarkdown, {
          text: `${reply} grows.`,
          streaming: true,
        }),
      ),
    );
    expect(blockRenders).toEqual(["The last paragraph grows."]);
  });
});

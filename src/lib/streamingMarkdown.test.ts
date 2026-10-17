import { readFileSync } from "node:fs";
import remend from "remend";
import { parseMarkdownIntoBlocks } from "streamdown";
import { describe, expect, it, vi } from "vitest";
import {
  completeStreamingBold,
  completeStreamingLinks,
  completeStreamingMarkdown,
  createStreamingBlockSplitter,
  hasIncompleteCodeFence,
  mergeComparisonImages,
} from "./streamingMarkdown";

/** Deterministic pseudo-random numbers, so a failure always reproduces. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

const PIECES = [
  "[",
  "]",
  "(",
  ")",
  "](",
  "![",
  "`",
  "```",
  "```ts\n",
  "*",
  "**",
  "***",
  "_",
  "__",
  "~",
  "~~",
  "$",
  "$$",
  "<",
  ">",
  "<div>",
  "</div>",
  "<a href",
  "\\",
  "\\`",
  "#",
  "# ",
  "-",
  "- ",
  "--",
  "=",
  "==",
  "|",
  ":",
  "1. ",
  "> ",
  "http://x.y/z",
  "a",
  "b",
  "word",
  "x1",
  " ",
  "  ",
  "\t",
  "\n",
  "\n\n",
  "    ",
];

function randomMarkdown(next: () => number, pieces: number) {
  let text = "";
  for (let index = 0; index < pieces; index += 1)
    text += PIECES[Math.floor(next() * PIECES.length)];
  return text;
}

const STREAMS: Record<string, string> = {
  fences: [
    "Here is the change:\n\n",
    "```ts\nexport function visible(rows: Row[], limit: number) {\n",
    "  return rows.filter((row) => !row.archived).slice(0, limit);\n}\n```\n\n",
    "Then a tilde fence:\n\n~~~py\nprint('x')\n~~~\n\n",
    "A longer closer:\n\n````md\n```inner```\n````\n\nAnd text after it.\n\n",
    "```\nunclosed until the end\n\nwith a blank line\n",
  ].join(""),
  lists: [
    "Steps:\n\n- Load the project's history once.\n- Merge live tasks into it.\n",
    "  - Nested item with `code`\n  - Another one\n\n",
    "- A loose item after a blank line\n\n  A continuation paragraph.\n\n",
    "1. First\n2. Second with **bold**\n3) Third\n\n",
    "* star list\n* with *italic* text\n\nAfter the list.\n",
  ].join(""),
  tables: [
    "| Scenario | Before | After |\n",
    "| --- | ---: | :---: |\n",
    "| Streaming | 56% | 30% |\n",
    "| Typing | 12 ms | 4 ms |\n\n",
    "A paragraph that becomes a table header\n| a | b |\n|---|---|\n| 1 | 2 |\n",
  ].join(""),
  emphasis: [
    "Some ***bold italic*** and **bold with _italic_ inside** text. ",
    "Then `inline **not bold**` and ~~struck~~ words, 20~25 items, ",
    "a snake_case_name, *one* and _two_, and __double__.\n\n",
    "Costs $5 and $10, and $$x^2$$ inline.\n\n$$\na + b\n$$\n\n",
    "Escaped \\*stars\\* and \\`ticks\\`. Unclosed **bold at the end",
  ].join(""),
  links: [
    "See [the docs](https://example.com/docs) and [`code`](src/App.tsx#L10). ",
    "An array `rows[0]` and a [nested [link]](x) here.\n\n",
    "![Before](before.png)\n\n![After](after.png)\n\n",
    "An image ![alt text](https://example.com/a.png) inline, then ",
    "a link being written [half](https://exa",
  ].join(""),
  structure: [
    "# Title\n\nIntro paragraph.\n\nSetext heading\n===\n\nAnother\n---\n\n",
    "> A quote\nwith a lazy line\n\n> Second quote\n\n",
    "Paragraph\n    not code, a continuation\n\n    indented code\n\n",
    "<details>\n<summary>More</summary>\n\nHidden **text**\n\n</details>\n\n",
    "---\n\n- [ ] task\n- [x] done\n\nEnd.\n",
  ].join(""),
};

/** The blocks Streamdown made before: split everything, then pair images. */
function fullBlocks(text: string, comparisons = true) {
  const blocks = parseMarkdownIntoBlocks(completeStreamingMarkdown(text));
  return comparisons ? mergeComparisonImages(blocks) : blocks;
}

function chunked(text: string, next: () => number) {
  const steps: string[] = [];
  let length = 0;
  while (length < text.length) {
    length = Math.min(
      text.length,
      length + 1 + Math.floor(next() * (next() < 0.3 ? 3 : 40)),
    );
    steps.push(text.slice(0, length));
  }
  return steps;
}

describe("completeStreamingMarkdown", () => {
  it("matches remend on random Markdown fragments", () => {
    const next = random(7);
    for (let index = 0; index < 20_000; index += 1) {
      const text = randomMarkdown(next, 1 + Math.floor(next() * 40));
      expect(completeStreamingMarkdown(text), JSON.stringify(text)).toBe(
        remend(text),
      );
    }
  });

  it("matches remend at every point of a streamed reply", () => {
    for (const stream of Object.values(STREAMS)) {
      for (let length = 0; length <= stream.length; length += 1) {
        const text = stream.slice(0, length);
        expect(completeStreamingMarkdown(text), JSON.stringify(text)).toBe(
          remend(text),
        );
      }
    }
  });

  it("matches remend's link handler on its own", () => {
    const linksOnly = {
      singleTilde: false,
      comparisonOperators: false,
      htmlTags: false,
      setextHeadings: false,
      boldItalic: false,
      bold: false,
      italic: false,
      inlineCode: false,
      strikethrough: false,
      katex: false,
    };
    const next = random(11);
    for (let index = 0; index < 20_000; index += 1) {
      const text = randomMarkdown(next, 1 + Math.floor(next() * 30));
      // remend drops one trailing space before its handlers run.
      const input =
        text.endsWith(" ") && !text.endsWith("  ") ? `${text}x` : text;
      expect(completeStreamingLinks(input), JSON.stringify(input)).toBe(
        remend(input, linksOnly),
      );
    }
  });

  it("matches remend's bold handler on its own", () => {
    const boldOnly = {
      singleTilde: false,
      comparisonOperators: false,
      htmlTags: false,
      setextHeadings: false,
      links: false,
      images: false,
      boldItalic: false,
      italic: false,
      inlineCode: false,
      strikethrough: false,
      katex: false,
    };
    const next = random(13);
    for (let index = 0; index < 20_000; index += 1) {
      const text = randomMarkdown(next, 1 + Math.floor(next() * 30));
      const input =
        text.endsWith(" ") && !text.endsWith("  ") ? `${text}x` : text;
      expect(completeStreamingBold(input), JSON.stringify(input)).toBe(
        remend(input, boldOnly),
      );
    }
    for (const text of [
      "**open",
      "* **list item\nmore",
      "***",
      "a ** b",
      "`**code` and **bold",
      "```\n**x\n```\n**y",
      "\\`**not code",
      "**",
      "**a**b**",
    ])
      expect(completeStreamingBold(text), JSON.stringify(text)).toBe(
        remend(text, boldOnly),
      );
  });

  it("keeps what remend does with unfinished links and images", () => {
    for (const text of [
      "See [the docs](https://exa",
      "See [the docs",
      "See ![a chart](https://exa",
      "word ![a chart",
      "Code `[x` then [link",
      "```\n[x\n```\nAfter [y",
      "[a [b] c",
      "] then [ then ](",
      "",
      "plain text",
    ])
      expect(completeStreamingMarkdown(text)).toBe(remend(text));
  });

  it("uses the same remend that Streamdown does", () => {
    const own = JSON.parse(readFileSync("package.json", "utf8"));
    const streamdown = JSON.parse(
      readFileSync("node_modules/streamdown/package.json", "utf8"),
    );
    const installed = JSON.parse(
      readFileSync("node_modules/remend/package.json", "utf8"),
    );
    expect(own.dependencies.remend).toBe(streamdown.dependencies.remend);
    expect(installed.version).toBe(streamdown.dependencies.remend);
  });
});

describe("createStreamingBlockSplitter", () => {
  it("splits each step of a stream as a full split would", () => {
    const next = random(3);
    for (const [name, stream] of Object.entries(STREAMS)) {
      const split = createStreamingBlockSplitter();
      for (const text of chunked(stream, next)) {
        const { blocks } = split(completeStreamingMarkdown(text), {
          streaming: true,
          comparisons: true,
        });
        expect(blocks, `${name}: ${JSON.stringify(text)}`).toEqual(
          fullBlocks(text),
        );
      }
    }
  });

  it("splits one character at a time as a full split would", () => {
    const stream = Object.values(STREAMS).join("\n\n");
    const split = createStreamingBlockSplitter();
    for (let length = 0; length <= stream.length; length += 1) {
      const text = stream.slice(0, length);
      const { blocks } = split(completeStreamingMarkdown(text), {
        streaming: true,
        comparisons: true,
      });
      expect(blocks, JSON.stringify(text)).toEqual(fullBlocks(text));
    }
  });

  it("splits random Markdown streams as a full split would", () => {
    const next = random(5);
    for (let round = 0; round < 300; round += 1) {
      const stream = randomMarkdown(next, 40 + Math.floor(next() * 120));
      const split = createStreamingBlockSplitter();
      for (const text of chunked(stream, next)) {
        const { blocks } = split(completeStreamingMarkdown(text), {
          streaming: true,
          comparisons: false,
        });
        expect(blocks, JSON.stringify(text)).toEqual(fullBlocks(text, false));
      }
    }
  });

  it("follows a message that rewrites earlier text", () => {
    const split = createStreamingBlockSplitter();
    const versions = [
      STREAMS.lists,
      STREAMS.lists.replace("Merge live tasks", "Merge the live tasks"),
      `Intro.\n\n${STREAMS.lists}`,
      STREAMS.lists.slice(0, 120),
      `${STREAMS.lists.slice(0, 120)}\n\n${STREAMS.tables}`,
      STREAMS.fences.replace("```ts", "```tsx"),
      `${STREAMS.fences}\n\nMore after the open fence.`,
    ];
    for (const text of versions) {
      const { blocks } = split(completeStreamingMarkdown(text), {
        streaming: true,
        comparisons: true,
      });
      expect(blocks, JSON.stringify(text)).toEqual(fullBlocks(text));
    }
  });

  it("splits only the end of a long reply while it streams", () => {
    const parse = vi.fn(parseMarkdownIntoBlocks);
    const split = createStreamingBlockSplitter(parse);
    // Every fence in this reply is closed.
    const reply = [STREAMS.lists, STREAMS.tables, STREAMS.structure]
      .join("\n\n")
      .repeat(4);
    const options = { streaming: true, comparisons: true };
    split(completeStreamingMarkdown(reply), options);
    parse.mockClear();
    const longer = `${reply}\n\nOne more paragraph.`;
    const { blocks } = split(completeStreamingMarkdown(longer), options);
    expect(blocks).toEqual(fullBlocks(longer));
    expect(parse).toHaveBeenCalledOnce();
    expect(parse.mock.calls[0][0].length).toBeLessThan(200);
  });

  it("splits everything for the final render", () => {
    const parse = vi.fn(parseMarkdownIntoBlocks);
    const split = createStreamingBlockSplitter(parse);
    const reply = Object.values(STREAMS).join("\n\n");
    split(completeStreamingMarkdown(reply.slice(0, -40)), {
      streaming: true,
      comparisons: true,
    });
    parse.mockClear();
    const { blocks } = split(completeStreamingMarkdown(reply), {
      streaming: false,
      comparisons: true,
    });
    expect(parse).toHaveBeenCalledWith(completeStreamingMarkdown(reply));
    expect(blocks).toEqual(fullBlocks(reply));
  });

  it("splits everything when a footnote or reference definition appears", () => {
    const split = createStreamingBlockSplitter();
    const options = { streaming: true, comparisons: true };
    const base = `${STREAMS.lists}\n\n${STREAMS.tables}`;
    split(completeStreamingMarkdown(base), options);
    for (const text of [
      `${base}\n\nA note[^1].\n\n[^1]: The note.`,
      `${base}\n\nSee [docs][d].\n\n[d]: https://example.com`,
      `[d]: https://example.com\n\n${base}\n\n[d]: https://other.example`,
    ]) {
      const { blocks } = split(completeStreamingMarkdown(text), options);
      expect(blocks).toEqual(fullBlocks(text));
    }
  });

  it("works out each block's direction", () => {
    const split = createStreamingBlockSplitter();
    const { blocks, directions } = split("English first.\n\nمرحبا بالعالم\n", {
      streaming: true,
      comparisons: false,
    });
    expect(blocks).toHaveLength(3);
    expect(directions).toEqual(["ltr", "ltr", "rtl"]);
  });
});

describe("hasIncompleteCodeFence", () => {
  it("tells an open fence from a closed one", () => {
    expect(hasIncompleteCodeFence("```ts\nconst a = 1;")).toBe(true);
    expect(hasIncompleteCodeFence("```ts\nconst a = 1;\n```")).toBe(false);
    expect(hasIncompleteCodeFence("~~~\nx\n```")).toBe(true);
    expect(hasIncompleteCodeFence("````\n```\n")).toBe(true);
    expect(hasIncompleteCodeFence("````\n```\n`````")).toBe(false);
    expect(hasIncompleteCodeFence("Plain `code` text")).toBe(false);
  });
});

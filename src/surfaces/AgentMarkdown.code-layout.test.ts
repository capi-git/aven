// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CodeBlock } from "streamdown";
import { readFileSync } from "node:fs";
import { AgentMarkdown } from "./AgentMarkdown";

let styles: HTMLStyleElement;
let host: HTMLDivElement;

beforeEach(() => {
  styles = document.createElement("style");
  styles.textContent = readFileSync("src/index.css", "utf8");
  document.head.appendChild(styles);
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
  styles.remove();
});

describe("markdown code block geometry", () => {
  it.each([1, 20])(
    "uses actual code content instead of an offscreen 200px estimate for %i lines",
    (count) => {
      const code = Array.from(
        { length: count },
        (_, index) => `const value${index} = ${index};`,
      ).join("\n");
      // Server rendering uses Streamdown's plain-code Suspense fallback. The
      // highlighted body later uses the same line markup and CSS geometry.
      host.innerHTML = renderToStaticMarkup(
        createElement(AgentMarkdown, {
          text: `\`\`\`typescript\n${code}\n\`\`\``,
        }),
      );
      const block = host.querySelector<HTMLElement>(
        '[data-streamdown="code-block"]',
      )!;
      expect(block).not.toBeNull();
      const computed = getComputedStyle(block);
      expect(computed.getPropertyValue("content-visibility")).toBe("visible");
      expect(computed.getPropertyValue("contain-intrinsic-size")).toBe("none");
      const lines = block.querySelectorAll(
        '[data-streamdown="code-block-body"] code > span',
      );
      expect(lines).toHaveLength(count);
      expect([...lines].map((line) => line.textContent).join("\n")).toBe(code);
    },
  );

  it("does not override containment on unrelated Streamdown content", () => {
    host.innerHTML = renderToStaticMarkup(
      createElement(CodeBlock, {
        code: "const value = 1;",
        language: "typescript",
      }),
    );
    const block = host.querySelector<HTMLElement>(
      '[data-streamdown="code-block"]',
    )!;
    const computed = getComputedStyle(block);
    expect(computed.getPropertyValue("content-visibility")).toBe("auto");
    expect(computed.getPropertyValue("contain-intrinsic-size")).toBe(
      "auto 200px",
    );
  });
});

describe("markdown block wrappers", () => {
  it("puts each block's direction on a real block box with no margin of its own", () => {
    // Tailwind's compiled `space-y-4` on Streamdown's root, which would
    // otherwise space every wrapper (index.css imports Tailwind at build time).
    const spacing = document.createElement("style");
    spacing.textContent =
      ":where(.space-y-4 > :not(:last-child)) { margin-block-end: 1rem; margin-bottom: 1rem; }";
    document.head.prepend(spacing);
    try {
      host.innerHTML = renderToStaticMarkup(
        createElement(AgentMarkdown, {
          text: "First paragraph.\n\nSecond paragraph.\n\n```ts\nconst a = 1;\n```\n\nLast.",
        }),
      );
      const root = host.querySelector<HTMLElement>(".agent-markdown")!;
      const wrappers = [...root.children] as HTMLElement[];
      const filled = wrappers.filter((wrapper) => wrapper.childElementCount);
      expect(filled).toHaveLength(4);
      for (const wrapper of wrappers) {
        // A display:contents wrapper lets WebKit's triple-click run past the
        // block to the end of the reply.
        expect(wrapper.getAttribute("style") ?? "").not.toContain("contents");
        expect(wrapper.className).toBe("agent-markdown-block");
        expect(wrapper.getAttribute("dir")).toBe("ltr");
        const computed = getComputedStyle(wrapper);
        expect(computed.display).toBe("block");
        expect(computed.marginTop).toBe("0px");
        expect(computed.marginBottom).toBe("0px");
      }
      expect(filled[0]!.firstElementChild!.tagName).toBe("P");
      expect(filled[2]!.querySelector(".markdown-code-shell")).not.toBeNull();
    } finally {
      spacing.remove();
    }
  });
});

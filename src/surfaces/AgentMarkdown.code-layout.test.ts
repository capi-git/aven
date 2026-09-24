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

// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Shiki's chunk "arrives" only when the test releases it.
const shiki = vi.hoisted(() => {
  let release = () => {};
  const arrived = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { loads: 0, arrived, release: () => release() };
});
vi.mock("./shikiHighlighter", async (importOriginal) => {
  shiki.loads += 1;
  await shiki.arrived;
  return importOriginal();
});

import { AgentMarkdown } from "./AgentMarkdown";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("markdown code highlighting", () => {
  it("shows a code block as plain text, then colors it once Shiki loads", async () => {
    const code = "const answer: number = 42;";
    expect(shiki.loads).toBe(0);
    await act(async () => {
      root.render(
        createElement(AgentMarkdown, {
          text: `\`\`\`ts\n${code}\n\`\`\``,
        }),
      );
    });
    const body = () =>
      host.querySelector<HTMLElement>(
        '[data-streamdown="code-block-body"] code',
      );
    // Tokens carry their color in a CSS variable; plain text inherits it.
    const colored = () =>
      [...(body()?.querySelectorAll<HTMLElement>("span[style]") ?? [])].filter(
        (span) => {
          const color = span.style.getPropertyValue("--sdm-c").trim();
          return color !== "" && color !== "inherit";
        },
      );
    const settle = (check: () => void) =>
      vi.waitFor(
        async () => {
          await act(async () => {});
          check();
        },
        { timeout: 15_000, interval: 20 },
      );

    // The block asked for Shiki and shows its code plainly meanwhile.
    await settle(() => {
      expect(shiki.loads).toBe(1);
      expect(body()?.textContent).toBe(code);
    });
    expect(colored()).toHaveLength(0);

    shiki.release();
    await settle(() => expect(colored().length).toBeGreaterThan(1));
    expect(shiki.loads).toBe(1);
    expect(body()?.textContent).toBe(code);
    const colors = new Set(
      colored().map((span) => span.style.getPropertyValue("--sdm-c")),
    );
    expect(colors.size).toBeGreaterThan(1);
  }, 20_000);
});

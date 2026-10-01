import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentMarkdown } from "./AgentMarkdown";

describe("AgentMarkdown text direction", () => {
  it("detects direction independently for RTL and LTR blocks", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: [
          "# راهنمای تنظیمات",
          "",
          "این متن فارسی است.",
          "",
          "1. مرحله اول",
          "2. مرحله دوم",
          "",
          "English remains left to right.",
        ].join("\n"),
      }),
    );

    expect(markup).toMatch(/dir="rtl"[^>]*><h1/);
    expect(markup).toMatch(/dir="rtl"[^>]*><p/);
    expect(markup).toMatch(/dir="rtl"[^>]*><ol/);
    expect(markup).toMatch(/dir="ltr"[^>]*><p/);
  });

  it("isolates links and inline code inside RTL prose", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "مسیر `templates/admin/settings.html` و [پیوند](https://example.com) را بررسی کنید.",
      }),
    );

    expect(markup).toContain('<code dir="ltr"');
    expect(markup).toContain('dir="auto"');
  });

  it("keeps fenced code blocks LTR when their content is Arabic", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "```txt\nمرحبا بالعالم\n```",
      }),
    );

    expect(markup).toContain('class="markdown-code-shell" dir="ltr"');
  });
});

describe("AgentMarkdown inline code", () => {
  it("lets a long inline code span grow instead of clipping to a fixed height", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "1. `Before I refactor the transcript rendering, summarize how turns are grouped, in five bullets.`",
      }),
    );

    const match = markup.match(/<code dir="ltr" class="([^"]*)"/);
    expect(match).not.toBeNull();
    const classes = match![1].split(/\s+/);
    expect(classes).toContain("inline-flex");
    expect(classes).toContain("min-h-6");
    expect(classes).toContain("max-w-full");
    expect(classes).toContain("[overflow-wrap:anywhere]");
    expect(classes).not.toContain("h-6");
  });
});

describe("AgentMarkdown note images", () => {
  it("preserves generated local images instead of silently dropping them", () => {
    const path = "/Users/test/.codex/generated_images/thread/mockup.png";
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: `Here's the mock:\n\n![Mockup](${path})`,
      }),
    );
    expect(markup).toContain(`data-local-image="${path}"`);
    expect(markup).toContain("Loading Mockup");
  });

  it("resolves encoded relative image paths against the task's workspace", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "![Mockup](<output/my mockup.png>)",
        cwd: "/project",
      }),
    );
    expect(markup).toContain(
      'data-local-image="/project/output/my mockup.png"',
    );
  });

  it("does not treat remote inbox content as a local file request", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "![Image](/Users/test/private.png)",
        allowRemoteMedia: true,
      }),
    );
    expect(markup).not.toContain("data-local-image");
  });
  it("keeps app-owned note image references for the async image resolver", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "![Diagram](/note-assets/note-1/123-diagram.png)",
      }),
    );

    expect(markup).toContain(
      'data-note-image="/note-assets/note-1/123-diagram.png"',
    );
    expect(markup).toContain('alt="Diagram"');
  });
});

describe("AgentMarkdown before and after screenshots", () => {
  const dir =
    "/Users/test/Library/Application Support/com.capi.aven.dev/turn-shots/s1";
  const before = `${dir}/1-before.png`;
  const after = `${dir}/2-after.png`;
  const render = (text: string) =>
    renderToStaticMarkup(createElement(AgentMarkdown, { text }));
  const pair = (markup: string) =>
    markup.match(/<div class="markdown-before-after">.*?<\/figure><\/figure>/s);

  it.each([
    ["consecutive lines", `![Before](<${before}>)\n![After](<${after}>)`],
    ["separate paragraphs", `![Before](<${before}>)\n\n![After](<${after}>)`],
  ])("shows a pair on %s side by side with captions", (_, images) => {
    const markup = render(`Updated the header.\n\n${images}\n\nDone.`);
    expect(markup.match(/markdown-before-after"/g)).toHaveLength(1);
    expect(markup).toMatch(
      /<div class="markdown-before-after"><figure class="markdown-before-after-item"><figcaption>Before<\/figcaption><span class="markdown-local-image" data-local-image="[^"]*1-before\.png">.*?<\/figure><figure class="markdown-before-after-item"><figcaption>After<\/figcaption><span class="markdown-local-image" data-local-image="[^"]*2-after\.png">/s,
    );
    expect(markup).toContain(`data-local-image="${before}"`);
    expect(markup).toContain(`data-local-image="${after}"`);
    expect(markup).toContain("Updated the header.");
    expect(markup).toContain("Done.");
  });

  it("keeps descriptive labels as captions", () => {
    const markup = render(
      `![Before: dark header](<${before}>)\n![After: light header](<${after}>)`,
    );
    expect(markup).toContain("<figcaption>Before: dark header</figcaption>");
    expect(markup).toContain("<figcaption>After: light header</figcaption>");
  });

  it("leaves single images and other image pairs unchanged", () => {
    for (const text of [
      `![Before](<${before}>)`,
      `![After](<${after}>)\n![Before](<${before}>)`,
      `![Mockup](/project/a.png)\n![Other](/project/b.png)`,
      `![Before](<${before}>) compared with ![After](<${after}>)`,
      `![Before](<${before}>)\n\nSome text\n\n![After](<${after}>)`,
      `\`\`\`md\n![Before](<${before}>)\n\n![After](<${after}>)\n\`\`\``,
    ]) {
      const markup = render(text);
      expect(pair(markup), text).toBeNull();
      expect(markup).not.toContain("figcaption");
    }
    expect(render(`![Before](<${before}>)`)).toContain(
      `data-local-image="${before}"`,
    );
  });

  it("does not pair remote inbox media", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: `![Before](<${before}>)\n![After](<${after}>)`,
        allowRemoteMedia: true,
      }),
    );
    expect(markup).not.toContain("markdown-before-after");
  });
});

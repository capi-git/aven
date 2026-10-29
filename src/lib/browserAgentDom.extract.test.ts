// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import script from "../../src-tauri/src/browser_agent_dom.js?raw";

type Extracted = {
  ok: boolean;
  kind: string;
  url: string;
  title: string;
  markdown: string;
  images: {
    index: number;
    src: string;
    alt: string;
    caption?: string;
  }[];
  words: number;
  truncated?: boolean;
  imagesTruncated?: boolean;
  collapsed?: number;
  note: string;
  site?: string;
  description?: string;
  author?: string;
};
const evaluate = new Function(`return (${script})`)() as (
  request: Record<string, unknown>,
) => string;
function extract(request: Record<string, unknown> = {}): Extracted {
  const decoded = JSON.parse(
    evaluate({ action: "extract", token: "tok123", ...request }),
  );
  if (typeof decoded.__supermonoAgentError === "string")
    throw new Error(decoded.__supermonoAgentError);
  return decoded;
}

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  document.title = "";
});

/** A leaf as Notion draws one: the block's own editable text. */
const leaf = (html: string, style = "") =>
  `<div spellcheck="true" data-content-editable-leaf="true" contenteditable="false" style="white-space: pre-wrap; ${style}">${html}</div>`;
const block = (kind: string, inner: string, extra = "") =>
  `<div data-block-id="${kind}-${Math.random().toString(36).slice(2)}" class="notion-selectable notion-${kind}-block"${extra}><div style="display:flex">${inner}</div></div>`;
const children = (...blocks: string[]) =>
  `<div style="padding-left: 1.5em">${blocks.join("")}</div>`;

/** A Notion page: chrome around .notion-frame, title outside the content. */
function notionPage(content: string) {
  document.title = "Launch plan | Notion";
  document.body.innerHTML = `
    <div class="notion-sidebar-container"><nav role="navigation"><a href="/x">Private</a><a href="/y">Settings</a></nav></div>
    <main class="notion-frame">
      <div class="notion-topbar"><div role="button">Share</div></div>
      <div class="notion-scroller">
        <div class="notion-page-block">${leaf("Launch plan")}</div>
        <div class="notion-page-content">${content}</div>
      </div>
    </main>
    <div class="notion-overlay-container"><div role="dialog">Comment popup text</div></div>`;
}

describe("agent page extraction", () => {
  it("reads a Notion page's blocks as Markdown without its chrome", () => {
    notionPage(
      [
        block("header", leaf("Goals")),
        block(
          "text",
          leaf(
            'Ship the <span style="font-weight:600">new</span><span style="font-weight:600"> site</span> by <span style="font-style:italic">Friday</span>, see <a href="https://example.com/brief">the brief</a> and <span style="font-family:&quot;SFMono-Regular&quot;, Menlo, monospace">npm run build</span>.',
          ),
        ),
        block("sub_header", leaf("Steps")),
        block(
          "bulleted_list",
          `<div class="pseudoBefore"></div><div>${leaf("Write copy")}${children(block("bulleted_list", leaf("Hero")), block("bulleted_list", leaf("Pricing")))}</div>`,
        ),
        block("bulleted_list", leaf("Pick images")),
        block("numbered_list", leaf("Draft")),
        block("numbered_list", leaf("Review")),
        block(
          "to_do",
          `<div role="checkbox" aria-checked="true"></div>${leaf("Book the domain")}`,
        ),
        block(
          "to_do",
          `<div role="checkbox" aria-checked="false"></div>${leaf("Tell the team")}`,
        ),
        block(
          "to_do",
          `<div class="pseudoHover"><svg class="check"></svg></div><div style="text-decoration: line-through">${leaf("Pick a name")}</div>`,
        ),
        block(
          "to_do",
          `<div><svg class="checkboxSquare"></svg></div>${leaf("Write the FAQ")}`,
        ),
        block(
          "toggle",
          `<div role="button" aria-expanded="true"></div><div>${leaf("Open questions")}${children(block("text", leaf("Who owns analytics?")))}</div>`,
        ),
        block(
          "toggle",
          `<div role="button" aria-expanded="false"></div>${leaf("Archived notes")}`,
        ),
        block(
          "callout",
          `<div class="notion-record-icon"><span>💡</span></div>${leaf("Keep it short.")}`,
        ),
        block("quote", leaf("Less, but better.")),
        block(
          "code",
          `<div role="button">Copy</div><div role="button">JavaScript</div>${leaf('<span class="token keyword">const</span> a = 1;\nconsole.log(a);')}`,
        ),
        block("divider", '<div role="separator"></div>'),
        block(
          "image",
          `<div><img src="https://files.example.com/hero.png" alt=""></div>${leaf("The hero shot")}`,
        ),
        block(
          "table",
          `<table><tbody>
            <tr class="notion-table_row-block"><td>${leaf("Page")}</td><td>${leaf("Owner")}</td></tr>
            <tr class="notion-table_row-block"><td>${leaf("Home")}</td><td>${leaf("Ana | Lee")}</td></tr>
          </tbody></table>`,
        ),
        block("text", leaf("")),
      ].join(""),
    );
    const page = extract();
    expect(page.kind).toBe("notion");
    expect(page.title).toBe("Launch plan");
    expect(page.markdown).toBe(
      [
        "# Goals",
        "Ship the **new site** by *Friday*, see [the brief](https://example.com/brief) and `npm run build`.",
        "## Steps",
        [
          "- Write copy",
          "  - Hero",
          "  - Pricing",
          "- Pick images",
          "1. Draft",
          "2. Review",
          "- [x] Book the domain",
          "- [ ] Tell the team",
          "- [x] Pick a name",
          "- [ ] Write the FAQ",
        ].join("\n"),
        "<details open>\n<summary>Open questions</summary>\n\nWho owns analytics?\n\n</details>",
        "<details>\n<summary>Archived notes</summary>\n</details>",
        "> 💡 Keep it short.",
        "> Less, but better.",
        "```javascript\nconst a = 1;\nconsole.log(a);\n```",
        "---",
        "![The hero shot](aven-image-tok123-1)\n*The hero shot*",
        "| Page | Owner |\n| --- | --- |\n| Home | Ana \\| Lee |",
      ].join("\n\n"),
    );
    expect(page.images).toEqual([
      {
        index: 1,
        src: "https://files.example.com/hero.png",
        alt: "",
        caption: "The hero shot",
        loaded: false,
      },
    ]);
    expect(page.collapsed).toBe(1);
    expect(page.markdown).not.toContain("Private");
    expect(page.markdown).not.toContain("Share");
    expect(page.markdown).not.toContain("Comment popup");
    expect(page.note).toMatch(/untrusted/i);
  });

  it("reads the page open in Notion's side peek when the address names it", () => {
    document.body.innerHTML = `
      <main class="notion-frame"><div class="notion-page-block">${leaf("Board")}</div>
        <div class="notion-page-content">${block("text", leaf("The board behind"))}</div></main>
      <div class="notion-peek-renderer"><div class="notion-page-block">${leaf("Card")}</div>
        <div class="notion-page-content">${block("text", leaf("The card the user opened"))}</div></div>`;
    history.replaceState(null, "", "/Board-abc?p=def&pm=s");
    try {
      const page = extract();
      expect(page.title).toBe("Card");
      expect(page.markdown).toBe("The card the user opened");
    } finally {
      history.replaceState(null, "", "/");
    }
  });

  it("finds an article's main content, drops its repeated title and keeps figures, lists and code", () => {
    document.head.innerHTML =
      '<meta property="og:title" content="How we ship"><meta property="og:site_name" content="Example Blog"><meta name="author" content="Sam">';
    document.title = "How we ship - Example Blog";
    document.body.innerHTML = `
      <header><a href="/">Example</a><nav><a href="/a">About</a></nav></header>
      <main><article>
        <h1>How we ship</h1>
        <p>We ship <strong>every day</strong>.<br>Small changes win.</p>
        <h2>Checklist</h2>
        <ol start="3"><li>Test<ul><li>Unit</li></ul></li><li>Deploy</li></ol>
        <ul><li><input type="checkbox" checked disabled> Done</li></ul>
        <figure><img src="/img/diagram.webp" srcset="/img/diagram-small.webp 400w, /img/diagram-large.webp 1600w" alt="Flow diagram"><figcaption>How a change moves</figcaption></figure>
        <pre><code class="language-ts">const shipped = true;\n</code></pre>
        <blockquote><p>Quote one</p><p>Quote two</p></blockquote>
        <details><summary>More</summary><p>Hidden by default but in the page</p></details>
        <p>Inline math <span class="katex"><span class="katex-mathml"><math><semantics><annotation encoding="application/x-tex">x^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">x2</span></span> here.</p>
        <p style="display:none">Not shown</p>
        <footer>Share this post</footer>
      </article></main>
      <aside>Related posts</aside>
      <footer>© Example</footer>`;
    const page = extract();
    expect(page.kind).toBe("article");
    expect(page.title).toBe("How we ship");
    expect(page.site).toBe("Example Blog");
    expect(page.author).toBe("Sam");
    expect(page.markdown).toBe(
      [
        "We ship **every day**.  \nSmall changes win.",
        "## Checklist",
        "3. Test\n   - Unit\n4. Deploy\n- [x] Done",
        "![Flow diagram](aven-image-tok123-1)\n*How a change moves*",
        "```ts\nconst shipped = true;\n```",
        "> Quote one\n>\n> Quote two",
        "<details>\n<summary>More</summary>\n\nHidden by default but in the page\n\n</details>",
        "Inline math $`x^2`$ here.",
      ].join("\n\n"),
    );
    expect(page.images[0].src).toMatch(/\/img\/diagram-large\.webp$/);
    for (const chrome of [
      "About",
      "Related",
      "© Example",
      "Share this",
      "Not shown",
    ])
      expect(page.markdown).not.toContain(chrome);
  });

  it("escapes Markdown syntax in page text and keeps one file per repeated image", () => {
    document.body.innerHTML = `<article>
      <p># not a heading and *not emphasis* &lt;script&gt;</p>
      <p><img src="https://cdn.example.com/a.png" alt="A"> and again <img src="https://cdn.example.com/a.png" alt="A"></p>
      <table><tr><th>Name</th></tr><tr><td><p>One</p><p>Two</p></td></tr></table>
    </article>`;
    const page = extract();
    expect(page.markdown).toContain(
      "\\# not a heading and \\*not emphasis\\* \\<script\\>",
    );
    expect(page.images).toHaveLength(1);
    expect(page.markdown.match(/aven-image-tok123-1/g)).toHaveLength(2);
    expect(page.markdown).toContain("| One<br />Two |");
  });

  it("stays within its size limits and says when it cut the page short", () => {
    const paragraph = `<p>${"word ".repeat(200)}</p>`;
    document.body.innerHTML = `<article>${paragraph.repeat(40)}${'<img src="https://cdn.example.com/x.png?n=N">'.repeat(1)}</article>`;
    const page = extract({ max: 5000 });
    expect(page.truncated).toBe(true);
    expect(page.markdown.length).toBeLessThanOrEqual(5000);
    const images = Array.from(
      { length: 230 },
      (_, index) => `<img src="https://cdn.example.com/${index}.png">`,
    ).join("");
    document.body.innerHTML = `<article><p>Pictures</p>${images}</article>`;
    const many = extract();
    expect(many.images).toHaveLength(200);
    expect(many.imagesTruncated).toBe(true);
    // The whole reply stays under the byte limit, also for wide characters.
    document.body.innerHTML = `<article>${`<p>${"漢字".repeat(400)}</p>`.repeat(200)}</article>`;
    const wide = evaluate({
      action: "extract",
      token: "tok123",
      maxBytes: 60000,
    });
    expect(new TextEncoder().encode(wide).length).toBeLessThanOrEqual(60000);
    expect(JSON.parse(wide).truncated).toBe(true);
  });

  it("reads without changing the page: no scrolling, focus or new nodes", () => {
    document.body.innerHTML = `<article><h1>T</h1><p>Body</p><input id="field"></article>`;
    const field = document.querySelector<HTMLInputElement>("#field")!;
    field.focus();
    const before = document.body.innerHTML;
    window.scrollTo(0, 0);
    extract();
    expect(document.activeElement).toBe(field);
    expect(document.body.innerHTML).toBe(before);
    expect(window.scrollY).toBe(0);
  });
});

describe("filling in tabs that are not the chat's own", () => {
  it("refuses password and sign-in code fields but fills other fields", () => {
    document.body.innerHTML =
      '<input aria-label="Email" id="email"><input type="password" aria-label="Password" id="pw"><input aria-label="Code" autocomplete="one-time-code" id="otp">';
    const rects = {
      width: 100,
      height: 20,
      top: 0,
      left: 0,
      right: 100,
      bottom: 20,
      x: 0,
      y: 0,
      toJSON() {},
    };
    for (const element of document.querySelectorAll("input"))
      element.getBoundingClientRect = () => rects as DOMRect;
    const snapshot = JSON.parse(
      evaluate({ action: "snapshot", generation: "g" }),
    ) as { elements: { ref: string; label: string }[] };
    const ref = (label: string) =>
      snapshot.elements.find((item) => item.label === label)!.ref;
    const fill = (label: string, extra: Record<string, unknown> = {}) =>
      JSON.parse(
        evaluate({
          action: "fill",
          ref: ref(label),
          value: "secret",
          noPassword: true,
          ...extra,
        }),
      );
    expect(fill("Password").__supermonoAgentError).toMatch(/password/i);
    expect(fill("Code").__supermonoAgentError).toMatch(
      /passwords, sign-in codes or card details/i,
    );
    expect(document.querySelector<HTMLInputElement>("#pw")!.value).toBe("");
    expect(fill("Email").ok).toBe(true);
    expect(document.querySelector<HTMLInputElement>("#email")!.value).toBe(
      "secret",
    );
    // The chat's own page (no flag) keeps working as before.
    expect(
      JSON.parse(
        evaluate({ action: "fill", ref: ref("Password"), value: "pw" }),
      ).ok,
    ).toBe(true);
  });
});

describe("what a page cannot smuggle into an export", () => {
  it("keeps page text inert under CommonMark, raw HTML and MDX", () => {
    // The security review's probe.
    document.body.innerHTML = `<article><h1>Post</h1>
<p>Hello {process.getBuiltinModule('child_process').execSync('id')} world.</p>
<p>export const pwn = 1</p>
<p>import x from 'data:text/javascript,1'</p>
<p>Formula <span class="katex"><annotation encoding="application/x-tex">&lt;img src=x onerror=alert(1)&gt;</annotation></span></p>
<p>Entity &amp;lt;b&amp;gt; and <a href="https://example.com/{x}">a {link}</a></p>
<details><summary>Open {me}</summary><p>Body</p></details>
</article>`;
    const { markdown } = extract();
    expect(markdown).toContain(
      "Hello \\{process.getBuiltinModule('child\\_process').execSync('id')\\} world.",
    );
    expect(markdown).toContain("&#101;xport const pwn = 1");
    expect(markdown).toContain("&#105;mport x from 'data:text/javascript,1'");
    expect(markdown).toContain("Formula $`<img src=x onerror=alert(1)>`$");
    expect(markdown).toContain("Entity \\&lt;b\\&gt;");
    expect(markdown).toContain("[a \\{link\\}](https://example.com/%7Bx%7D)");
    expect(markdown).toContain("<summary>Open &#123;me&#125;</summary>");
    // Nothing outside code is an expression, an ESM line or raw markup.
    const prose = markdown
      .replace(/\$`[^`]*`\$/g, "")
      .replace(/<\/?(details|summary)( open)?>/g, "");
    expect(prose).not.toMatch(/(^|[^\\])[{}<]/);
    expect(prose).not.toMatch(/^(import|export)\b/m);
  });

  it("writes block math as a math code block", () => {
    document.body.innerHTML = `<article><p>Above</p><div class="katex-display"><span class="katex"><annotation encoding="application/x-tex">\\frac{a}{b}</annotation></span></div></article>`;
    expect(extract().markdown).toBe("Above\n\n```math\n\\frac{a}{b}\n```");
  });

  it("prefers the address an image actually loaded over ones it only names", () => {
    document.body.innerHTML = `<article><p>x</p><img src="https://cdn.example.com/shown.png" srcset="https://elsewhere.example/big.png 2000w"></article>`;
    const img = document.querySelector("img")!;
    let width = 800;
    Object.defineProperty(img, "complete", { value: true });
    Object.defineProperty(img, "naturalWidth", { get: () => width });
    expect(extract().images[0]).toMatchObject({
      src: "https://cdn.example.com/shown.png",
      loaded: true,
    });
    width = 0;
    expect(extract().images[0]).toMatchObject({
      src: "https://elsewhere.example/big.png",
      loaded: false,
    });
  });
});

describe("sign-in and card fields in tabs that are not the chat's own", () => {
  const box = {
    width: 40,
    height: 20,
    top: 0,
    left: 0,
    right: 40,
    bottom: 20,
    x: 0,
    y: 0,
    toJSON() {},
  };
  function snapshot(redact: boolean) {
    for (const element of document.querySelectorAll("input,[contenteditable]"))
      (element as HTMLElement).getBoundingClientRect = () => box as DOMRect;
    return JSON.parse(
      evaluate({
        action: "snapshot",
        generation: "g1",
        ...(redact ? { redact: true } : {}),
      }),
    ) as {
      elements: {
        ref: string;
        label: string;
        value?: string;
        redacted?: boolean;
      }[];
    };
  }

  it("never reads their values and never types into them, split code boxes included", () => {
    // The security review's probe, widened.
    document.body.innerHTML = `<form>
      <input id=a aria-label="Code" autocomplete="one-time-code" value="493817">
      <input id=b aria-label="Card" autocomplete="cc-number" value="4111111111111111">
      <input id=c aria-label="CVC" autocomplete="cc-csc" value="123">
      <input id=shown aria-label="Password" type="text" autocomplete="current-password" value="hunter2">
      <input id=named aria-label="Verification" name="verification_code" value="777">
      <span><input aria-label="d1" inputmode=numeric maxlength=1 value="4"><input aria-label="d2" maxlength=1><input aria-label="d3" maxlength=1><input aria-label="d4" maxlength=1></span>
      <div contenteditable="true" aria-label="Sign-in code">55</div>
      <input id=email aria-label="Email" value="a@example.com">
    </form>`;
    const redacted = snapshot(true);
    const json = JSON.stringify(redacted);
    for (const secret of [
      "493817",
      "4111111111111111",
      "hunter2",
      '"777"',
      '"4"',
    ])
      expect(json).not.toContain(secret);
    expect(
      redacted.elements.find((entry) => entry.label === "Email")?.value,
    ).toBe("a@example.com");
    expect(
      redacted.elements.filter((entry) => entry.redacted).length,
    ).toBeGreaterThanOrEqual(6);
    // The chat's own page reads as it did before.
    const own = JSON.stringify(snapshot(false));
    expect(own).toContain("493817");
    const refs = snapshot(true).elements;
    const fill = (label: string) =>
      JSON.parse(
        evaluate({
          action: "fill",
          ref: refs.find((entry) => entry.label === label)!.ref,
          value: "123456",
          noPassword: true,
        }),
      );
    for (const label of [
      "Code",
      "Card",
      "CVC",
      "Password",
      "Verification",
      "d1",
      "Sign-in code",
    ])
      expect(fill(label).__supermonoAgentError, label).toMatch(
        /passwords, sign-in codes or card details/,
      );
    expect(fill("Email").ok).toBe(true);
    // Reads leave an editable code field's text out as well.
    document.body.innerHTML = `<article><p>Enter the code we sent.</p><div contenteditable="true" aria-label="Verification code">918273</div></article>`;
    expect(extract().markdown).toBe("Enter the code we sent.");
  });
});

// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableCSSFileLoading": true, "disableJavaScriptFileLoading": true, "disableJavaScriptEvaluation": true, "disableIframePageLoading": true, "disableComputedStyleRendering": true } }
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MOCKUP_MAX_BYTES,
  insideMockupDir,
  mockupFileName,
  mockupProblem,
  mockupStorePath,
  mockupStoreRoot,
  sanitizeMockupHtml,
} from "./crewMockups";

describe("where a mock-up is drawn and kept", () => {
  it("names the file from the card, and keeps it beside the copies in Aven's data", () => {
    expect(mockupFileName("card-1")).toBe("card-1.html");
    expect(mockupFileName("a b/c:d")).toBe("a-b-c-d.html");
    expect(mockupFileName("")).toBe("mockup.html");
    expect(mockupStorePath("/data/bots/aven-site-crew-1", "card-1")).toBe(
      "/data/bots/mockups/aven-site-crew-1/card-1.html",
    );
    expect(mockupStorePath("/data/bots/aven-site-crew-1/", "card-1")).toBe(
      "/data/bots/mockups/aven-site-crew-1/card-1.html",
    );
    expect(mockupStoreRoot("/data/bots/aven-site-crew-1/")).toBe(
      "/data/bots/mockups",
    );
  });

  it("knows its folder, and nothing that climbs out of it", () => {
    expect(insideMockupDir("aven-mockups/card-1.html")).toBe(true);
    expect(insideMockupDir("./aven-mockups/card-1.html")).toBe(true);
    expect(insideMockupDir("aven-mockups\\card-1.html")).toBe(true);
    expect(insideMockupDir("aven-mockups/")).toBe(false);
    expect(insideMockupDir("aven-mockups")).toBe(false);
    expect(insideMockupDir("aven-mockups/../src/app.ts")).toBe(false);
    expect(insideMockupDir("src/aven-mockups/x.html")).toBe(false);
    expect(insideMockupDir("src/app.ts")).toBe(false);
  });
});

describe("what Aven accepts as a mock-up", () => {
  it("takes self-contained HTML within size, and refuses the rest with why", () => {
    expect(
      mockupProblem(
        "<html><body><style>b{color:red}</style><b>Hi</b></body></html>",
      ),
    ).toBeNull();
    expect(mockupProblem("   ")).toBe("the file is empty");
    expect(mockupProblem("just words")).toBe("it isn't HTML");
    expect(mockupProblem('<div><script src="x.js"></script></div>')).toBe(
      "it loads a script from a file or the web",
    );
    expect(mockupProblem('<img src="https://x.test/a.png">')).toBe(
      "it refers to the web",
    );
    expect(mockupProblem("<p>see http://x.test</p>")).toBe(
      "it refers to the web",
    );
    const big = `<div>${"x".repeat(MOCKUP_MAX_BYTES)}</div>`;
    expect(mockupProblem(big)).toMatch(/over the 2 MB/);
  });

  it("sees a script without a space, an address without its scheme, and a data: URL that isn't a picture", () => {
    expect(mockupProblem("<script/src=x.js></script>")).toBe(
      "it loads a script from a file or the web",
    );
    expect(mockupProblem('<img src="//cdn.test/a.png">')).toBe(
      "it refers to the web",
    );
    expect(
      mockupProblem("<style>b{background:url(//cdn.test/a.png)}</style>"),
    ).toBe("it refers to the web");
    expect(mockupProblem("<style>@import '//cdn.test/a.css';</style>")).toBe(
      "it refers to the web",
    );
    expect(mockupProblem('<a href="data:text/html,<b>x</b>">x</a>')).toBe(
      "it embeds a data: URL that isn't an image",
    );
    expect(
      mockupProblem(
        "<style>@font-face{src:url(data:font/woff2;base64,AA)}</style>",
      ),
    ).toBe("it embeds a data: URL that isn't an image");
    // A picture as a data: URL, and a word that only looks like one, are fine.
    expect(mockupProblem('<img src="data:image/png;base64,AA">')).toBeNull();
    expect(mockupProblem("<p>metadata: 3 rows</p>")).toBeNull();
  });
});

describe("how a mock-up is shown", () => {
  it("shows it without scripts or handlers", () => {
    const shown = sanitizeMockupHtml(
      '<div onclick="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">x</a><style>p{}</style><script/></div>',
    );
    expect(shown).not.toContain("<script");
    expect(shown).not.toContain("onclick");
    expect(shown).not.toContain("javascript:");
    expect(shown).toContain("<style>p{}</style>");
    expect(shown).toContain("<a>x</a>");
  });

  it("parses it, so a handler without a space or quotes still goes", () => {
    expect(sanitizeMockupHtml("<img/onerror=alert(1) src=x>")).toBe(
      '<img src="x">',
    );
    expect(sanitizeMockupHtml("<a href=javascript:alert(1)>x</a>")).toBe(
      "<a>x</a>",
    );
    expect(sanitizeMockupHtml('<a href=" JavaScript:alert(1)">x</a>')).toBe(
      "<a>x</a>",
    );
    expect(sanitizeMockupHtml('<a href="vbscript:x">x</a>')).toBe("<a>x</a>");
    expect(sanitizeMockupHtml('<b ONMOUSEOVER="x">x</b>')).toBe("<b>x</b>");
  });

  it("drops everything that frames, embeds, loads, sends or navigates", () => {
    const shown = sanitizeMockupHtml(
      [
        '<base href="https://x.test/">',
        '<meta http-equiv="refresh" content="0;url=//x.test">',
        '<link rel="stylesheet" href="//x.test/a.css">',
        '<iframe src="//x.test"></iframe>',
        '<object data="x.swf"></object>',
        "<embed src=x>",
        '<form action="//x.test"><button formaction="//y.test">Go</button></form>',
        "<noscript>n</noscript><template>t</template>",
        "<p>kept</p>",
      ].join(""),
    );
    for (const tag of [
      "<base",
      "<meta",
      "<link",
      "<iframe",
      "<object",
      "<embed",
      "<form",
      "<noscript",
      "<template",
      "formaction",
    ])
      expect(shown, tag).not.toContain(tag);
    expect(shown).toContain("<p>kept</p>");
  });

  it("keeps a picture as a data: URL in src and nothing else as data:, and no web address anywhere", () => {
    expect(sanitizeMockupHtml('<img src="data:image/png;base64,AA">')).toBe(
      '<img src="data:image/png;base64,AA">',
    );
    expect(sanitizeMockupHtml('<a href="data:image/png;base64,AA">x</a>')).toBe(
      "<a>x</a>",
    );
    expect(sanitizeMockupHtml('<img src="data:text/html,x">')).toBe("<img>");
    expect(sanitizeMockupHtml('<img src="https://x.test/a.png" alt="a">')).toBe(
      '<img alt="a">',
    );
    expect(sanitizeMockupHtml('<img src="//x.test/a.png">')).toBe("<img>");
    expect(
      sanitizeMockupHtml('<img srcset="a.png 1x, //x.test/b.png 2x">'),
    ).toBe("<img>");
    expect(sanitizeMockupHtml('<video poster="//x.test/p.png"></video>')).toBe(
      "<video></video>",
    );
    expect(
      sanitizeMockupHtml('<div style="background:url(//x.test/a.png)">x</div>'),
    ).toBe("<div>x</div>");
    expect(
      sanitizeMockupHtml(
        "<style>@import url(https://x.test/a.css); p{background:url('//x.test/a.png');color:red}</style>",
      ),
    ).toBe("<style> p{background:;color:red}</style>");
    // A local picture and a colour stay as drawn.
    expect(
      sanitizeMockupHtml('<img src="a.png" style="color:red" alt="a">'),
    ).toBe('<img src="a.png" style="color:red" alt="a">');
  });

  it("has Aven's own page refuse a form that got through anyway", () => {
    const conf = JSON.parse(
      readFileSync("src-tauri/tauri.conf.json", "utf8"),
    ) as { app: { security: { csp: string; devCsp: string } } };
    expect(conf.app.security.csp).toContain("form-action 'none'");
    expect(conf.app.security.devCsp).toContain("form-action 'none'");
  });
});

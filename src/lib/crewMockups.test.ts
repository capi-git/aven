import { describe, expect, it } from "vitest";
import {
  MOCKUP_MAX_BYTES,
  insideMockupDir,
  mockupFileName,
  mockupProblem,
  mockupStorePath,
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
});

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(file, "utf8");
const sheet = read("src/pointer.css");

function files(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, ext);
    return path.endsWith(ext) ? [path] : [];
  });
}

/** Width and height from a PNG's header. */
function pngSize(path: string): [number, number] {
  const bytes = readFileSync(path);
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

describe("dot pointer sheet", () => {
  it("is loaded by every window", () => {
    expect(read("src/main.tsx")).toContain('import "./pointer.css";');
  });

  it("leaves no plain arrow, hand or busy pointer behind the switch", () => {
    // Rules name the tokens, so the dot reaches them; a plain `default`,
    // `pointer`, `grab` or `progress` would show the system's arrow, hand or
    // spinner in the middle of Aven. (`grabbing`, while dragging, stays.)
    const apart = [join("src", "pointer.css")];
    const offenders = [
      ...files("src", ".css"),
      ...files("src", ".ts"),
      ...files("src", ".tsx"),
    ]
      .filter((file) => !apart.includes(file))
      .filter((file) => !file.endsWith(".test.ts"))
      .flatMap((file) =>
        read(file)
          .split("\n")
          .map((line, index) => ({ file, line: index + 1, text: line }))
          .filter(({ text }) =>
            /cursor:\s*["']?(default|pointer|grab|progress)\b/.test(text),
          ),
      );
    expect(offenders).toEqual([]);
  });

  it("draws each dot with its hotspot at the centre, at 1x and 2x", () => {
    const sets = [
      ...sheet.matchAll(
        /url\("\.\/assets\/pointer\/([\w-]+)\.png"\) 1x,\s*url\("\.\/assets\/pointer\/([\w-]+)@2x\.png"\) 2x\s*\)\s*(\d+) (\d+),\s*(\w+)/g,
      ),
    ];
    expect(sets.map((set) => set[1])).toEqual([
      // Rest, press, grab, busy; dark then light.
      "dot-dark",
      "dot-press-dark",
      "dot-press-dark",
      "dot-dark",
      "dot-light",
      "dot-press-light",
      "dot-press-light",
      "dot-light",
    ]);
    for (const [, one, two, x, y, fallback] of sets) {
      expect(two).toBe(one);
      const [width, height] = pngSize(`src/assets/pointer/${one}.png`);
      expect(pngSize(`src/assets/pointer/${one}@2x.png`)).toEqual([
        width * 2,
        height * 2,
      ]);
      expect([Number(x), Number(y)]).toEqual([width / 2, height / 2]);
      // The system's own pointer if an image can't be used.
      expect(["default", "pointer", "grab", "progress"]).toContain(fallback);
    }
    // One size everywhere, so the pointer never jumps between the sidebar,
    // the tabs and the chat; only its brightness changes.
    for (const tone of ["dark", "light"])
      expect(pngSize(`src/assets/pointer/dot-press-${tone}.png`)).toEqual(
        pngSize(`src/assets/pointer/dot-${tone}.png`),
      );
  });

  it("keeps the I-beam in text fields and the resting dot on disabled controls", () => {
    expect(sheet).toMatch(
      /textarea,[\s\S]*?\.cm-content\s*\)\s*\{\s*cursor: text;/,
    );
    expect(sheet).toMatch(
      /:is\(:disabled, \[aria-disabled="true"\], \.cursor-not-allowed\)\s*\{\s*cursor: var\(--aven-cursor-default\);/,
    );
  });

  it("turns WebKit's arrow on labels, check boxes and form buttons into dots", () => {
    // WebKit's own sheet gives a label the arrow (and everything in it
    // inherits that), and check boxes, sliders and form buttons the arrow.
    const base = sheet.slice(sheet.indexOf("@layer base {"));
    const label = base.indexOf(":where(label) {");
    const pressable = base.indexOf("button:not(:disabled)");
    expect(label).toBeGreaterThan(-1);
    // First, so the brighter dot below wins on a label around a check box.
    expect(label).toBeLessThan(pressable);
    expect(base.slice(label, base.indexOf("}", label))).toContain(
      "cursor: var(--aven-cursor-default);",
    );
    const list = base.slice(pressable, base.indexOf("{", pressable));
    for (const type of [
      "button",
      "checkbox",
      "color",
      "file",
      "radio",
      "range",
      "reset",
      "submit",
    ])
      expect(list).toContain(`[type="${type}"]`);
    expect(list).toContain(
      'label:has(input:is([type="checkbox"], [type="radio"]):not(:disabled))',
    );
    // A disabled control's own `:disabled { cursor: not-allowed }`, loaded
    // after this sheet, must not outrank the resting dot.
    expect(sheet).toMatch(
      /html:root\[data-aven-pointer="dot"\]\s*:is\(:disabled,/,
    );
  });

  it("turns every hand the code editor sets into the brighter dot", () => {
    // CodeMirror adds these styles at run time. An update that adds another
    // hand fails here: add its selector to the sheet's editor rule.
    const packages = readdirSync("node_modules/@codemirror").filter((name) =>
      existsSync(`node_modules/@codemirror/${name}/dist/index.js`),
    );
    const hands = Object.fromEntries(
      packages
        .map((name) => [
          name,
          (
            read(`node_modules/@codemirror/${name}/dist/index.js`).match(
              /cursor:\s*"pointer"/g,
            ) ?? []
          ).length,
        ])
        .filter(([, count]) => count),
    );
    expect(hands).toEqual({ autocomplete: 2, language: 2, lint: 1, merge: 3 });
    const editor = sheet.slice(
      sheet.indexOf('html:root[data-aven-pointer="dot"]\n  :is(\n    .cm-'),
    );
    for (const selector of [
      ".cm-tooltip.cm-tooltip-autocomplete > ul > li",
      ".cm-tooltip.cm-tooltip-autocomplete > ul > completion-section",
      "ul.cm-completionListIncompleteTop::before",
      "ul.cm-completionListIncompleteBottom::after",
      ".cm-foldPlaceholder",
      ".cm-foldGutter span",
      ".cm-diagnosticAction",
      ".cm-merge-revert button",
      ".cm-deletedChunk .cm-chunkButtons button",
      ".cm-collapsedLines",
    ])
      expect(editor).toContain(selector);
    expect(editor).toContain("cursor: var(--aven-cursor-pointer);");
  });

  it("lets any cursor Aven sets for a control win over the catch-all dots", () => {
    // Unlayered, the catch-alls would beat Tailwind's cursor classes on a
    // button (a resize handle would lose its arrow); in the base layer they
    // lose to every utility and unlayered rule.
    const base = sheet.slice(sheet.indexOf("@layer base {"));
    expect(base).toMatch(
      /^@layer base \{\s*:where\(html\[data-aven-pointer="dot"\]\)/,
    );
    const layered = base.slice(0, base.indexOf("\n}\n") + 2);
    expect(layered).toContain("cursor: var(--aven-cursor-pointer);");
    expect(layered).toContain("cursor: text;");
    expect(sheet.indexOf("button:not(:disabled)")).toBeGreaterThan(
      sheet.indexOf("@layer base {"),
    );
  });

  it("leaves resize edges their arrows, and a drag its closed hand", () => {
    const all = files("src", ".css").map(read).join("\n");
    for (const cursor of ["col-resize", "row-resize", "grabbing"])
      expect(all).toContain(`cursor: ${cursor}`);
    expect(sheet).not.toMatch(/cursor:\s*[\w-]*(resize|grabbing)/);
  });

  it("shows the larger dot at rest on things you can drag, and the dot while busy", () => {
    for (const tone of ["dark", "light"]) {
      expect(sheet).toMatch(
        new RegExp(
          `--aven-cursor-grab:\\s*-webkit-image-set\\(\\s*url\\("\\./assets/pointer/dot-press-${tone}\\.png"\\)[^;]*grab;`,
        ),
      );
      expect(sheet).toMatch(
        new RegExp(
          `--aven-cursor-progress:\\s*-webkit-image-set\\(\\s*url\\("\\./assets/pointer/dot-${tone}\\.png"\\)[^;]*progress;`,
        ),
      );
    }
    expect(sheet).toContain(
      ".cursor-grab {\n    cursor: var(--aven-cursor-grab);",
    );
  });
});

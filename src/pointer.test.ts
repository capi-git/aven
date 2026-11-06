import { readdirSync, readFileSync, statSync } from "node:fs";
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

  it("leaves no plain arrow or hand behind the switch", () => {
    // Rules name the tokens, so the dot reaches them; a plain `default` or
    // `pointer` would show the system's arrow or hand in the middle of Aven.
    // The crash screen draws itself apart from Aven's styles on purpose.
    const apart = [
      join("src", "pointer.css"),
      join("src", "lib", "renderFailure.ts"),
    ];
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
            /cursor:\s*["']?(default|pointer)\b/.test(text),
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
      "dot-dark",
      "dot-press-dark",
      "dot-light",
      "dot-press-light",
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
      expect(["default", "pointer"]).toContain(fallback);
    }
    // Larger over something you can press.
    expect(pngSize("src/assets/pointer/dot-press-dark.png")[0]).toBeGreaterThan(
      pngSize("src/assets/pointer/dot-dark.png")[0],
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

  it("leaves resize edges and drag handles their own cursors", () => {
    const all = files("src", ".css").map(read).join("\n");
    for (const cursor of ["col-resize", "row-resize", "grab", "grabbing"])
      expect(all).toContain(`cursor: ${cursor}`);
    expect(sheet).not.toMatch(/cursor:\s*[\w-]*(resize|grab)/);
  });
});

// Speed test helper: turn "(chunk.js:line:column" caller labels from the
// perf build back into source locations using its source maps.
// Usage: node scripts/perf-resolve-callers.mjs <dist dir> < labels.json
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";

const dist = process.argv[2];
const labels = JSON.parse(readFileSync(0, "utf8"));
const maps = new Map();
const resolved = {};
for (const label of labels) {
  const match = /\(?([\w.-]+\.js):(\d+):(\d+)/.exec(label);
  if (!match) {
    resolved[label] = label;
    continue;
  }
  const [, file, line, column] = match;
  const mapPath = join(dist, "assets", `${file}.map`);
  if (!existsSync(mapPath)) {
    resolved[label] = label;
    continue;
  }
  if (!maps.has(mapPath))
    maps.set(mapPath, new TraceMap(JSON.parse(readFileSync(mapPath, "utf8"))));
  const position = originalPositionFor(maps.get(mapPath), {
    line: Number(line),
    column: Number(column) - 1,
  });
  resolved[label] = position.source
    ? `${position.source.replace(/^(\.\.\/)+/, "")}:${position.line}${position.name ? ` (${position.name})` : ""}`
    : label;
}
process.stdout.write(JSON.stringify(resolved));

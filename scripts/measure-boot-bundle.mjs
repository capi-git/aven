#!/usr/bin/env node
// Run after `npm run build -- --manifest`. App is a dynamic entry because the
// boot splash loads it after painting; its static dependencies still belong to
// the normal workspace startup path. Optional dynamic imports do not.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

const directory = resolve(process.argv[2] ?? "dist");
const manifest = JSON.parse(
  readFileSync(resolve(directory, ".vite/manifest.json"), "utf8"),
);
// Vite keys App's chunk by its source file only while the chunk exports just
// App's own exports. Once lazily loaded views import shared modules from it,
// the key is the chunk's file name, so find it by chunk name as well.
const appKey =
  "src/App.tsx" in manifest
    ? "src/App.tsx"
    : Object.keys(manifest).find(
        (key) => manifest[key].isDynamicEntry && manifest[key].name === "App",
      );
const roots = ["index.html", appKey ?? "src/App.tsx"];
const visited = new Set();
function visit(key) {
  if (visited.has(key)) return;
  const chunk = manifest[key];
  if (!chunk) throw new Error(`Missing bundle manifest entry: ${key}`);
  visited.add(key);
  for (const dependency of chunk.imports ?? []) visit(dependency);
}
for (const root of roots) visit(root);
const files = [...visited]
  .map((key) => {
    const file = manifest[key].file;
    const bytes = readFileSync(resolve(directory, file));
    return {
      file,
      bytes: bytes.length,
      gzipBytes: gzipSync(bytes, { level: 9 }).length,
    };
  })
  .sort((a, b) => a.file.localeCompare(b.file));
console.log(
  JSON.stringify(
    {
      roots,
      bytes: files.reduce((sum, file) => sum + file.bytes, 0),
      gzipBytes: files.reduce((sum, file) => sum + file.gzipBytes, 0),
      files,
    },
    null,
    2,
  ),
);

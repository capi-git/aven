import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { pdfAssets } from "./scripts/pdf-assets.mjs";
import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// The speed test (`dev-aven.py --perf`) builds with React's profiling build
// so it can attribute render time to components.
// @ts-expect-error process is a nodejs global
const perfBuild = process.env.VITE_AVEN_PERF === "1";

/** Puts the speed test's React commit hook in the page before any module. */
function perfReactHook(): Plugin {
  const source = readFileSync(
    fileURLToPath(new URL("./scripts/perf-react-hook.js", import.meta.url)),
    "utf8",
  );
  return {
    name: "aven-perf-react-hook",
    transformIndexHtml: () => [
      { tag: "script", children: source, injectTo: "head-prepend" },
    ],
  };
}

// Name shared vendor code by what it is instead of by whichever module Rollup
// met first. Only packages that load together belong in one group; lazily
// loaded parts (editor and highlighter languages, themes, Mermaid diagrams)
// keep their own chunks so the boot path does not grow.
const VENDOR_CHUNKS: [string, RegExp][] = [
  ["vendor-react", /\/node_modules\/(react|react-dom|scheduler)\//],
  ["vendor-tauri", /\/node_modules\/@tauri-apps\//],
  ["vendor-xterm", /\/node_modules\/@xterm\//],
  [
    "vendor-codemirror",
    /\/node_modules\/(codemirror|@codemirror\/(state|view|language|commands|search|autocomplete|lint|merge)|@lezer\/(common|highlight|lr)|@marijn\/find-cluster-break|crelt|style-mod|w3c-keyname)\//,
  ],
  [
    "vendor-shiki",
    /\/node_modules\/(shiki|@shikijs\/(core|engine-oniguruma|engine-javascript|vscode-textmate|types)|oniguruma-to-es|oniguruma-parser|regex|regex-recursion|regex-utilities)\//,
  ],
];

function vendorChunk(id: string): string | undefined {
  for (const [name, pattern] of VENDOR_CHUNKS) {
    if (pattern.test(id)) return name;
  }
  return undefined;
}

export default defineConfig(async ({ mode }) => {
  const stable = mode === "stable";

  return {
    // Tests run plain TypeScript and stub styles, so they skip the app plugins.
    plugins:
      mode === "test"
        ? []
        : [
            react(),
            tailwindcss(),
            pdfAssets(),
            ...(perfBuild ? [perfReactHook()] : []),
          ],
    resolve: {
      alias: {
        ...(perfBuild ? { "react-dom/client": "react-dom/profiling" } : {}),
        // The icon theme's SVG table without its components and lookups, so
        // FileTypeIcon can load it only when a rarer glyph is needed.
        "material-icon-svgs": fileURLToPath(
          new URL(
            "./node_modules/react-material-icon-theme/src/iconData.ts",
            import.meta.url,
          ),
        ),
      },
    },
    // The speed test names components in its report.
    ...(perfBuild ? { esbuild: { keepNames: true } } : {}),
    build: {
      // The speed test maps slow callers back to source.
      ...(perfBuild ? { sourcemap: true } : {}),
      rollupOptions: {
        output: { manualChunks: vendorChunk },
      },
    },
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: stable
        ? false
        : host
          ? {
              protocol: "ws",
              host,
              port: 1421,
            }
          : undefined,
      watch: {
        ignored: stable ? ["**/*"] : ["**/src-tauri/**"],
      },
    },
    test: {
      environment: "node",
      include: ["src/**/*.test.ts"],
    },
  };
});

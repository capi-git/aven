import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// PDF fonts and image decoders ship with the app; no CDN or local-file URL access.
export function pdfAssets() {
  const root = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  const assets = new Map();
  assets.set("pdfjs/LICENSE", readFileSync(join(root, "LICENSE")));
  for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      // The document viewer never executes PDF scripts or ships their JS engine.
      if (!entry.isFile() || entry.name.startsWith("quickjs")) continue;
      const name = `pdfjs/${directory}/${entry.name}`;
      assets.set(name, readFileSync(join(root, directory, entry.name)));
    }
  }
  return {
    name: "aven-pdf-assets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = new URL(request.url ?? "/", "http://localhost").pathname.slice(1);
        const data = assets.get(path);
        if (!data || !["GET", "HEAD"].includes(request.method ?? "")) return next();
        response.setHeader("Content-Type", path.endsWith(".js")
          ? "text/javascript" : path.endsWith(".wasm")
            ? "application/wasm" : "application/octet-stream");
        response.setHeader("Content-Length", data.length);
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.end(request.method === "HEAD" ? undefined : data);
      });
    },
    generateBundle() {
      for (const [fileName, source] of assets) {
        this.emitFile({ type: "asset", fileName, source });
      }
    },
  };
}

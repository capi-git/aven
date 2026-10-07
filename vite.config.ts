import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { pdfAssets } from "./scripts/pdf-assets.mjs";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async ({ mode }) => {
  const stable = mode === "stable";

  return {
    // Tests run plain TypeScript and stub styles, so they skip the app plugins.
    plugins: mode === "test" ? [] : [react(), tailwindcss(), pdfAssets()],
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

import { describe, expect, it } from "vitest";
import {
  createDevOutputScanner,
  devServerAddressInLine,
  isDevServerStopLine,
  localDevAddress,
  stripAnsi,
  type DevOutputSignal,
} from "./devServerUrls";

const ESC = "\x1b";

function addresses(signals: DevOutputSignal[]) {
  return signals.flatMap((signal) =>
    signal.kind === "address" ? [signal.address.url] : [],
  );
}

function scanAll(output: string): DevOutputSignal[] {
  const scanner = createDevOutputScanner();
  return [...scanner.push(output), ...scanner.finish()];
}

describe("devServerAddressInLine", () => {
  it.each([
    ["Vite", "  ➜  Local:   http://localhost:5173/", "http://localhost:5173/"],
    [
      "Vite with a base path",
      "  ➜  Local:   http://localhost:5173/app/",
      "http://localhost:5173/app/",
    ],
    [
      "Next 13+",
      "   - Local:        http://localhost:3000",
      "http://localhost:3000/",
    ],
    [
      "Next 12",
      "ready - started server on 0.0.0.0:3000, url: http://localhost:3000",
      "http://localhost:3000/",
    ],
    [
      "Create React App",
      "  Local:            http://localhost:3000",
      "http://localhost:3000/",
    ],
    [
      "webpack-dev-server 5",
      "<i> [webpack-dev-server] Loopback: http://localhost:8080/, http://[::1]:8080/",
      "http://localhost:8080/",
    ],
    [
      "webpack-dev-server 3",
      "ℹ ｢wds｣: Project is running at http://localhost:8080/",
      "http://localhost:8080/",
    ],
    ["Astro", " ┃ Local    http://localhost:4321/", "http://localhost:4321/"],
    [
      "SvelteKit",
      "  ➜  Local:   http://localhost:5173/",
      "http://localhost:5173/",
    ],
    [
      "Remix serve",
      "[remix-serve] http://localhost:3000 (http://192.168.1.20:3000)",
      "http://localhost:3000/",
    ],
    [
      "Remix app server",
      "Remix App Server started at http://localhost:3000 (http://192.168.1.20:3000)",
      "http://localhost:3000/",
    ],
    [
      "Rails / Puma",
      "* Listening on http://127.0.0.1:3000",
      "http://127.0.0.1:3000/",
    ],
    [
      "Django",
      "Starting development server at http://127.0.0.1:8000/",
      "http://127.0.0.1:8000/",
    ],
    [
      "Django on all interfaces",
      "Starting development server at http://0.0.0.0:8000/",
      "http://localhost:8000/",
    ],
    ["Flask", " * Running on http://127.0.0.1:5000", "http://127.0.0.1:5000/"],
    [
      "python -m http.server",
      "Serving HTTP on 0.0.0.0 port 8000 (http://0.0.0.0:8000/) ...",
      "http://localhost:8000/",
    ],
    [
      "python -m http.server on IPv6",
      "Serving HTTP on :: port 8000 (http://[::]:8000/) ...",
      "http://localhost:8000/",
    ],
    [
      "Expo web",
      "› Web is waiting on http://localhost:8081",
      "http://localhost:8081/",
    ],
    [
      "Uvicorn",
      "INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)",
      "http://127.0.0.1:8000/",
    ],
    [
      "Laravel",
      "   INFO  Server running on [http://127.0.0.1:8000].",
      "http://127.0.0.1:8000/",
    ],
    [
      "Angular",
      "** Angular Live Development Server is listening on localhost:4200, open your browser on http://localhost:4200/ **",
      "http://localhost:4200/",
    ],
    [
      "Generic listening on",
      "Server listening on http://localhost:4000",
      "http://localhost:4000/",
    ],
    [
      "Fastify",
      '{"level":30,"msg":"Server listening at http://127.0.0.1:3000"}',
      "http://127.0.0.1:3000/",
    ],
    [
      "Wrangler",
      "[wrangler:inf] Ready on http://localhost:8787",
      "http://localhost:8787/",
    ],
    [
      "Bun",
      "Started development server: http://localhost:3000",
      "http://localhost:3000/",
    ],
    [
      "PHP built-in server",
      "PHP 8.3.0 Development Server (http://localhost:8000) started",
      "http://localhost:8000/",
    ],
    [
      "Hugo",
      "Web Server is available at http://localhost:1313/ (bind address 127.0.0.1)",
      "http://localhost:1313/",
    ],
    [
      "Phoenix",
      "[info] Access MyAppWeb.Endpoint at http://localhost:4000",
      "http://localhost:4000/",
    ],
    [
      "Streamlit",
      "  Local URL: http://localhost:8501",
      "http://localhost:8501/",
    ],
    [
      "Apollo",
      "🚀 Server ready at http://localhost:4000/graphql",
      "http://localhost:4000/graphql",
    ],
    [
      "a *.localhost host",
      "  ➜  Local:   http://my-app.localhost:1355/",
      "http://my-app.localhost:1355/",
    ],
    [
      "Docker compose prefix",
      "web-1  | ➜  Local:   http://localhost:5173/",
      "http://localhost:5173/",
    ],
  ])("recognises %s", (_name, line, url) => {
    const address = devServerAddressInLine(line);
    expect(address?.url).toBe(url);
    expect(address?.strength).toBe("strong");
  });

  it("strips ANSI colour codes, including inside the port", () => {
    const line = `  ${ESC}[32m➜${ESC}[39m  ${ESC}[1mLocal${ESC}[22m:   ${ESC}[36mhttp://localhost:${ESC}[1m5173${ESC}[22m/${ESC}[39m`;
    expect(devServerAddressInLine(line)).toEqual({
      url: "http://localhost:5173/",
      port: 5173,
      label: "localhost:5173",
      strength: "strong",
    });
  });

  it.each([
    ["Express", "Example app listening on port 3000", 3000],
    ["Gin", "[GIN-debug] Listening and serving HTTP on :8080", 8080],
    [
      "Spring",
      "Tomcat started on port(s): 8080 (http) with context path ''",
      8080,
    ],
    ["Axum", "listening on 127.0.0.1:3000", 3000],
    ["Puma 4", "* Listening on tcp://0.0.0.0:3000", 3000],
    ["Node", "Server is running on port 5000", 5000],
  ])("treats %s's port-only line as a weak address", (_name, line, port) => {
    const address = devServerAddressInLine(line);
    expect(address).toEqual({
      url: `http://localhost:${port}/`,
      port,
      label: `localhost:${port}`,
      strength: "weak",
    });
  });

  it.each([
    ["a remote host", "  ➜  Local:   https://example.com/"],
    ["a network address", "  ➜  Network: http://192.168.1.20:5173/"],
    [
      "a docs link",
      "See https://vitejs.dev/config/server-options.html#server-port",
    ],
    [
      "a README instruction",
      "Open [http://localhost:3000](http://localhost:3000) with your browser.",
    ],
    ["a typed curl command", "~/site main % curl http://localhost:3000/api"],
    ["a request log", "GET http://localhost:3000/ 200 in 12ms"],
    ["a port conflict", "Something is already running on port 3000."],
    ["Vite's retry notice", "Port 5173 is in use, trying another one..."],
    ["a connection error", "Error: connect ECONNREFUSED 127.0.0.1:5432"],
    [
      "a proxy error",
      "[vite] http proxy error at /api: Could not proxy to http://localhost:8080/",
    ],
    ["a proxy rule", "[HPM] Proxy created: /api  -> http://localhost:5000"],
    ["an env value", "NEXT_PUBLIC_SITE_URL=http://localhost:3000"],
    ["a database port", "Database listening on port 5432"],
    ["the Node debugger", "Debugger listening on ws://127.0.0.1:9229/1c2d"],
    ["Aven's own app host", "  ➜  Local:   http://tauri.localhost/"],
    [
      "a credentialled address",
      "  ➜  Local:   http://user:secret@localhost:3000/",
    ],
    ["Vite's network hint", "  ➜  Network: use --host to expose"],
  ])("ignores %s", (_name, line) => {
    expect(devServerAddressInLine(line)).toBeNull();
  });
});

describe("localDevAddress", () => {
  it("accepts only loopback and all-interface hosts", () => {
    expect(localDevAddress("http://127.0.0.1:8000")?.label).toBe(
      "127.0.0.1:8000",
    );
    expect(localDevAddress("http://[::1]:3000/")?.url).toBe(
      "http://[::1]:3000/",
    );
    expect(localDevAddress("https://localhost")?.port).toBe(443);
    expect(localDevAddress("http://localhost:3000/).")?.url).toBe(
      "http://localhost:3000/",
    );
    expect(localDevAddress("http://10.0.0.5:3000/")).toBeNull();
    expect(localDevAddress("ftp://localhost:21/")).toBeNull();
    expect(localDevAddress("not a url")).toBeNull();
  });
});

describe("isDevServerStopLine", () => {
  it.each([
    "^C",
    "  ➜  press h + enter to show help^C",
    "[1]+  Terminated: 15          npm run dev",
    "zsh: killed     npm run dev",
    "[0] npm run dev exited with code SIGINT",
    " ELIFECYCLE  Command failed with exit code 1.",
    "INFO:     Shutting down",
    "INFO:     Finished server process [4123]",
    "- Gracefully stopping, waiting for requests to finish",
    "- Goodbye!",
    "<status>killed</status>",
    "Successfully killed shell: bash_1 (npm run dev)",
    "Command timed out after 2m 0.0s",
    "[nodemon] app crashed - waiting for file changes before starting...",
  ])("recognises %j", (line) => {
    expect(isDevServerStopLine(line)).toBe(true);
  });

  it.each([
    " ⨯ TypeError: terminated",
    "Server closed the connection unexpectedly",
    "  ➜  Local:   http://localhost:5173/",
    "<status>running</status>",
    "Request timed out after 30000ms",
  ])("does not treat %j as a stop", (line) => {
    expect(isDevServerStopLine(line)).toBe(false);
  });
});

describe("createDevOutputScanner", () => {
  it("joins lines split across chunks", () => {
    const scanner = createDevOutputScanner();
    expect(
      scanner.push("  VITE v5.4.0  ready in 312 ms\r\n\r\n  ➜  Lo"),
    ).toEqual([]);
    expect(addresses(scanner.push("cal:   http://localhost:51"))).toEqual([]);
    expect(addresses(scanner.push("73/\r\n  ➜  Network: use --host"))).toEqual([
      "http://localhost:5173/",
    ]);
  });

  it("scans an unterminated last line when the output finishes", () => {
    const scanner = createDevOutputScanner();
    expect(scanner.push("Listening on http://localhost:8000/")).toEqual([]);
    expect(addresses(scanner.finish())).toEqual(["http://localhost:8000/"]);
  });

  it("reports addresses and stops in order", () => {
    expect(
      scanAll(
        "> site@0.0.0 dev\n> vite\n\n  ➜  Local:   http://localhost:5173/\n^C\n",
      ).map((signal) => signal.kind),
    ).toEqual(["address", "stopped"]);
  });

  it("accepts a bare address after a 'running at:' line", () => {
    expect(
      addresses(
        scanAll(
          [
            "[I 2026-10-15 10:00:00.123 ServerApp] Jupyter Server 2.14.0 is running at:",
            "[I 2026-10-15 10:00:00.123 ServerApp] http://localhost:8888/lab?token=abc",
          ].join("\n"),
        ),
      ),
    ).toEqual(["http://localhost:8888/lab?token=abc"]);
    expect(
      addresses(
        scanAll(
          "You can now view site in the browser.\n⠀\n  http://localhost:8000/\n",
        ),
      ),
    ).toEqual(["http://localhost:8000/"]);
    expect(
      addresses(
        scanAll(
          "Available on:\n  http://127.0.0.1:8080\n  http://192.168.1.5:8080\nHit CTRL-C to stop the server\n",
        ),
      ),
    ).toEqual(["http://127.0.0.1:8080/"]);
  });

  it("does not accept a bare address without that context", () => {
    expect(addresses(scanAll("  http://localhost:8000/\n"))).toEqual([]);
    expect(
      addresses(
        scanAll("is running at:\none\ntwo\nthree\n  http://localhost:8000/\n"),
      ),
    ).toEqual([]);
  });

  it("keeps an over-long unfinished line bounded", () => {
    const scanner = createDevOutputScanner();
    scanner.push("x".repeat(50_000));
    expect(
      addresses(scanner.push("\n  ➜  Local:   http://localhost:5173/\n")),
    ).toEqual(["http://localhost:5173/"]);
  });

  it("skips ordinary output without examining each line", () => {
    const scanner = createDevOutputScanner();
    const noise = "compiled successfully in 120ms\n".repeat(2_000);
    expect(scanner.push(noise)).toEqual([]);
  });
});

describe("stripAnsi", () => {
  it("removes colours, OSC titles and stray control characters", () => {
    expect(
      stripAnsi(`${ESC}]0;title${ESC}\\${ESC}[1;32mready${ESC}[0m\x07`),
    ).toBe("ready");
  });
});

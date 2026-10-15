/**
 * Recognises the local address a development server announces in terminal or
 * agent shell output. Callers feed raw output chunks to a scanner, which keeps
 * only an unfinished line between chunks and looks closely at a line only when
 * a cheap check finds something address-like in it.
 */

export type DevServerStrength = "strong" | "weak";

export type DevServerAddress = {
  /** Normalised page address, for example `http://localhost:5173/`. */
  url: string;
  port: number;
  /** Host and port for labels, for example `localhost:5173`. */
  label: string;
  /**
   * Strong lines name the app's own page (Vite's `Local:`, Django's
   * `development server at`). Weak lines only say that a port is listening,
   * which is as often an API as a page.
   */
  strength: DevServerStrength;
};

export type DevOutputSignal =
  { kind: "address"; address: DevServerAddress } | { kind: "stopped" };

export type DevOutputScanner = {
  /** Scan a chunk of output; an unfinished last line waits for the next. */
  push(chunk: string): DevOutputSignal[];
  /** The output is complete: scan an unfinished last line as well. */
  finish(): DevOutputSignal[];
};

/** Longer lines are minified code or data, never a server banner. */
const MAX_LINE = 1_000;
const MAX_PARTIAL = 4_000;
/** A bare address counts on the few lines after "running at:". */
const ARMED_LINES = 3;

const ANSI =
  /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[@-Z\\-_]|\x9b[0-?]*[ -/]*[@-~]/g;
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, "").replace(CONTROL, "");
}

/** Anything a positive, stopping or arming line needs; most output has none. */
const INTERESTING =
  /:\/\/|\bport|listen|bound|\^C|kill|termin|exit|crash|lifecycle|status>|shut|stopp|goodbye|timed out|finished server|in (?:the|your) browser|available on|urls?\s*:|running at|\b(?:on|at|to)\s+\S*:\d{2,5}\b/i;

const WEB_ADDRESS =
  /\bhttps?:\/\/(?:\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::\d{1,5})?(?:[/?#][^\s"'<>`()[\]{}|\\]*)?/gi;

const SEPARATORS = String.raw`[\s:=>\-–—➜→▸▶›»•*·|┃│([]*`;

/** What a server prints just before its own address. */
const STRONG_BEFORE = new RegExp(
  String.raw`(?:` +
    [
      String.raw`\b(?:local|loopback)(?:\s+(?:url|address))?`,
      String.raw`\b(?:url|address)`,
      String.raw`\b(?:running|listening|serving|served|ready|started|starting|available|live|up|waiting|hosted|reachable|accessible|launched)\b.{0,60}?\b(?:on|at|from)`,
      String.raw`\bserver\b.{0,30}?\b(?:at|on)`,
      String.raw`\b(?:development|dev|local|web|http|preview)\s+server`,
      String.raw`\bserver(?=\s*:)`,
      String.raw`\baccess\b.{0,60}?\bat`,
      String.raw`\bbrowser\s+(?:on|at)`,
      String.raw`^\[remix-serve\]`,
    ].join("|") +
    String.raw`)${SEPARATORS}$`,
  "i",
);

/** Log tags and bullets only, before a bare address on an armed line. */
const BARE_BEFORE = /^(?:\[[^\]]{0,80}\]|<\w{1,10}>|[\s\-–—•*➜→›»|┃│⠀])*$/;

/** "is running at:", "Available on:", "You can now view app in the browser." */
const ARMS =
  /(?:\b(?:running|available|listening|serving|served|accessible|reachable|live)\s+(?:at|on)|\bin (?:the|your) browser\.?|\burls?|\baddress(?:es)?)\s*:?$/i;

/** Python's `http.server`: "Serving HTTP on :: port 8000 (http://[::]:8000/) ...". */
const PYTHON_HTTP = /^Serving HTTPS? on \S+ port \d+ \((https?:\/\/[^)\s]+)\)/i;

/** "Example app listening on port 3000", "Listening and serving HTTP on :8080". */
const PORT_ONLY =
  /\b(?:listening|running|serving|started|starting|live|up|available|accepting connections|bound)\b.{0,40}?\b(?:on|at|to)\s+(?:(?:port\(s\)|ports?)\s*:?\s*|(?:(?:tcp|https?):\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|\*)?:)(\d{2,5})\b/i;

/** Lines that mention an address without the server being up on it. */
const NOT_SERVING =
  /\b(?:already|in use|eaddrinuse|eacces|failed|failure|error|refused|unable|cannot|can't|could not|couldn't|not (?:running|available|found|reachable|listening)|trying another|is busy|no longer|proxy(?:ing)?)\b/i;

/** Databases, caches and debuggers announce ports too; they are not pages. */
const NOT_WEB_PORTS = new Set([
  22, 25, 53, 1433, 3306, 5432, 5672, 6379, 9200, 9229, 11211, 27017,
]);

/** Ctrl+C echoes, job-control notices and server shutdown lines. */
const STOPPED = new RegExp(
  [
    String.raw`^\^C|\^C\s*$`,
    String.raw`^(?:\[\d+\][+-]?\s+)?(?:killed|terminated)\b`,
    String.raw`\b(?:zsh|bash|sh|fish):\s+(?:killed|terminated)\b`,
    String.raw`\bexited with (?:code|status|signal)\b`,
    String.raw`\bcommand failed with exit code\b`,
    String.raw`\bexit status \d+\s*$`,
    String.raw`\blifecycle script .* failed\b`,
    String.raw`\bnpm (?:err!|error) code elifecycle\b`,
    String.raw`\belifecycle\b.*\bfailed\b`,
    String.raw`\bserver (?:stopped|closed|shut down)\.?\s*$`,
    String.raw`(?:^|[\s:\]])shutting down(?: gracefully)?\.{0,3}\s*$`,
    String.raw`\bfinished server process\b`,
    String.raw`\bgracefully stopping\b`,
    String.raw`(?:^|\s)-?\s*goodbye!?\s*$`,
    String.raw`<status>(?:killed|completed|failed)<\/status>`,
    String.raw`\bkilled shell\b`,
    String.raw`\bcommand timed out\b`,
    String.raw`\bapp crashed\b`,
    String.raw`\bclean exit - waiting\b`,
  ].join("|"),
  "i",
);

const INTERNAL_HOSTS = new Set([
  "tauri.localhost",
  "asset.localhost",
  "ipc.localhost",
]);

/** Loopback hosts as written; all-interfaces binds are opened on localhost. */
function reachableHost(hostname: string): string | null {
  const host = hostname.toLowerCase();
  if (host === "0.0.0.0" || host === "[::]") return "localhost";
  if (host === "localhost" || host === "[::1]") return host;
  if (/^127(?:\.\d{1,3}){3}$/.test(host)) return host;
  if (host.endsWith(".localhost") && !INTERNAL_HOSTS.has(host)) return host;
  return null;
}

/** A local web address a browser on this machine can open, or null. */
export function localDevAddress(
  raw: string,
  strength: DevServerStrength = "strong",
): DevServerAddress | null {
  let url: URL;
  try {
    url = new URL(raw.replace(/[.,;:!?'")\]}>]+$/, ""));
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const host = reachableHost(url.hostname);
  if (!host) return null;
  if (host !== url.hostname) url.hostname = host;
  const port = Number(url.port) || (url.protocol === "https:" ? 443 : 80);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  return {
    url: url.href,
    port,
    label: url.host,
    strength,
  };
}

function cleanLine(text: string): string {
  return stripAnsi(
    text.length > MAX_LINE ? text.slice(0, MAX_LINE) : text,
  ).trim();
}

/** The dev-server address announced on one output line, or null. */
export function devServerAddressInLine(
  text: string,
  armed = false,
): DevServerAddress | null {
  return addressInCleanLine(cleanLine(text), armed);
}

function addressInCleanLine(
  line: string,
  armed: boolean,
): DevServerAddress | null {
  if (!line) return null;
  const python = PYTHON_HTTP.exec(line);
  if (python) return localDevAddress(python[1]);
  for (const match of line.matchAll(WEB_ADDRESS)) {
    const address = localDevAddress(match[0]);
    if (!address) continue;
    const before = line.slice(0, match.index);
    const rest = before + line.slice(match.index + match[0].length);
    if (NOT_SERVING.test(rest)) return null;
    if (STRONG_BEFORE.test(before) || (armed && BARE_BEFORE.test(before)))
      return address;
  }
  const portOnly = PORT_ONLY.exec(line);
  if (!portOnly || NOT_SERVING.test(line)) return null;
  const port = Number(portOnly[1]);
  if (NOT_WEB_PORTS.has(port)) return null;
  return localDevAddress(`http://localhost:${port}/`, "weak");
}

/** True when a line says that the server in this output has stopped. */
export function isDevServerStopLine(text: string): boolean {
  const line = cleanLine(text);
  return !!line && STOPPED.test(line);
}

function lastLineBreak(text: string): number {
  return Math.max(text.lastIndexOf("\n"), text.lastIndexOf("\r"));
}

export function createDevOutputScanner(): DevOutputScanner {
  let partial = "";
  let armed = 0;
  const scan = (text: string, signals: DevOutputSignal[]) => {
    for (const raw of text.split(/\r\n|\n|\r/)) {
      const line = cleanLine(raw);
      if (!line) continue;
      if (STOPPED.test(line)) {
        signals.push({ kind: "stopped" });
        armed = 0;
        continue;
      }
      const address = addressInCleanLine(line, armed > 0);
      if (address) signals.push({ kind: "address", address });
      armed = ARMS.test(line) ? ARMED_LINES : Math.max(0, armed - 1);
    }
  };
  return {
    push(chunk) {
      if (!chunk) return [];
      const text = partial + chunk;
      const end = lastLineBreak(text);
      if (end < 0) {
        partial = text.length > MAX_PARTIAL ? text.slice(-MAX_PARTIAL) : text;
        return [];
      }
      partial = text.slice(end + 1);
      if (partial.length > MAX_PARTIAL) partial = partial.slice(-MAX_PARTIAL);
      const complete = text.slice(0, end);
      if (armed === 0 && !INTERESTING.test(complete)) return [];
      const signals: DevOutputSignal[] = [];
      scan(complete, signals);
      return signals;
    },
    finish() {
      const rest = partial;
      partial = "";
      const signals: DevOutputSignal[] = [];
      if (rest && (armed > 0 || INTERESTING.test(rest))) scan(rest, signals);
      armed = 0;
      return signals;
    },
  };
}

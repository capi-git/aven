/**
 * Dev servers that stopped while something listened: the project bots, which
 * wake up when a project's server crashes. Terminals keep the last lines of
 * their output only while a listener exists, so with no bot on this costs a
 * set lookup per chunk of output.
 */

export type DevServerStop = {
  project: string;
  cwd: string;
  /** "localhost:3000". */
  label: string;
  port: number;
  app?: string;
  /** The terminal it ran in (`terminal:<id>`). */
  sourceId: string;
  /** The terminal's last lines when it stopped. */
  output: string;
  /** How Aven saw it stop: a line of output, the program ending, or the terminal closing. */
  reason: "output" | "exited" | "closed";
  /** The user stopped it (Ctrl+C, closing its terminal), rather than it falling over. */
  byUser: boolean;
  at: number;
};

type Listener = (stop: DevServerStop) => void;

const listeners = new Set<Listener>();

export function subscribeDevServerStops(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether anything wants to hear about stops; terminals keep their tail only then. */
export function devServerStopsWatched(): boolean {
  return listeners.size > 0;
}

export function reportDevServerStop(stop: DevServerStop) {
  for (const listener of [...listeners]) listener(stop);
}

const TAIL_CHARS = 12_000;

/** The last stretch of a terminal's output, kept as it arrives. */
export function createOutputTail(limit = TAIL_CHARS) {
  let text = "";
  return {
    push(chunk: string) {
      text = (text + chunk).slice(-limit);
    },
    text: () => text,
    clear() {
      text = "";
    },
  };
}

// Colour codes and cursor moves a terminal sends between the text.
const ANSI =
  // eslint-disable-next-line no-control-regex
  /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[()][A-Za-z0-9]|\u001b[=>]/g;

export function plainTerminalText(text: string): string {
  return text
    .replace(ANSI, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+$/gm, "");
}

/**
 * Whether the user stopped the server: they closed its terminal, or the end
 * of its output shows Ctrl+C (`^C`) or a kill they typed.
 */
export function stoppedByUser(
  output: string,
  reason: DevServerStop["reason"],
): boolean {
  if (reason === "closed") return true;
  const end = plainTerminalText(output)
    .split("\n")
    .filter((line) => line.trim())
    .slice(-4)
    .join("\n");
  return /\^C|\b(?:SIGINT|terminated by user)\b/i.test(end);
}

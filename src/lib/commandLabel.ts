import { composeToolTitle, isExecuteTool } from "./harness/preview";

/**
 * How a shell command reads as a one-line label in a transcript row, a
 * "doing" line or the live agents list. The command itself is kept as it
 * ran; only what is shown changes:
 *
 * - An orchestration lead's calls to Aven's own control CLI read as plain
 *   words ("Waiting for the agents"), however it names the program (its
 *   path, quoted, or a shell variable holding it).
 * - Any other command loses leading `NAME=value` settings, and absolute
 *   paths read as their last part, so no label starts with a setting or a
 *   long path.
 */

const CONTROL_WORDS: Readonly<Record<string, string>> = {
  wait: "Waiting for the agents",
  list: "Checking on the agents",
  get: "Checking on an agent",
  delegate: "Handing a task to an agent",
  message: "Messaging an agent",
  steer: "Steering an agent",
  review: "Reviewing an agent's work",
  respond: "Answering an agent's request",
  answer: "Answering an agent's question",
  cancel: "Stopping an agent's task",
  finish: "Finishing the run",
  help: "Reading how to direct the agents",
};

/** A program word, then `control` and its action, anywhere in the command. */
const CONTROL_CALL =
  /(?:^|[\s;&|(`])("[^"]*"|'[^']*'|[^\s;&|()`'"]+)\s+control(?:\s+(--help|-h|[a-z]+))?(?=$|[\s;&|)`])/gi;

/** Aven's program, by its path's last part or a variable holding it. */
function isAvenProgram(word: string): boolean {
  const bare = word.replace(/^(["'])(.*)\1$/, "$2");
  if (/^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(bare)) return true;
  const name = bare.split(/[\\/]/).pop() ?? "";
  return /^(?:aven|monocode)(?:[ ._-]?dev)?(?:\.exe)?$/i.test(name);
}

/** Plain words for a call to Aven's control CLI, or null for any other command. */
export function controlCommandLabel(command: string): string | null {
  let label: string | null = null;
  for (const match of command.matchAll(CONTROL_CALL)) {
    if (!isAvenProgram(match[1])) continue;
    const action = (match[2] ?? "help")
      .toLowerCase()
      .replace(/^-+h(elp)?$/, "help");
    label = CONTROL_WORDS[action] ?? "Directing the agents";
  }
  return label;
}

/** `NAME=value` (or `export NAME=value`) settings ahead of the command. */
const LEADING_SETTING =
  /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"(?:[^"\\]|\\.)*"|[^\s;&|]*)\s*(?:;|&&)?\s*/;

/** A quoted absolute path, or an unquoted one of two parts or more. */
const QUOTED_PATH = /(["'])((?:~|\/)[^"']*?)\1/g;
const BARE_PATH =
  /(?<![\w.:/~-])(?:~\/|\/)(?:[^\s/"'`;&|()<>]+\/)+[^\s/"'`;&|()<>]*/g;

function lastPart(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** A command as a label: see the module comment. */
export function commandLabel(command: string): string {
  const text = command.trim();
  if (!text) return text;
  const control = controlCommandLabel(text);
  if (control) return control;
  let rest = text;
  for (let guard = 0; guard < 8; guard++) {
    const setting = rest.match(LEADING_SETTING);
    if (!setting || setting[0].length >= rest.length) break;
    rest = rest.slice(setting[0].length);
  }
  return rest
    .replace(QUOTED_PATH, (said, _quote: string, path: string) =>
      path.split("/").filter(Boolean).length > 1 ? lastPart(path) : said,
    )
    .replace(BARE_PATH, (path) => lastPart(path));
}

/**
 * A tool call's one-line label as `composeToolTitle` words it, with a shell
 * command read through `commandLabel`.
 */
export function toolDisplayLabel(
  opts: Parameters<typeof composeToolTitle>[0],
): string {
  const label = composeToolTitle(opts);
  const shell =
    opts.previewKind === "shell" || isExecuteTool(opts.kind, opts.title);
  return shell && label ? commandLabel(label) : label;
}

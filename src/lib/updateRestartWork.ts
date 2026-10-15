/**
 * Work a restart to update would interrupt, described in plain words, and the
 * one question Aven asks about it. Kept free of workspace and harness imports:
 * the update card and the floating sidebar read it too.
 */

export type AgentWork = {
  id: string;
  title: string;
  project: string;
  /** Working on a turn, waiting for the person's answer, or holding queued messages. */
  state: "working" | "waiting" | "queued";
};

export type TerminalWork = { id: string; command: string };

export type FileWork = { id: string; name: string; project: string };

/** What one workspace window reports about itself. */
export type WindowWork = { agents: AgentWork[]; files: FileWork[] };

export type RestartWork = WindowWork & { terminals: TerminalWork[] };

export const NO_RESTART_WORK: RestartWork = {
  agents: [],
  terminals: [],
  files: [],
};

export function hasRestartWork(work: RestartWork): boolean {
  return (
    work.agents.length > 0 || work.terminals.length > 0 || work.files.length > 0
  );
}

const text = (value: unknown, limit = 120) =>
  typeof value === "string" ? value.trim().slice(0, limit) : "";

/** Accept another window's report only in the expected shape. */
export function readWindowWork(raw: unknown): WindowWork {
  const value = (raw ?? {}) as { agents?: unknown; files?: unknown };
  const agents = Array.isArray(value.agents) ? value.agents : [];
  const files = Array.isArray(value.files) ? value.files : [];
  return {
    agents: agents.flatMap((entry) => {
      const agent = (entry ?? {}) as Partial<AgentWork>;
      const id = text(agent.id, 200);
      const state = agent.state;
      if (
        !id ||
        (state !== "working" && state !== "waiting" && state !== "queued")
      )
        return [];
      return [
        {
          id,
          title: text(agent.title) || "Untitled task",
          project: text(agent.project),
          state,
        },
      ];
    }),
    files: files.flatMap((entry) => {
      const file = (entry ?? {}) as Partial<FileWork>;
      const id = text(file.id, 1000);
      return id
        ? [
            {
              id,
              name: text(file.name) || "a file",
              project: text(file.project),
            },
          ]
        : [];
    }),
  };
}

export function mergeRestartWork(
  own: WindowWork,
  others: WindowWork[],
  terminals: TerminalWork[],
): RestartWork {
  const agents = new Map<string, AgentWork>();
  const files = new Map<string, FileWork>();
  for (const window of [own, ...others]) {
    for (const agent of window.agents)
      if (!agents.has(agent.id)) agents.set(agent.id, agent);
    for (const file of window.files)
      if (!files.has(file.id)) files.set(file.id, file);
  }
  return {
    agents: [...agents.values()],
    terminals,
    files: [...files.values()],
  };
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "a", "a and b", "a, b and c", "a, b, c and 2 more". */
export function plainList(items: readonly string[], shown = 3): string {
  if (items.length === 0) return "";
  const visible = items.slice(0, shown);
  const rest = items.length - visible.length;
  if (rest > 0) return `${visible.join(", ")} and ${rest} more`;
  if (visible.length === 1) return visible[0];
  return `${visible.slice(0, -1).join(", ")} and ${visible[visible.length - 1]}`;
}

const named = (title: string, project: string) =>
  project ? `${title} (${project})` : title;

/** One line per kind of work, for the restart question. */
export function describeRestartWork(work: RestartWork): string[] {
  const lines: string[] = [];
  const agents = (state: AgentWork["state"]) =>
    work.agents
      .filter((agent) => agent.state === state)
      .map((agent) => named(agent.title, agent.project));
  const working = agents("working");
  if (working.length)
    lines.push(
      `${count(working.length, "agent is", "agents are")} working: ${plainList(working)}`,
    );
  const waiting = agents("waiting");
  if (waiting.length)
    lines.push(
      `${count(waiting.length, "agent is", "agents are")} waiting for your answer: ${plainList(waiting)}`,
    );
  const queued = agents("queued");
  if (queued.length)
    lines.push(
      `${count(queued.length, "agent has", "agents have")} messages waiting to send: ${plainList(queued)}`,
    );
  if (work.terminals.length) {
    const commands = [
      ...new Set(work.terminals.map((terminal) => terminal.command)),
    ];
    lines.push(
      work.terminals.length === 1
        ? `1 terminal is running ${commands[0]}`
        : `${work.terminals.length} terminals are running ${plainList(commands)}`,
    );
  }
  if (work.files.length)
    lines.push(
      `${count(work.files.length, "file has", "files have")} unsaved changes: ${plainList(
        work.files.map((file) => named(file.name, file.project)),
      )}`,
    );
  return lines;
}

/** Finishes "Update ready — restarting when …". */
export function restartWaitReason(work: RestartWork): string {
  const kinds = [
    work.agents.length > 0,
    work.terminals.length > 0,
    work.files.length > 0,
  ].filter(Boolean).length;
  if (kinds !== 1) return "your work finishes";
  if (work.agents.length)
    return work.agents.length === 1
      ? "your agent finishes"
      : "your agents finish";
  if (work.terminals.length)
    return work.terminals.length === 1
      ? "your terminal command finishes"
      : "your terminal commands finish";
  return work.files.length === 1
    ? "your file is saved"
    : "your files are saved";
}

export type RestartChoice = "wait" | "stop" | "cancel";

export type RestartDecision = {
  work: RestartWork;
  /** Asked from "Restart now" while already waiting: stopping comes first. */
  now: boolean;
};

let decision: {
  value: RestartDecision;
  answer: (choice: RestartChoice) => void;
} | null = null;
const decisionListeners = new Set<() => void>();

function publishDecision() {
  for (const listener of decisionListeners) listener();
}

/** Ask once what to do about running work. A second ask shares the first. */
export function requestRestartDecision(
  work: RestartWork,
  now = false,
): Promise<RestartChoice> {
  if (decision) {
    decision.value = { work, now: decision.value.now || now };
    publishDecision();
  }
  return new Promise((resolve) => {
    const previous = decision?.answer;
    decision = {
      value: decision?.value ?? { work, now },
      answer: (choice) => {
        previous?.(choice);
        resolve(choice);
      },
    };
    publishDecision();
  });
}

export function getRestartDecision(): RestartDecision | null {
  return decision?.value ?? null;
}

export function answerRestartDecision(choice: RestartChoice): void {
  const current = decision;
  if (!current) return;
  decision = null;
  publishDecision();
  current.answer(choice);
}

export function subscribeRestartDecision(listener: () => void): () => void {
  decisionListeners.add(listener);
  return () => {
    decisionListeners.delete(listener);
  };
}

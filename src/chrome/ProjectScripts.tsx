import { SETTINGS } from "../lib/settings";
import { saveSettingsProject } from "../lib/settingsProject";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { listDir, readTextFile } from "../lib/fs";
import {
  clearScriptRun,
  isValidScriptCommand,
  loadSetupScript,
  plainScriptOutput,
  runScript,
  saveSetupScript,
  scriptKey,
  scriptRun,
  scriptRunsIn,
  scriptsVersion,
  setupRanIn,
  stopScript,
  subscribeScripts,
  suggestRunCommands,
  suggestSetupCommand,
  type ScriptRun,
} from "../lib/projectScripts";
import {
  loadRunScripts,
  saveRunScripts,
  type RunScript,
} from "../lib/workspaceActions";
import {
  ChevronDown,
  ChevronUp,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Square,
  Terminal,
  Wrench,
  X,
} from "./icons";
import { DotSpinner } from "./DotSpinner";
import "./ProjectScripts.css";

type Props = {
  /** The project's main folder: scripts are saved for the whole project. */
  project: string;
  /** The copy the scripts run in. */
  cwd: string;
  active: boolean;
  /** Opens a new terminal in a folder. */
  onOpenTerminal?: (cwd: string) => void;
  /** Shows or hides the project's terminal panel. */
  onToggleTerminal?: () => void;
  /** Starts a new chat in the project with `prompt` in its message box. */
  onStartChat?: (project: string, prompt: string) => void;
  /** Opens Settings on the project's page. */
  onOpenSettings?: (section: "project") => void;
};

type Pane = "setup" | "run";

/**
 * What a new chat asks for when there is no script yet. Scripts are kept in
 * Aven, not in the project, so the agent finds the command and you add it.
 */
export const SCRIPT_PROMPTS: Record<Pane, string> = {
  run: "Find the command that starts this project's dev server or app (check package.json scripts, a Makefile, the README and similar). Try it to make sure it starts, then stop it. Don't change any files. Reply with a short name and the exact command, like `Dev server: npm run dev`, so I can add it as a Run script in Aven's side panel.",
  setup:
    "Find what a fresh copy of this project needs before it can run: installing dependencies, and copying env files such as .env.example to .env. Don't change any files. Reply with one shell line that does it, like `npm install && cp .env.example .env`, so I can add it as the Setup script in Aven's side panel.",
};

const EMPTY: Record<Pane, { title: string; detail: string }> = {
  run: {
    title: "Add a run script",
    detail:
      "It starts your dev server or app. Each script opens in its own tab.",
  },
  setup: {
    title: "Add a setup script",
    detail:
      "It runs in each new copy to install dependencies and copy env files.",
  },
};

/** No script yet: what one does, an agent to find it, and the manual ways. */
function ScriptEmpty({
  pane,
  onAsk,
  onAdd,
  onSettings,
}: {
  pane: Pane;
  onAsk?: () => void;
  onAdd: () => void;
  onSettings?: () => void;
}) {
  const words = EMPTY[pane];
  return (
    <div className="inspector-empty project-scripts-empty">
      <p className="inspector-empty-title">{words.title}</p>
      <p className="inspector-empty-detail">{words.detail}</p>
      {onAsk ? (
        <button
          type="button"
          className="inspector-empty-action"
          onClick={onAsk}
        >
          <Sparkles className="size-3" strokeWidth={1.75} />
          Ask an agent to write it
        </button>
      ) : null}
      <div className="project-scripts-links">
        <button type="button" className="inspector-empty-link" onClick={onAdd}>
          Add one yourself
        </button>
        {onSettings ? (
          <button
            type="button"
            className="inspector-empty-link"
            onClick={onSettings}
          >
            Open project settings
          </button>
        ) : null}
      </div>
    </div>
  );
}
const OPEN_KEY = "aven.scriptsOpen";

function loadOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== "false";
  } catch {
    return true;
  }
}

function useScripts() {
  useSyncExternalStore(subscribeScripts, scriptsVersion);
}

function Output({ run }: { run: ScriptRun | undefined }) {
  const ref = useRef<HTMLPreElement>(null);
  const text = run ? plainScriptOutput(run.output).trimEnd() : "";
  useLayoutEffect(() => {
    const node = ref.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [text]);
  if (!run) return null;
  const end =
    run.state === "done"
      ? "Finished"
      : run.state === "failed"
        ? `Failed${run.code != null ? ` (exit ${run.code})` : ""}`
        : run.state === "stopped"
          ? "Stopped"
          : "";
  return (
    <pre ref={ref} className="project-scripts-output" data-state={run.state}>
      {text}
      {end ? <span className="project-scripts-end">{`\n${end}`}</span> : null}
    </pre>
  );
}

function CommandForm({
  initialName = "",
  initialCommand = "",
  withName,
  suggestions = [],
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initialName?: string;
  initialCommand?: string;
  withName: boolean;
  suggestions?: { name: string; command: string }[];
  submitLabel: string;
  onSubmit: (name: string, command: string) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [command, setCommand] = useState(initialCommand);
  const valid = isValidScriptCommand(command) && (!withName || !!name.trim());
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid) onSubmit(name.trim(), command.trim());
  };
  return (
    <form className="project-scripts-form" onSubmit={submit}>
      {withName ? (
        <input
          aria-label="Name"
          placeholder="Name, such as Dev server"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      ) : null}
      <input
        aria-label="Command"
        className="project-scripts-mono"
        placeholder={withName ? "npm run dev" : "npm install"}
        value={command}
        autoFocus={!withName}
        onChange={(event) => setCommand(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && onCancel) onCancel();
        }}
      />
      {suggestions.length > 0 ? (
        <div className="project-scripts-suggestions">
          {suggestions.map((item) => (
            <button
              type="button"
              key={item.name}
              onClick={() => {
                setName(item.name);
                setCommand(item.command);
              }}
            >
              {item.name}
            </button>
          ))}
        </div>
      ) : null}
      <div className="project-scripts-form-actions">
        {onCancel ? (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        <button type="submit" data-primary disabled={!valid}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function RunButton({
  run,
  onStart,
}: {
  run: ScriptRun | undefined;
  onStart: () => void;
}) {
  const running = run?.state === "running";
  return (
    <button
      type="button"
      className="project-scripts-icon"
      aria-label={running ? "Stop" : run ? "Run again" : "Run"}
      title={running ? "Stop" : run ? "Run again" : "Run"}
      onClick={() => (running ? void stopScript(run.key) : onStart())}
    >
      {running ? (
        <Square className="size-3" strokeWidth={2} />
      ) : (
        <Play className="size-3" strokeWidth={2} />
      )}
    </button>
  );
}

/** Setup, Run and Terminal at the foot of the side panel. */
export function ProjectScripts({
  project,
  cwd,
  active,
  onOpenTerminal,
  onToggleTerminal,
  onStartChat,
  onOpenSettings,
}: Props) {
  useScripts();
  const [open, setOpen] = useState(loadOpen);
  const [pane, setPane] = useState<Pane>("setup");
  const [setup, setSetup] = useState(() => loadSetupScript(project));
  const [scripts, setScripts] = useState<RunScript[]>(() =>
    loadRunScripts(project),
  );
  const [editing, setEditing] = useState<"setup" | "run" | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [setupHint, setSetupHint] = useState("");
  const [runHints, setRunHints] = useState<{ name: string; command: string }[]>(
    [],
  );

  useEffect(() => {
    setSetup(loadSetupScript(project));
    setScripts(loadRunScripts(project));
    setEditing(null);
  }, [project]);

  // A new copy runs its setup by itself the first time it is shown.
  useEffect(() => {
    if (!active || !setup || cwd === project || setupRanIn(cwd)) return;
    if (!SETTINGS.setupInNewCopies.load()) return;
    void runScript("setup", "Setup", setup, cwd);
    setPane("setup");
  }, [active, setup, cwd, project]);

  // Suggestions only while there is something to fill in.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    if (!setup)
      listDir(project)
        .then(
          (entries) => !cancelled && setSetupHint(suggestSetupCommand(entries)),
        )
        .catch(() => undefined);
    if (!scripts.length || editing === "run") {
      // package.json scripts first, then what the root's files suggest (a
      // build script, a Swift package, an Xcode project…).
      const npm = readTextFile(`${project}/package.json`)
        .then((raw) => {
          const pkg = JSON.parse(raw) as { scripts?: Record<string, unknown> };
          if (!pkg.scripts || typeof pkg.scripts !== "object") return [];
          return Object.keys(pkg.scripts)
            .filter((key) => /^[\w][\w:-]*$/.test(key))
            .map((key) => ({ name: key, command: `npm run ${key}` }));
        })
        .catch(() => []);
      const files = listDir(project)
        .then((entries) => suggestRunCommands(entries))
        .catch(() => []);
      void Promise.all([npm, files]).then(([fromNpm, fromFiles]) => {
        if (!cancelled) setRunHints([...fromNpm, ...fromFiles].slice(0, 6));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [active, project, setup, scripts.length, editing]);

  const setupRun = scriptRun(scriptKey("setup", cwd, "Setup"));
  const runRuns = scriptRunsIn(cwd, "run");
  const setupBusy = setupRun?.state === "running";
  const runBusy = runRuns.some((run) => run.state === "running");
  const current =
    scripts.find((script) => script.id === selected) ?? scripts[0] ?? null;
  const currentRun = current
    ? scriptRun(scriptKey("run", cwd, current.name))
    : undefined;

  const show = (next: Pane) => {
    setPane(next);
    setEditing(null);
    if (!open) toggle(true);
  };
  const toggle = (next = !open) => {
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, String(next));
    } catch {
      /* Only a default. */
    }
  };
  const saveScripts = (next: RunScript[]) => {
    saveRunScripts(project, next);
    setScripts(next);
  };
  const ask = onStartChat
    ? (which: Pane) => onStartChat(project, SCRIPT_PROMPTS[which])
    : undefined;
  const openSettings = onOpenSettings
    ? () => {
        saveSettingsProject(project);
        onOpenSettings("project");
      }
    : undefined;
  const terminal =
    onToggleTerminal ??
    (onOpenTerminal ? () => onOpenTerminal(cwd) : undefined);

  return (
    <section
      className="project-scripts"
      data-open={open || undefined}
      aria-label="Scripts"
    >
      <div className="project-scripts-bar">
        <div className="project-scripts-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={open && pane === "setup"}
            className="project-scripts-tab"
            onClick={() => show("setup")}
          >
            {setupBusy ? (
              <DotSpinner />
            ) : (
              <Wrench className="size-3" strokeWidth={1.75} />
            )}
            Setup
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={open && pane === "run"}
            className="project-scripts-tab"
            onClick={() => show("run")}
          >
            {runBusy ? (
              <DotSpinner state="background" />
            ) : (
              <Play className="size-3" strokeWidth={1.75} />
            )}
            Run
          </button>
          {terminal ? (
            <button
              type="button"
              className="project-scripts-tab project-scripts-glyph"
              aria-label="Terminal"
              title={
                onToggleTerminal
                  ? "Show or hide the project's terminal"
                  : "Open a terminal in this copy"
              }
              onClick={terminal}
            >
              <Terminal className="size-3.5" strokeWidth={1.75} />
            </button>
          ) : null}
          {onOpenTerminal ? (
            <span className="project-scripts-rule" aria-hidden />
          ) : null}
        </div>
        {onOpenTerminal ? (
          <button
            type="button"
            className="project-scripts-icon"
            aria-label="New terminal"
            title="New terminal in this copy"
            onClick={() => onOpenTerminal(cwd)}
          >
            <Plus className="size-3.5" strokeWidth={1.75} />
          </button>
        ) : null}
        <button
          type="button"
          className="project-scripts-icon"
          aria-label={open ? "Hide scripts" : "Show scripts"}
          aria-expanded={open}
          onClick={() => toggle()}
        >
          {open ? (
            <ChevronDown className="size-3.5" strokeWidth={1.75} />
          ) : (
            <ChevronUp className="size-3.5" strokeWidth={1.75} />
          )}
        </button>
      </div>
      {open ? (
        <div className="project-scripts-body" role="tabpanel">
          {pane === "setup" ? (
            editing === "setup" ? (
              <CommandForm
                key={`setup:${project}:${setupHint}`}
                withName={false}
                initialCommand={setup || setupHint}
                submitLabel="Save"
                onCancel={() => setEditing(null)}
                onSubmit={(_, command) => {
                  saveSetupScript(project, command);
                  setSetup(command);
                  setEditing(null);
                }}
              />
            ) : !setup ? (
              <ScriptEmpty
                pane="setup"
                onAsk={ask ? () => ask("setup") : undefined}
                onAdd={() => setEditing("setup")}
                onSettings={openSettings}
              />
            ) : (
              <>
                <div className="project-scripts-row">
                  <code className="project-scripts-command" title={setup}>
                    {setup}
                  </code>
                  <button
                    type="button"
                    className="project-scripts-icon"
                    aria-label="Edit setup"
                    title="Edit"
                    onClick={() => setEditing("setup")}
                  >
                    <Pencil className="size-3" strokeWidth={1.75} />
                  </button>
                  <RunButton
                    run={setupRun}
                    onStart={() => void runScript("setup", "Setup", setup, cwd)}
                  />
                </div>
                <Output run={setupRun} />
              </>
            )
          ) : editing === "run" ? (
            <CommandForm
              key={`run:${project}`}
              withName
              suggestions={runHints}
              submitLabel="Add"
              onCancel={() => setEditing(null)}
              onSubmit={(name, command) => {
                const script = { id: crypto.randomUUID(), name, command };
                saveScripts([
                  ...scripts.filter((row) => row.name !== name),
                  script,
                ]);
                setSelected(script.id);
                setEditing(null);
              }}
            />
          ) : scripts.length === 0 || !current ? (
            <ScriptEmpty
              pane="run"
              onAsk={ask ? () => ask("run") : undefined}
              onAdd={() => setEditing("run")}
              onSettings={openSettings}
            />
          ) : (
            <>
              <div className="project-scripts-row">
                <div className="project-scripts-chips">
                  {scripts.map((script) => {
                    const run = scriptRun(scriptKey("run", cwd, script.name));
                    return (
                      <button
                        type="button"
                        key={script.id}
                        className="project-scripts-chip"
                        aria-pressed={script.id === current.id}
                        title={script.command}
                        onClick={() => setSelected(script.id)}
                      >
                        {run?.state === "running" ? (
                          <DotSpinner state="background" />
                        ) : null}
                        {script.name}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className="project-scripts-chip"
                    aria-label="Add a run script"
                    title="Add a run script"
                    onClick={() => setEditing("run")}
                  >
                    <Plus className="size-3" strokeWidth={1.75} />
                  </button>
                </div>
                {currentRun?.state !== "running" ? (
                  <button
                    type="button"
                    className="project-scripts-icon"
                    aria-label={`Remove ${current.name}`}
                    title="Remove"
                    onClick={() => {
                      if (currentRun) clearScriptRun(currentRun.key);
                      saveScripts(
                        scripts.filter((row) => row.id !== current.id),
                      );
                      setSelected(null);
                    }}
                  >
                    <X className="size-3" strokeWidth={1.75} />
                  </button>
                ) : null}
                <RunButton
                  run={currentRun}
                  onStart={() =>
                    void runScript("run", current.name, current.command, cwd)
                  }
                />
              </div>
              <Output run={currentRun} />
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

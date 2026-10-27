import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, Loader } from "./icons";
import { Modal } from "./Modal";
import { ScopeButton } from "./SkillPicker";
import { failureText } from "../lib/errors";
import { looksLikeProject } from "../lib/recents";
import {
  cancelSkillsCli,
  cliFailureText,
  findRequest,
  forgetSkillListsAfterInstall,
  initialSelection,
  installRequest,
  installResult,
  listRequest,
  parseFindResults,
  parseSkillList,
  parseSkillSource,
  pickFoundSkill,
  runSkillsCli,
  stripAnsi,
  successLine,
  type ListedSkill,
  type SkillInstallScope,
  type SkillsCliOutcome,
  type SkillsCliRequest,
} from "../lib/skillInstall";

type Phase = "idle" | "finding" | "listing" | "preview" | "installing" | "done";

type Props = {
  /** Where this chat's agent works; "This project" installs here. */
  cwd: string;
  onClose: () => void;
  /** Skills were written and cached lists dropped; reload the `/` list. */
  onInstalled: (result: { names: string[]; scope: SkillInstallScope }) => void;
};

export const SKILL_RISK_LINE =
  "Skills come from their authors and run with your agents' permissions. Only add ones you trust.";
const MAX_LOG_LINES = 400;
const RUNNING: readonly Phase[] = ["finding", "listing", "installing"];

const newRunId = () => `skill-${crypto.randomUUID()}`;

/**
 * Add skills from GitHub or skills.sh with the `skills` CLI. It looks first
 * (`--list`) so the person sees what a source holds and picks what to add,
 * then installs. The CLI's own output shows while each step runs, and
 * closing the dialog stops it.
 */
export function AddSkillDialog({ cwd, onClose, onInstalled }: Props) {
  const project = looksLikeProject(cwd);
  const [input, setInput] = useState("");
  const [scopeChoice, setScope] = useState<SkillInstallScope>("global");
  const scope: SkillInstallScope = project ? scopeChoice : "global";
  const [phase, setPhase] = useState<Phase>("idle");
  const [repo, setRepo] = useState<{ cli: string; label: string } | null>(null);
  const [listed, setListed] = useState<ListedSkill[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const runId = useRef<string | null>(null);
  const mounted = useRef(true);
  const field = useRef<HTMLInputElement>(null);
  const logBox = useRef<HTMLPreElement>(null);
  const running = RUNNING.includes(phase);

  useEffect(() => {
    mounted.current = true;
    field.current?.focus();
    return () => {
      mounted.current = false;
      // Nothing keeps running once the dialog is gone.
      const id = runId.current;
      runId.current = null;
      if (id) void cancelSkillsCli(id).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const box = logBox.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [log]);

  const run = async (request: SkillsCliRequest): Promise<SkillsCliOutcome> => {
    runId.current = request.runId;
    setLog([]);
    try {
      return await runSkillsCli(request, (line) => {
        if (!mounted.current || runId.current !== request.runId) return;
        setLog((lines) => [...lines.slice(1 - MAX_LOG_LINES), stripAnsi(line)]);
      });
    } finally {
      if (runId.current === request.runId) runId.current = null;
    }
  };

  const stop = () => {
    const id = runId.current;
    if (id) void cancelSkillsCli(id).catch(() => undefined);
  };

  const fail = (message: string, next: Phase) => {
    setError(message);
    setPhase(next);
  };

  const lookUp = async () => {
    const parsed = parseSkillSource(input);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    setDone(null);
    let source = parsed.source;
    try {
      if (source.kind === "name") {
        setPhase("finding");
        const found = await run(findRequest(newRunId(), source.query));
        if (!mounted.current) return;
        if (found.status === "cancelled") return setPhase("idle");
        if (found.status !== "finished" || found.code !== 0) {
          return fail(cliFailureText(found, source.label), "idle");
        }
        const match = pickFoundSkill(
          parseFindResults(found.stdout),
          source.query,
        );
        if (!match) {
          return fail(
            `No skill called “${source.query}” was found on skills.sh. Try owner/repo instead.`,
            "idle",
          );
        }
        source = {
          kind: "repo",
          cli: match.source,
          label: match.source,
          preselect: match.name,
        };
      }
      setRepo({ cli: source.cli, label: source.label });
      setPhase("listing");
      const result = await run(listRequest(newRunId(), source.cli));
      if (!mounted.current) return;
      if (result.status === "cancelled") return setPhase("idle");
      const ok = result.status === "finished" && result.code === 0;
      const skills = ok ? parseSkillList(result.stdout) : [];
      if (skills.length === 0) {
        return fail(
          ok
            ? `Aven couldn't find any skills in ${source.label}.`
            : cliFailureText(result, source.label),
          "idle",
        );
      }
      setListed(skills);
      setSelected(initialSelection(skills, source.preselect));
      setPhase("preview");
    } catch (reason) {
      if (!mounted.current) return;
      fail(
        failureText(reason, "Aven couldn't run the skills installer."),
        "idle",
      );
    }
  };

  const install = async () => {
    if (!repo) return;
    const built = installRequest({
      runId: newRunId(),
      source: repo.cli,
      scope,
      cwd,
      listed,
      selected,
    });
    if (!built.ok) return setError(built.error);
    setError(null);
    setPhase("installing");
    try {
      const result = await run(built.request);
      if (!mounted.current) return;
      if (result.status === "cancelled") {
        return fail("Stopped before it finished.", "preview");
      }
      const { added, error: problem } = installResult(
        result,
        built.names,
        repo.label,
      );
      if (added.length === 0) {
        return fail(problem ?? cliFailureText(result, repo.label), "preview");
      }
      forgetSkillListsAfterInstall(scope, cwd);
      onInstalled({ names: added, scope });
      setDone(successLine(added, scope));
      setError(problem);
      setPhase("done");
    } catch (reason) {
      if (!mounted.current) return;
      fail(
        failureText(reason, "Aven couldn't run the skills installer."),
        "preview",
      );
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (phase === "idle") void lookUp();
    else if (phase === "preview") void install();
    else if (phase === "done") onClose();
  };

  const edit = (value: string) => {
    setInput(value);
    setError(null);
    if (phase === "preview" || phase === "done") {
      setPhase("idle");
      setRepo(null);
      setListed([]);
      setDone(null);
    }
  };

  const toggle = (name: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const allSelected = listed.every((skill) => selected.has(skill.name));
  const chosenNames = listed
    .filter((skill) => selected.has(skill.name))
    .map((skill) => skill.name);
  const chosen = chosenNames.length;
  const parsed = input.trim() ? parseSkillSource(input) : null;
  const hint = parsed && !parsed.ok && !error ? parsed.error : null;
  const status =
    phase === "finding"
      ? `Searching skills.sh for ${input.trim()}…`
      : phase === "listing"
        ? `Looking in ${repo?.label ?? "the source"}…`
        : phase === "installing"
          ? `Adding ${chosen === 1 ? chosenNames[0] : `${chosen} skills`}…`
          : null;
  const primary =
    phase === "done"
      ? "Done"
      : phase === "preview" || phase === "installing"
        ? chosen > 1
          ? `Install ${chosen} skills`
          : "Install"
        : "Show skills";

  return (
    <Modal
      size="sm"
      title="Add a skill"
      description="Install skills from GitHub or skills.sh."
      onClose={onClose}
    >
      <form
        data-add-skill
        onSubmit={submit}
        className="flex flex-col gap-3 px-4 pb-4 pt-3"
      >
        <label className="flex flex-col gap-1">
          <span className="text-ui-caption text-content/55">
            owner/repo or a GitHub link
          </span>
          <input
            ref={field}
            value={input}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            placeholder="nutlope/hallmark"
            aria-label="owner/repo or a GitHub link"
            disabled={running}
            onChange={(event) => edit(event.target.value)}
            className="aven-field w-full px-2 py-1.5 font-mono text-ui-body"
          />
          {hint ? (
            <span className="text-ui-caption text-content/50">{hint}</span>
          ) : null}
        </label>
        <div className="flex gap-1" role="group" aria-label="Where to add it">
          <ScopeButton
            label="All projects"
            hint="~/.agents/skills"
            selected={scope === "global"}
            disabled={running || phase === "done"}
            onClick={() => setScope("global")}
          />
          <ScopeButton
            label="This project"
            hint=".agents/skills"
            selected={scope === "project"}
            disabled={!project || running || phase === "done"}
            onClick={() => setScope("project")}
          />
        </div>
        {listed.length > 0 &&
        (phase === "preview" || phase === "installing") ? (
          <SkillChoices
            label={repo?.label ?? ""}
            listed={listed}
            selected={selected}
            disabled={phase !== "preview"}
            allSelected={allSelected}
            onToggle={toggle}
            onToggleAll={() =>
              setSelected(
                allSelected
                  ? new Set()
                  : new Set(listed.map((skill) => skill.name)),
              )
            }
          />
        ) : null}
        <p className="text-ui-caption leading-snug text-content/50">
          {SKILL_RISK_LINE}
        </p>
        {status ? (
          <p
            role="status"
            className="flex items-center gap-1.5 text-ui-label text-content/70"
          >
            <Loader className="size-3.5 shrink-0 animate-spin" />
            <span className="min-w-0 flex-1 truncate">{status}</span>
            <span className="shrink-0 text-ui-caption text-content/40">
              Closing stops it
            </span>
          </p>
        ) : null}
        {done ? (
          <p
            role="status"
            className="flex items-center gap-1.5 text-ui-label text-content"
          >
            <Check className="size-3.5 shrink-0 text-content" />
            <span>{done}. Find it in the / list.</span>
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="whitespace-pre-line text-ui-label text-red-600 dark:text-red-400"
          >
            {error}
          </p>
        ) : null}
        {log.length > 0 && running ? (
          <pre
            ref={logBox}
            aria-label="Installer output"
            className="max-h-32 overflow-auto rounded-md bg-content/5 px-2 py-1.5 font-mono text-ui-caption leading-4 text-content/60"
          >
            {log.join("\n")}
          </pre>
        ) : log.length > 0 ? (
          <details className="text-ui-caption text-content/50">
            <summary className="cursor-default select-none">
              Show output
            </summary>
            <pre
              aria-label="Installer output"
              className="mt-1 max-h-32 overflow-auto rounded-md bg-content/5 px-2 py-1.5 font-mono leading-4 text-content/60"
            >
              {log.join("\n")}
            </pre>
          </details>
        ) : null}
        <div className="flex items-center justify-end gap-2">
          {phase === "done" ? null : (
            <button
              type="button"
              onClick={running ? stop : onClose}
              className="aven-press rounded-md px-3 py-1.5 text-ui-label text-content/70 hover:bg-content/8 hover:text-content"
            >
              {running ? "Stop" : "Cancel"}
            </button>
          )}
          <button
            type="submit"
            disabled={
              running ||
              (phase === "idle" && !parsed?.ok) ||
              (phase === "preview" && chosen === 0)
            }
            className="aven-press rounded-md bg-content px-3 py-1.5 text-ui-label font-medium text-background-base hover:opacity-90 disabled:opacity-40"
          >
            {primary}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SkillChoices({
  label,
  listed,
  selected,
  disabled,
  allSelected,
  onToggle,
  onToggleAll,
}: {
  label: string;
  listed: readonly ListedSkill[];
  selected: ReadonlySet<string>;
  disabled: boolean;
  allSelected: boolean;
  onToggle: (name: string) => void;
  onToggleAll: () => void;
}) {
  const single = listed.length === 1;
  return (
    <fieldset className="flex min-w-0 flex-col gap-1" disabled={disabled}>
      <legend className="mb-1 flex w-full items-center gap-2 text-ui-caption text-content/55">
        <span className="min-w-0 flex-1 truncate">
          {single ? `In ${label}` : `${listed.length} skills in ${label}`}
        </span>
        {single ? null : (
          <button
            type="button"
            onClick={onToggleAll}
            disabled={disabled}
            className="shrink-0 rounded px-1 text-content/55 hover:bg-content/8 hover:text-content"
          >
            {allSelected ? "Clear" : "Select all"}
          </button>
        )}
      </legend>
      <div className="max-h-48 overflow-y-auto rounded-md bg-content/5 p-1">
        {listed.map((skill) =>
          single ? (
            <SkillRow key={skill.name} skill={skill} />
          ) : (
            <label
              key={skill.name}
              className="flex cursor-default items-start gap-2 rounded px-1.5 py-1 hover:bg-content/5"
            >
              <input
                type="checkbox"
                checked={selected.has(skill.name)}
                onChange={() => onToggle(skill.name)}
                className="mt-0.5 shrink-0 accent-accent"
              />
              <SkillRow skill={skill} />
            </label>
          ),
        )}
      </div>
    </fieldset>
  );
}

function SkillRow({ skill }: { skill: ListedSkill }) {
  return (
    <span className="flex min-w-0 flex-col px-0.5">
      <span className="truncate font-mono text-ui-body text-content">
        {skill.name}
      </span>
      {skill.description ? (
        <span className="line-clamp-1 text-ui-caption text-content/50">
          {skill.description}
        </span>
      ) : null}
    </span>
  );
}

import "./Menu.css";
import { ArrowDownCircle, Plus } from "./icons";
import {
  memo,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { looksLikeProject } from "../lib/recents";
import {
  isValidSkillName,
  slugSkillName,
  type Skill,
  type SkillMatch,
} from "../lib/skills";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { MatchText } from "./MatchText";

type Props = {
  skills: readonly SkillMatch[];
  query: string;
  /**
   * The highlighted row: a skill's index, `skills.length` for the create
   * row, `skills.length + 1` for the closing add row, or -1 when nothing is
   * highlighted (Enter then sends).
   */
  active: number;
  creating: boolean;
  cwd: string;
  error?: string | null;
  busy?: boolean;
  onActive: (index: number) => void;
  onPick: (skill: Skill) => void;
  onStartCreate: () => void;
  /** Opens the Add a skill dialog (install from GitHub or skills.sh). */
  onStartAdd: () => void;
  onCancelCreate: () => void;
  onCreate: (name: string, scope: "project" | "user") => void;
};

/** Rows after the skills: Create skill, then Add a skill. */
export const SKILL_ACTION_ROWS = 2;
export const ADD_SKILL_LABEL = "Add a skill…";

export function SkillPicker({
  skills,
  query,
  active,
  creating,
  cwd,
  error,
  busy,
  onActive,
  onPick,
  onStartCreate,
  onStartAdd,
  onCancelCreate,
  onCreate,
}: Props) {
  return (
    <div data-skill-picker className="aven-glass-overlay overflow-hidden">
      {creating ? (
        <CreateSkillForm
          query={query}
          cwd={cwd}
          error={error}
          busy={busy}
          onCancel={onCancelCreate}
          onCreate={onCreate}
        />
      ) : (
        <SkillList
          skills={skills}
          query={query}
          active={active}
          onActive={onActive}
          onPick={onPick}
          onStartCreate={onStartCreate}
          onStartAdd={onStartAdd}
        />
      )}
    </div>
  );
}

/** The create row's text: the name the new skill would get, if any. */
export function createSkillLabel(query: string): string {
  const name = slugSkillName(query);
  return name ? `Create skill "${name}"` : "New skill";
}

/** Memoized: the composer re-renders for every keystroke and draft change. */
const SkillList = memo(function SkillList({
  skills,
  query,
  active,
  onActive,
  onPick,
  onStartCreate,
  onStartAdd,
}: {
  skills: readonly SkillMatch[];
  query: string;
  active: number;
  onActive: (index: number) => void;
  onPick: (skill: Skill) => void;
  onStartCreate: () => void;
  onStartAdd: () => void;
}) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const activeRef = useRef<HTMLButtonElement>(null);
  const pointer = useRef({ x: Number.NaN, y: Number.NaN, allow: false });
  const fromPointer = useRef(false);

  useEffect(() => {
    pointer.current.allow = false;
  }, [skills]);

  useEffect(() => {
    if (fromPointer.current) {
      fromPointer.current = false;
      return;
    }
    pointer.current.allow = false;
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onListMouseMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.clientX === pointer.current.x && e.clientY === pointer.current.y) {
      return;
    }
    pointer.current = { x: e.clientX, y: e.clientY, allow: true };
  };

  const onRowEnter = (index: number) => {
    if (!pointer.current.allow) return;
    fromPointer.current = true;
    onActive(index);
  };

  const searching = Boolean(query.trim());
  const createActive = active === skills.length;
  const addActive = active === skills.length + 1;

  return (
    <>
      {skills.length === 0 ? (
        <div className="aven-menu">
          <p className="aven-menu-note">
            {searching ? "No matching commands or skills" : "No commands yet"}
          </p>
        </div>
      ) : null}
      <div
        role="listbox"
        aria-label="Commands and skills"
        onMouseMove={onListMouseMove}
      >
        {skills.length > 0 ? (
          <div
            ref={lockOverscroll}
            className="aven-menu max-h-[min(240px,40vh)] overflow-y-auto overscroll-none"
          >
            {skills.map(({ skill, positions, descriptionPositions }, index) => {
              const highlighted = index === active;
              return (
                <button
                  key={`${skill.kind}:${skill.source}:${skill.invocation}`}
                  ref={highlighted ? activeRef : undefined}
                  type="button"
                  role="option"
                  aria-selected={highlighted}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => onRowEnter(index)}
                  onClick={() => onPick(skill)}
                  data-active={highlighted}
                  className="aven-menu-item aven-menu-item-rich"
                >
                  <span className="aven-menu-text">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span
                        className={`truncate font-mono ${
                          highlighted ? "text-skill" : ""
                        }`}
                      >
                        /
                        <MatchText
                          text={skill.invocation}
                          positions={positions}
                          active={searching}
                        />
                      </span>
                      <span className="shrink-0 text-ui-micro uppercase tracking-wide text-content/40">
                        {scopeLabel(skill)}
                      </span>
                    </span>
                    {skill.description ? (
                      <span className="aven-menu-description line-clamp-2">
                        <MatchText
                          text={skill.description}
                          positions={descriptionPositions}
                          active={searching}
                        />
                      </span>
                    ) : null}
                    {skill.kind === "native" &&
                    (skill.inputHint || skill.subcommands?.length) ? (
                      <span className="aven-menu-description line-clamp-2">
                        {skill.inputHint ||
                          skill.subcommands
                            ?.map((sub) => sub.usage || sub.name)
                            .join(" · ")}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
        <div className="aven-menu border-t border-(color:--aven-menu-line)">
          <button
            type="button"
            role="option"
            aria-selected={createActive}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => onRowEnter(skills.length)}
            onClick={onStartCreate}
            data-active={createActive}
            className="aven-menu-item"
          >
            <span aria-hidden="true" className="aven-menu-icon">
              <Plus strokeWidth={1.75} />
            </span>
            <span className="aven-menu-label">{createSkillLabel(query)}</span>
          </button>
          <button
            type="button"
            role="option"
            aria-selected={addActive}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => onRowEnter(skills.length + 1)}
            onClick={onStartAdd}
            data-active={addActive}
            className="aven-menu-item"
          >
            <span aria-hidden="true" className="aven-menu-icon">
              <ArrowDownCircle strokeWidth={1.75} />
            </span>
            <span className="aven-menu-label">{ADD_SKILL_LABEL}</span>
            <span className="aven-menu-detail">GitHub or skills.sh</span>
          </button>
        </div>
      </div>
    </>
  );
});

function CreateSkillForm({
  query,
  cwd,
  error,
  busy,
  onCancel,
  onCreate,
}: {
  query: string;
  cwd: string;
  error?: string | null;
  busy?: boolean;
  onCancel: () => void;
  onCreate: (name: string, scope: "project" | "user") => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const project = looksLikeProject(cwd);
  const [name, setName] = useState(() => slugSkillName(query));
  const [scope, setScope] = useState<"project" | "user">(
    project ? "project" : "user",
  );

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const slug = slugSkillName(name);
  const valid = isValidSkillName(slug);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    onCreate(slug, project ? scope : "user");
  };

  return (
    <form onSubmit={submit} className="px-2.5 py-2">
      <p className="mb-2 text-ui-caption text-content/50">
        Writes a starter SKILL.md you can edit.
      </p>
      <input
        ref={input}
        value={name}
        spellCheck={false}
        placeholder="skill-name"
        aria-label="Skill name"
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          onCancel();
        }}
        className="aven-field mb-2 w-full px-2 py-1.5 font-mono text-ui-body"
      />
      <div className="mb-2 flex gap-1">
        <ScopeButton
          label="Project"
          hint=".agents/skills"
          selected={scope === "project"}
          disabled={!project || busy}
          onClick={() => setScope("project")}
        />
        <ScopeButton
          label="Personal"
          hint="~/.agents/skills"
          selected={scope === "user"}
          disabled={busy}
          onClick={() => setScope("user")}
        />
      </div>
      {error ? (
        <p className="mb-2 text-ui-label text-content/70">{error}</p>
      ) : !name.trim() || valid ? null : (
        <p className="mb-2 text-ui-label text-content/50">
          Use lowercase letters, numbers, and hyphens.
        </p>
      )}
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="rounded-md px-2 py-1 text-ui-label text-content/50 hover:bg-content/10 hover:text-content"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!valid || busy}
          className="rounded-md bg-content/20 px-2 py-1 text-ui-label text-content disabled:opacity-40"
        >
          {busy ? "Creating…" : "Create"}
        </button>
      </div>
    </form>
  );
}

export function ScopeButton({
  label,
  hint,
  selected,
  disabled,
  onClick,
}: {
  label: string;
  hint: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex min-w-0 flex-1 flex-col rounded-md px-2 py-1.5 text-left ${
        selected
          ? "bg-content/20 text-content"
          : "bg-content/10 text-content/70"
      } disabled:opacity-40`}
    >
      <span className="text-ui-label">{label}</span>
      <span className="truncate font-mono text-ui-micro text-content/40">
        {hint}
      </span>
    </button>
  );
}

function scopeLabel(skill: Skill): string {
  if (skill.kind === "native") {
    return skill.origin ? `${skill.source} · ${skill.origin}` : skill.source;
  }
  if (skill.kind === "builtin") return "Aven";
  if (skill.scope === "user") return "personal";
  if (skill.source !== "agents" && skill.source !== "monocode")
    return skill.source;
  return "project";
}

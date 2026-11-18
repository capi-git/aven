import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ProjectCustomizePopover } from "../chrome/ProjectCustomizePopover";
import { ProjectMemoryDialog } from "../chrome/ProjectMemoryDialog";
import {
  projectDisplayName,
  useProjectLabels,
} from "../hooks/useProjectLabels";
import { useSetting } from "../hooks/useSetting";
import { errorText, logError } from "../lib/errors";
import { chatCopiesDir, revealPath } from "../lib/fs";
import { prettyCwd } from "../lib/paths";
import { REVEAL_LABEL } from "../lib/platform";
import { loadSetupScript, saveSetupScript } from "../lib/projectScripts";
import { sameProjectPath } from "../lib/recents";
import { SETTINGS } from "../lib/settings";
import {
  loadSettingsProject,
  subscribeSettingsProject,
} from "../lib/settingsProject";
import {
  isValidRunCommand,
  loadRunScripts,
  saveRunScripts,
  type RunScript,
} from "../lib/workspaceActions";
import {
  Row,
  SecondaryButton,
  Segmented,
  Select,
  SettingsGroup,
  Toggle,
} from "./SettingsControls";

function SwitchRow({
  setting,
}: {
  setting:
    | typeof SETTINGS.confirmQuit
    | typeof SETTINGS.confirmCloseWorkingTab
    | typeof SETTINGS.setupInNewCopies
    | typeof SETTINGS.removeBuildFolders
    | typeof SETTINGS.terminalCursorBlink;
}) {
  const on = useSetting(setting);
  return (
    <Row {...setting.row}>
      <Toggle label={setting.label} on={on} onChange={setting.save} />
    </Row>
  );
}

/** General › Behaviour: the two questions Aven can ask before it closes things. */
export function BehaviourGroup() {
  return (
    <SettingsGroup title="Behaviour">
      <SwitchRow setting={SETTINGS.confirmQuit} />
      <SwitchRow setting={SETTINGS.confirmCloseWorkingTab} />
    </SettingsGroup>
  );
}

export function WorktreesPage() {
  const base = useSetting(SETTINGS.copyBase);
  const [folder, setFolder] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    chatCopiesDir()
      .then((dir) => !cancelled && setFolder(dir))
      .catch((reason) => !cancelled && setError(errorText(reason)));
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <>
      <SettingsGroup title="New copies">
        <Row {...SETTINGS.copyBase.row}>
          <Segmented
            label={SETTINGS.copyBase.label}
            value={base}
            options={[
              { value: "current", label: "Current commit" },
              { value: "default", label: "Main branch" },
            ]}
            onChange={SETTINGS.copyBase.save}
          />
        </Row>
        <SwitchRow setting={SETTINGS.setupInNewCopies} />
        <Row
          label="Where copies are kept"
          description={
            error ?? (folder ? prettyCwd(folder) : "Aven's data folder")
          }
        >
          <SecondaryButton
            disabled={!folder}
            onClick={() => {
              if (folder)
                void revealPath(folder).catch((reason) =>
                  logError("Couldn't show the copies folder", reason),
                );
            }}
          >
            {REVEAL_LABEL}
          </SecondaryButton>
        </Row>
      </SettingsGroup>
      <SettingsGroup title="Removing copies">
        <SwitchRow setting={SETTINGS.removeBuildFolders} />
      </SettingsGroup>
    </>
  );
}

const TERMINAL_FONTS = [
  { value: "", label: "Aven's code font" },
  { value: "SF Mono", label: "SF Mono" },
  { value: "Menlo", label: "Menlo" },
  { value: "Monaco", label: "Monaco" },
  { value: "JetBrains Mono", label: "JetBrains Mono" },
  { value: "Fira Code", label: "Fira Code" },
  { value: "Cascadia Code", label: "Cascadia Code" },
  { value: "Consolas", label: "Consolas" },
];

export function TerminalPage() {
  const font = useSetting(SETTINGS.terminalFont);
  const size = useSetting(SETTINGS.terminalFontSize);
  const cursor = useSetting(SETTINGS.terminalCursor);
  return (
    <SettingsGroup title="Text &amp; cursor">
      <Row {...SETTINGS.terminalFont.row}>
        <Select
          label={SETTINGS.terminalFont.label}
          value={font}
          options={TERMINAL_FONTS}
          onChange={SETTINGS.terminalFont.save}
        />
      </Row>
      <Row {...SETTINGS.terminalFontSize.row}>
        <Select
          label={SETTINGS.terminalFontSize.label}
          value={String(size)}
          options={[10, 11, 12, 13, 14, 15, 16, 18, 20].map((value) => ({
            value: String(value),
            label: `${value} pt`,
          }))}
          onChange={(value) => SETTINGS.terminalFontSize.save(Number(value))}
        />
      </Row>
      <Row {...SETTINGS.terminalCursor.row}>
        <Segmented
          label={SETTINGS.terminalCursor.label}
          value={cursor}
          options={[
            { value: "bar", label: "Bar" },
            { value: "block", label: "Block" },
            { value: "underline", label: "Underline" },
          ]}
          onChange={SETTINGS.terminalCursor.save}
        />
      </Row>
      <SwitchRow setting={SETTINGS.terminalCursorBlink} />
    </SettingsGroup>
  );
}

/** The project Settings › Projects shows, if it is still in the list. */
export function useSettingsProject(projects: readonly string[]): string | null {
  const chosen = useSyncExternalStore(
    subscribeSettingsProject,
    loadSettingsProject,
    loadSettingsProject,
  );
  return projects.find((path) => sameProjectPath(path, chosen)) ?? null;
}

/** A project page's title: the project's name as the sidebar shows it. */
export function ProjectTitle({ path }: { path: string | null }) {
  const labels = useProjectLabels();
  return <>{path ? projectDisplayName(path, labels) : "Projects"}</>;
}

/** A text field that saves when you leave it or press Return. */
function CommandField({
  label,
  value,
  placeholder,
  onSave,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft.trim() !== value) onSave(draft.trim());
  };
  return (
    <input
      className="aven-field settings-command-field"
      aria-label={label}
      value={draft}
      placeholder={placeholder}
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          event.stopPropagation();
          setDraft(value);
        }
      }}
    />
  );
}

/**
 * One project's settings. Each project gets its own page, so what was typed
 * but not added for one (a Run command's draft) never follows you to the
 * next or is added there.
 */
export function ProjectPage({ path }: { path: string | null }) {
  return <ProjectPageFor key={path ?? ""} path={path} />;
}

function ProjectPageFor({ path }: { path: string | null }) {
  const customiseRef = useRef<HTMLDivElement>(null);
  const [customising, setCustomising] = useState(false);
  const [memory, setMemory] = useState(false);
  const [setup, setSetup] = useState("");
  const [scripts, setScripts] = useState<RunScript[]>([]);
  useEffect(() => {
    if (!path) return;
    setSetup(loadSetupScript(path));
    setScripts(loadRunScripts(path));
  }, [path]);
  if (!path)
    return (
      <p className="settings-section-note">
        Choose a project in the list on the left.
      </p>
    );
  const saveScripts = (next: RunScript[]) => {
    setScripts(next);
    saveRunScripts(path, next);
  };
  return (
    <>
      <SettingsGroup title="Project">
        <Row
          label="Name, colour and logo"
          description="How the project shows in the sidebar, its tabs and its chats."
        >
          <div ref={customiseRef}>
            <SecondaryButton onClick={() => setCustomising(true)}>
              Customise…
            </SecondaryButton>
          </div>
        </Row>
        <Row
          label="Memory"
          description="What agents remember about this project between chats."
        >
          <SecondaryButton onClick={() => setMemory(true)}>
            Edit memory…
          </SecondaryButton>
        </Row>
        <Row label="Folder" description={prettyCwd(path)}>
          <SecondaryButton
            onClick={() =>
              void revealPath(path).catch((reason) =>
                logError("Couldn't show the project folder", reason),
              )
            }
          >
            {REVEAL_LABEL}
          </SecondaryButton>
        </Row>
      </SettingsGroup>
      <SettingsGroup title="Scripts">
        <Row
          label="Setup"
          description="Runs the first time a new copy of the project opens, for example npm install."
        >
          <CommandField
            label="Setup command"
            value={setup}
            placeholder="No setup"
            onSave={(value) => {
              if (value && !isValidRunCommand(value)) return;
              setSetup(value);
              saveSetupScript(path, value);
            }}
          />
        </Row>
        {scripts.map((script) => (
          <Row key={script.id} label={`Run · ${script.name}`}>
            <div className="settings-command-line">
              <CommandField
                label={`${script.name} command`}
                value={script.command}
                onSave={(value) => {
                  if (!isValidRunCommand(value)) return;
                  saveScripts(
                    scripts.map((entry) =>
                      entry.id === script.id
                        ? { ...entry, command: value }
                        : entry,
                    ),
                  );
                }}
              />
              <SecondaryButton
                label={`Remove ${script.name}`}
                onClick={() =>
                  saveScripts(scripts.filter((entry) => entry.id !== script.id))
                }
              >
                Remove
              </SecondaryButton>
            </div>
          </Row>
        ))}
        <AddRunRow
          onAdd={(name, command) =>
            saveScripts([
              ...scripts,
              { id: crypto.randomUUID(), name, command },
            ])
          }
        />
      </SettingsGroup>
      {customising ? (
        <ProjectCustomizePopover
          path={path}
          anchor={customiseRef}
          onClose={() => setCustomising(false)}
        />
      ) : null}
      {memory ? (
        <ProjectMemoryDialog path={path} onClose={() => setMemory(false)} />
      ) : null}
    </>
  );
}

function AddRunRow({
  onAdd,
}: {
  onAdd: (name: string, command: string) => void;
}) {
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const add = () => {
    const cleanName = name.trim() || command.trim().split(/\s+/)[0] || "";
    if (!cleanName || !isValidRunCommand(command.trim())) {
      setProblem("Type a command first.");
      return;
    }
    onAdd(cleanName, command.trim());
    setName("");
    setCommand("");
    setProblem(null);
  };
  return (
    <Row
      label="Add a Run command"
      description={
        problem ??
        "Run starts it from the project's side panel, for example ./build.sh."
      }
    >
      <div className="settings-command-line">
        <input
          className="aven-field settings-command-field settings-command-name"
          aria-label="Run command name"
          placeholder="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <input
          className="aven-field settings-command-field"
          aria-label="Run command"
          placeholder="Command"
          spellCheck={false}
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") add();
          }}
        />
        <SecondaryButton onClick={add}>Add</SecondaryButton>
      </div>
    </Row>
  );
}

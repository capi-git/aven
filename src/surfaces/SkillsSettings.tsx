import { useEffect, useRef, useState, type FormEvent } from "react";
import { Plus, RefreshCw, Search } from "../chrome/icons";
import { ModalPanel } from "../chrome/Modal";
import { listSkills, readTextFile } from "../lib/fs";
import { openInAppFile, openInAppUrl } from "../lib/inAppLinks";
import { looksLikeProject } from "../lib/recents";
import { settingSearchAnchor } from "../lib/settingsSearch";
import {
  BUILTIN_COMPUTER_USE_SKILL,
  createBlankSkill,
  mergeCatalog,
  readSkillBody,
  type BuiltinSkill,
  type FileSkill,
} from "../lib/skills";
import {
  getAgentToolStatus,
  installPersonalComputerUseSkill,
  openComputerUseSettings,
  type AgentToolStatus,
} from "../lib/agentTools";
import { SettingsGroup } from "./SettingsControls";
import "./SkillsSettings.css";

type InspectableSkill = FileSkill | BuiltinSkill;
const DESKTOP_STATE = {
  ready: "Permissions granted",
  permissionsRequired: "Permissions needed",
  missing: "Not installed",
  unsupported: "macOS app required",
  unverified: "Could not verify",
};

export function SkillsSettings({ cwd }: { cwd: string }) {
  const [reload, setReload] = useState(0);
  const [catalog, setCatalog] = useState<{
    cwd: string;
    skills: InspectableSkill[];
  } | null>(null);
  const [skillsError, setSkillsError] = useState("");
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [tools, setTools] = useState<AgentToolStatus | null>(null);
  const [toolsLoading, setToolsLoading] = useState(true);
  const [toolsError, setToolsError] = useState("");
  const [toolReload, setToolReload] = useState(0);
  const [selected, setSelected] = useState<InspectableSkill | null>(null);
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    setSkillsLoading(true);
    setSkillsError("");
    setSelected(null);
    setQuery("");
    void listSkills(cwd)
      .then((files) => {
        if (active)
          setCatalog({
            cwd,
            skills: mergeCatalog(files).filter(
              (skill): skill is InspectableSkill => skill.kind !== "native",
            ),
          });
      })
      .catch(() => {
        if (active) {
          setCatalog({ cwd, skills: mergeCatalog([]) as InspectableSkill[] });
          setSkillsError(
            "Installed skills could not be read. Built-in instructions are still available.",
          );
        }
      })
      .finally(() => {
        if (active) setSkillsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [cwd, reload]);

  useEffect(() => {
    let active = true;
    setToolsLoading(true);
    setToolsError("");
    void getAgentToolStatus()
      .then((value) => {
        if (active) setTools(value);
      })
      .catch(() => {
        if (active) {
          setTools(null);
          setToolsError("Tools could not be checked. Try again.");
        }
      })
      .finally(() => {
        if (active) setToolsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [toolReload]);

  const skills = catalog?.cwd === cwd ? catalog.skills : [];
  const needle = query.trim().toLowerCase();
  const filtered = skills.filter((skill) =>
    `${skill.name} ${skill.description} ${skill.source}`
      .toLowerCase()
      .includes(needle),
  );
  const desktop = tools?.desktop;
  const personalCopy = skills.some(
    (skill) =>
      skill.name === BUILTIN_COMPUTER_USE_SKILL.name &&
      skill.kind === "file" &&
      skill.scope === "user",
  );

  const showError = (error: unknown) =>
    setNotice(error instanceof Error ? error.message : String(error));
  const exportSkill = async () => {
    if (exporting) return;
    setExporting(true);
    setNotice("");
    try {
      const path = await installPersonalComputerUseSkill();
      setNotice(
        "Added to personal skills. Providers with their own skill catalog may need a new task to discover it.",
      );
      setReload((value) => value + 1);
      openInAppFile(path);
    } catch (error) {
      showError(error);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="skills-settings">
      <SettingsGroup
        title="Tools for your tasks"
        description="Web tools are built in. Desktop control uses an optional local helper."
      >
        <div
          className="skills-tool"
          id={settingSearchAnchor("In-app browser")}
          tabIndex={-1}
        >
          <div className="skills-tool-heading">
            <h3>In-app browser</h3>
            <span
              className="skills-status"
              data-state={tools?.browserAvailable ? "ready" : "neutral"}
            >
              {toolsLoading
                ? "Checking…"
                : tools
                  ? tools.browserAvailable
                    ? "Built in"
                    : "Desktop app required"
                  : "Not checked"}
            </span>
          </div>
          <p>
            Agents can open and inspect web pages beside your conversation. Each
            task receives access to its own browser tabs.
          </p>
          <p className="skills-note">
            Access is supplied when a task runs. No separate browser extension
            or MCP setup is needed.
          </p>
        </div>
        <div
          className="skills-tool"
          id={settingSearchAnchor("Desktop control")}
          tabIndex={-1}
        >
          <div className="skills-tool-heading">
            <h3>Desktop control</h3>
            <span
              className="skills-status"
              data-state={desktop?.state ?? "neutral"}
            >
              {toolsLoading
                ? "Checking…"
                : desktop
                  ? DESKTOP_STATE[desktop.state]
                  : "Not checked"}
            </span>
          </div>
          <p>
            Use Peekaboo to inspect and interact with native Mac windows,
            including Aven. Invoke <code>/aven-computer-use</code> in a task for
            the instructions.
          </p>
          {desktop?.version ? (
            <p className="skills-note">
              {desktop.version}
              {desktop.source ? ` · Permission source: ${desktop.source}` : ""}
            </p>
          ) : null}
          {desktop?.permissions.length ? (
            <ul className="skills-permissions" aria-label="Desktop permissions">
              {desktop.permissions.map((permission) => (
                <li key={permission.name}>
                  <span>
                    {permission.name}
                    {!permission.required ? " (optional)" : ""}
                  </span>
                  <strong>
                    {permission.granted ? "Granted" : "Not granted"}
                  </strong>
                </li>
              ))}
            </ul>
          ) : null}
          {desktop?.state === "ready" ? (
            <p className="skills-note">
              The selected host reports the required permissions. The agent
              still checks the intended window and verifies each action.
            </p>
          ) : null}
          {desktop?.state === "unverified" ? (
            <p className="skills-note">
              Peekaboo was found, but its status response could not be verified.
              Check the installed CLI and selected bridge, then refresh.
            </p>
          ) : null}
          {toolsError ? (
            <p className="skills-error" role="alert">
              {toolsError}
            </p>
          ) : null}
          <div className="skills-actions">
            <button
              type="button"
              className="settings-button"
              disabled={toolsLoading}
              onClick={() => setToolReload((value) => value + 1)}
            >
              <RefreshCw aria-hidden className="size-3.5" />
              {toolsLoading ? "Checking…" : "Check status"}
            </button>
            <button
              type="button"
              className="settings-button"
              onClick={() => setSelected(BUILTIN_COMPUTER_USE_SKILL)}
            >
              View instructions
            </button>
            <button
              type="button"
              className="settings-button"
              disabled={exporting || personalCopy}
              onClick={() => void exportSkill()}
            >
              {personalCopy
                ? "In personal skills"
                : exporting
                  ? "Adding…"
                  : "Add to personal skills"}
            </button>
          </div>
          <details className="skills-setup">
            <summary>Setup and permissions</summary>
            <div>
              <p>Install the optional CLI with Homebrew:</p>
              <code className="skills-command">
                brew install openclaw/tap/peekaboo
              </code>
              <p>
                Screen Recording and Accessibility belong to the execution host
                reported by Peekaboo. If it uses a bridge, grant access to that
                host. Event Synthesizing enables additional input actions.
              </p>
              <p>
                Aven checks status without requesting or changing permissions.
                You choose which access to grant in macOS.
              </p>
              {desktop && desktop.state !== "unsupported" ? (
                <div className="skills-actions">
                  <button
                    type="button"
                    className="settings-button"
                    onClick={() =>
                      void openComputerUseSettings("screenRecording").catch(
                        showError,
                      )
                    }
                  >
                    Screen Recording settings
                  </button>
                  <button
                    type="button"
                    className="settings-button"
                    onClick={() =>
                      void openComputerUseSettings("accessibility").catch(
                        showError,
                      )
                    }
                  >
                    Accessibility settings
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                className="skills-text-button"
                onClick={() =>
                  void openInAppUrl(
                    "https://github.com/openclaw/Peekaboo/blob/main/docs/permissions.md",
                  ).catch(showError)
                }
              >
                Read the setup guide
              </button>
              {desktop?.executable ? (
                <p className="skills-path">{desktop.executable}</p>
              ) : null}
            </div>
          </details>
          {notice ? (
            <p className="skills-note" role="status">
              {notice}
            </p>
          ) : null}
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Installed skills"
        id={settingSearchAnchor("Installed skills")}
        scope={skillsLoading ? "Loading…" : `${skills.length} available`}
        description="Reusable instructions from this project, your personal folders, and supported provider skill locations."
      >
        <div className="skills-catalog-toolbar">
          <label className="skills-search">
            <Search aria-hidden className="size-4" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a skill"
              aria-label="Find a skill"
            />
          </label>
          <button
            type="button"
            className="settings-button"
            disabled={skillsLoading}
            onClick={() => setReload((value) => value + 1)}
            aria-label="Refresh skills"
          >
            <RefreshCw aria-hidden className="size-4" />
          </button>
          <button
            type="button"
            className="settings-button"
            onClick={() => setCreating(true)}
          >
            <Plus aria-hidden className="size-4" />
            New skill
          </button>
        </div>
        <p className="skills-context">
          Project: <span>{cwd || "No project selected"}</span>
        </p>
        {skillsError ? (
          <p className="skills-error" role="alert">
            {skillsError}
          </p>
        ) : null}
        <div className="skills-list" aria-busy={skillsLoading}>
          {filtered.map((skill) => (
            <button
              type="button"
              className="skills-item"
              key={skill.name}
              onClick={() => setSelected(skill)}
            >
              <span className="skills-item-copy">
                <strong>/{skill.name}</strong>
                <span>{skill.description || "No description supplied."}</span>
              </span>
              <span className="skills-item-source">
                {skill.kind === "builtin"
                  ? "Built into Aven"
                  : `${skill.scope === "user" ? "Personal" : "Project"} · ${skill.source}`}
              </span>
            </button>
          ))}
          {!filtered.length ? (
            <p className="skills-empty">
              {skillsLoading
                ? "Loading skill instructions…"
                : "No skills match your search."}
            </p>
          ) : null}
        </div>
        <p className="skills-note skills-catalog-footer">
          Use / in the composer to choose a skill. Project and personal
          .agents/skills folders take precedence over provider copies with the
          same name.
        </p>
      </SettingsGroup>

      <SettingsGroup
        title="Provider tools"
        id={settingSearchAnchor("Provider tools")}
        description="MCP servers, plugins, and native commands stay with the provider that owns them."
      >
        <div className="skills-tool">
          <p>
            Codex and Claude use their existing provider configuration. Pi and
            Oh My Pi supply their own command catalogs; this list shows files
            Aven can discover, not a live inventory of every provider tool.
          </p>
          <p className="skills-note">
            Installing a skill adds instructions. It does not install the tools
            it mentions or prove that a server is connected.
          </p>
        </div>
      </SettingsGroup>
      {selected ? (
        <SkillInspector
          key={`${selected.name}:${selected.kind === "file" ? selected.path : "builtin"}`}
          skill={selected}
          onClose={() => setSelected(null)}
        />
      ) : null}
      {creating ? (
        <NewSkill
          cwd={cwd}
          onClose={() => setCreating(false)}
          onCreated={(path) => {
            setCreating(false);
            setReload((value) => value + 1);
            openInAppFile(path);
          }}
        />
      ) : null}
    </div>
  );
}

function SkillInspector({
  skill,
  onClose,
}: {
  skill: InspectableSkill;
  onClose: () => void;
}) {
  const [body, setBody] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void (
      skill.kind === "file" ? readTextFile(skill.path) : readSkillBody(skill)
    )
      .then((text) => {
        if (active) setBody(text);
      })
      .catch(() => {
        if (active)
          setError(
            "This skill could not be read. It may have moved or become unavailable.",
          );
      });
    return () => {
      active = false;
    };
  }, [skill]);
  return (
    <ModalPanel
      title={`/${skill.name}`}
      description={
        skill.kind === "file" ? skill.path : "Built-in Aven instructions"
      }
      onClose={onClose}
      className="skills-inspector"
    >
      {error ? (
        <p className="skills-error" role="alert">
          {error}
        </p>
      ) : body === null ? (
        <p role="status">Loading instructions…</p>
      ) : (
        <pre
          className="skills-instructions"
          tabIndex={0}
          aria-label="Skill instructions"
        >
          {body}
        </pre>
      )}
      {skill.kind === "file" ? (
        <div className="skills-actions">
          <button
            type="button"
            className="settings-button"
            onClick={() => {
              openInAppFile(skill.path);
              onClose();
            }}
          >
            Open in editor
          </button>
        </div>
      ) : null}
    </ModalPanel>
  );
}

function NewSkill({
  cwd,
  onClose,
  onCreated,
}: {
  cwd: string;
  onClose: () => void;
  onCreated: (path: string) => void;
}) {
  const [name, setName] = useState("");
  const project = looksLikeProject(cwd);
  const [scope, setScope] = useState<"project" | "user">(
    project ? "project" : "user",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const path = await createBlankSkill({ cwd, name, scope });
      if (alive.current) onCreated(path);
    } catch (reason) {
      if (alive.current) setError(String(reason));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return (
    <ModalPanel
      title="New skill"
      description="Create a SKILL.md with reusable instructions, then edit it in Aven."
      onClose={onClose}
      size="sm"
    >
      <form
        className="skills-new-form"
        onSubmit={(event) => void submit(event)}
      >
        <label>
          Name
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="review-changes"
            disabled={busy}
            required
          />
        </label>
        <label>
          Location
          <select
            value={scope}
            onChange={(event) =>
              setScope(event.target.value as "project" | "user")
            }
            disabled={busy}
          >
            {project ? <option value="project">This project</option> : null}
            <option value="user">Personal · all projects</option>
          </select>
        </label>
        {error ? (
          <p className="skills-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="skills-actions">
          <button
            type="submit"
            className="settings-button"
            disabled={busy || !name.trim()}
          >
            {busy ? "Creating…" : "Create skill"}
          </button>
        </div>
      </form>
    </ModalPanel>
  );
}

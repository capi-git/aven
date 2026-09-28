import { useEffect, useRef, useState, type FormEvent } from "react";
import { Plus, RefreshCw, Search } from "../chrome/icons";
import { ModalPanel } from "../chrome/Modal";
import { listSkills, readTextFile } from "../lib/fs";
import { openInAppFile } from "../lib/inAppLinks";
import { parentPath } from "../lib/paths";
import { AgentMarkdown } from "./AgentMarkdown";
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
  openComputerUseSettings,
  requestDesktopPermission,
  setDesktopControlEnabled,
  type AgentToolStatus,
  type DesktopControlStatus,
} from "../lib/agentTools";
import { Select, SettingsGroup, Toggle } from "./SettingsControls";
import "./SkillsSettings.css";

type InspectableSkill = FileSkill | BuiltinSkill;
const skillSourceLabel = (skill: InspectableSkill) =>
  skill.source === "monocode" ? "Aven" : skill.source;
const DESKTOP_STATE = {
  ready: "Ready",
  permissionsRequired: "Permissions needed",
  off: "Off",
  unsupported: "Unsupported",
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
  const [source, setSource] = useState<
    "all" | "project" | "personal" | "builtin"
  >("all");
  const [tools, setTools] = useState<AgentToolStatus | null>(null);
  const [toolsLoading, setToolsLoading] = useState(true);
  const [toolsError, setToolsError] = useState("");
  const [toolReload, setToolReload] = useState(0);
  const [desktopBusy, setDesktopBusy] = useState(false);
  const [selected, setSelected] = useState<InspectableSkill | null>(null);
  const [creating, setCreating] = useState(false);
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
    `${skill.name} ${skill.description} ${skill.source} ${skillSourceLabel(skill)}`
      .toLowerCase()
      .includes(needle),
  );
  const desktop = tools?.desktop;

  const showError = (error: unknown) =>
    setNotice(error instanceof Error ? error.message : String(error));

  const updateDesktop = async (
    action: () => Promise<DesktopControlStatus>,
  ) => {
    setDesktopBusy(true);
    setToolsError("");
    try {
      const updated = await action();
      setTools((current) =>
        current ? { ...current, desktop: updated } : current,
      );
    } catch (error) {
      setToolsError(error instanceof Error ? error.message : String(error));
    } finally {
      setDesktopBusy(false);
    }
  };

  const missingPermissions = desktop?.enabled
    ? desktop.permissions.filter(
        (permission) => permission.required && !permission.granted,
      )
    : [];
  const sourceCounts = {
    all: skills.length,
    project: skills.filter(
      (skill) => skill.kind === "file" && skill.scope !== "user",
    ).length,
    personal: skills.filter(
      (skill) => skill.kind === "file" && skill.scope === "user",
    ).length,
    builtin: skills.filter((skill) => skill.kind === "builtin").length,
  };
  const visible = filtered.filter((skill) =>
    source === "all"
      ? true
      : source === "builtin"
        ? skill.kind === "builtin"
        : skill.kind === "file" &&
          (source === "personal") === (skill.scope === "user"),
  );
  const projectName = cwd ? cwd.split("/").filter(Boolean).pop() : null;

  return (
    <div className="skills-settings">
      <SettingsGroup
        title="Tools"
        description="What agents can use beyond your files and terminal."
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
            Agents open web pages and local previews beside the task, each in
            its own tabs. Nothing to set up.
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
            Agents can see and operate Mac apps, including Aven, when you ask
            them to. Desktop control is built into Aven and off by default.
          </p>
          <div className="skills-tool-heading skills-desktop-switch">
            <span>Let agents see and use apps on this Mac</span>
            <Toggle
              label="Let agents see and use apps on this Mac"
              on={desktop?.enabled ?? false}
              disabled={
                toolsLoading ||
                desktopBusy ||
                !desktop ||
                desktop.state === "unsupported"
              }
              onChange={(enabled) =>
                void updateDesktop(() => setDesktopControlEnabled(enabled))
              }
            />
          </div>
          <p className="skills-note">
            {desktop?.state === "unsupported"
              ? "Desktop control requires the Aven app on macOS."
              : "Turn it on to let macOS ask for Screen Recording and Accessibility, with Aven listed by name."}
          </p>
          {missingPermissions.length ? (
            <p className="skills-note">
              macOS needs to allow{" "}
              {missingPermissions
                .map((permission) => permission.name)
                .join(" and ")}
              {" "}for Aven. Choose Allow to request each permission.
            </p>
          ) : null}
          {missingPermissions.some((permission) => permission.name === "Screen Recording") ? (
            <p className="skills-note">
              macOS may ask you to quit and reopen Aven after allowing Screen
              Recording.
            </p>
          ) : null}
          {toolsError ? (
            <p className="skills-error" role="alert">
              {toolsError}
            </p>
          ) : null}
          <div className="skills-actions">
            {missingPermissions.map((permission) => (
              <div className="skills-permission-actions" key={permission.name}>
                <button
                  type="button"
                  className="settings-button"
                  disabled={toolsLoading || desktopBusy}
                  onClick={() =>
                    void updateDesktop(() =>
                      requestDesktopPermission(
                        permission.name === "Accessibility"
                          ? "accessibility"
                          : "screenRecording",
                      ),
                    )
                  }
                >
                  Allow {permission.name}
                </button>
                <button
                  type="button"
                  className="settings-button"
                  disabled={toolsLoading || desktopBusy}
                  onClick={() =>
                    void openComputerUseSettings(
                      permission.name === "Accessibility"
                        ? "accessibility"
                        : "screenRecording",
                    ).catch(showError)
                  }
                >
                  Open {permission.name} settings
                </button>
              </div>
            ))}
            <button
              type="button"
              className="settings-button"
              disabled={toolsLoading || desktopBusy}
              onClick={() => setToolReload((value) => value + 1)}
            >
              <RefreshCw aria-hidden className="size-3.5" />
              {toolsLoading ? "Checking…" : "Check again"}
            </button>
            <button
              type="button"
              className="settings-button"
              onClick={() => setSelected(BUILTIN_COMPUTER_USE_SKILL)}
            >
              View instructions
            </button>
          </div>
          {notice ? (
            <p className="skills-note" role="status">
              {notice}
            </p>
          ) : null}
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Skills"
        id={settingSearchAnchor("Installed skills")}
        scope={skillsLoading ? "Loading…" : `${skills.length} available`}
        description={`Reusable instructions. Type / in the composer to use one.${projectName ? ` Includes skills from ${projectName}.` : ""}`}
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
        <div
          className="skills-filters"
          role="radiogroup"
          aria-label="Skill source"
        >
          {(
            [
              ["all", "All"],
              ["project", "Project"],
              ["personal", "Personal"],
              ["builtin", "Built in"],
            ] as const
          ).map(([value, label]) =>
            value === "all" || sourceCounts[value] ? (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={source === value}
                className="skills-filter"
                onClick={() => setSource(value)}
              >
                {label}
                <span>{sourceCounts[value]}</span>
              </button>
            ) : null,
          )}
        </div>
        {skillsError ? (
          <p className="skills-error" role="alert">
            {skillsError}
          </p>
        ) : null}
        <div className="skills-list" aria-busy={skillsLoading}>
          {visible.map((skill) => (
            <button
              type="button"
              className="skills-item"
              key={skill.name}
              title={skill.description || undefined}
              onClick={() => setSelected(skill)}
            >
              <span className="skills-item-copy">
                <strong>/{skill.name}</strong>
                <span>{skill.description || "No description supplied."}</span>
              </span>
              <span className="skills-item-source">
                {skill.kind === "builtin"
                  ? "Built into Aven"
                  : `${skill.scope === "user" ? "Personal" : "Project"} · ${skillSourceLabel(skill)}`}
              </span>
            </button>
          ))}
          {!visible.length ? (
            <p className="skills-empty">
              {skillsLoading
                ? "Loading skill instructions…"
                : "No skills match your search."}
            </p>
          ) : null}
        </div>
        <p className="skills-note skills-catalog-footer">
          A skill adds instructions, not tools. Add MCP servers in Connections.
          Project and personal copies win over provider copies with the same
          name.
        </p>
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
        <section
          className="skills-instructions"
          tabIndex={0}
          aria-label="Skill instructions"
        >
          <AgentMarkdown
            text={body
              .replace(
                /^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/,
                "",
              )
              .trimStart()}
            cwd={skill.kind === "file" ? parentPath(skill.path) : undefined}
            onOpenFile={(path, navigation) => {
              openInAppFile(path, navigation);
              onClose();
            }}
          />
        </section>
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
          <Select
            label="Skill location"
            value={scope}
            onChange={(next) => setScope(next as "project" | "user")}
            disabled={busy}
            fullWidth
            options={[
              ...(project ? [{ value: "project", label: "This project" }] : []),
              { value: "user", label: "Personal · all projects" },
            ]}
          />
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

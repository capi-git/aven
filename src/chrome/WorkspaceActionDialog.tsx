import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { openInAppUrl } from "../lib/inAppLinks";
import { cloneRepo, createPath, pickFolder, readTextFile } from "../lib/fs";
import { LAYER } from "../lib/layers";
import {
  githubCompareUrl,
  isValidRunCommand,
  personalProjectInfo,
  routedCloneUrl,
  type RunScript,
  type PersonalProjectInfo,
} from "../lib/workspaceActions";
import { X } from "./icons";
import "./WorkspaceActionDialog.css";

export type WorkspaceActionKind = "clone" | "create" | "run" | "pr";
type Props = {
  kind: WorkspaceActionKind;
  cwd: string;
  profileId: string;
  profileName: string;
  scripts: RunScript[];
  onScriptsChange: (scripts: RunScript[]) => void;
  onCreated: (path: string, profileId: string) => void;
  onClose: () => void;
};
function Frame({
  title,
  busy,
  onClose,
  children,
}: {
  title: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLElement>("input,button")?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return createPortal(
    <div
      className="workspace-dialog-shade"
      style={{ zIndex: LAYER.dialog }}
      onMouseDown={() => !busy && onClose()}
    >
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="workspace-action-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) {
            event.stopPropagation();
            onClose();
          }
          if (event.key !== "Tab") return;
          const nodes = [
            ...(root.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
            ) ?? []),
          ];
          const next = event.shiftKey ? nodes[nodes.length - 1] : nodes[0];
          if (
            (event.shiftKey && document.activeElement === nodes[0]) ||
            (!event.shiftKey &&
              document.activeElement === nodes[nodes.length - 1])
          ) {
            event.preventDefault();
            next?.focus();
          }
        }}
      >
        <header>
          <h2>{title}</h2>
          <button aria-label="Close dialog" disabled={busy} onClick={onClose}>
            <X className="size-4" />
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  );
}
export function WorkspaceActionDialog(props: Props) {
  const {
    kind,
    cwd,
    profileId,
    profileName,
    scripts,
    onScriptsChange,
    onCreated,
    onClose,
  } = props;
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [parent, setParent] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [error, setError] = useState("");
  const [info, setInfo] = useState<PersonalProjectInfo | null>(null);
  const [base, setBase] = useState("");
  const [body, setBody] = useState("");
  const [suggestions, setSuggestions] = useState<
    { name: string; command: string }[]
  >([]);
  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    setSuggestions([]);
    setError("");
    if (!submitting.current) setBusy(false);
    if (kind === "pr") {
      setBusy(true);
      personalProjectInfo(cwd)
        .then((value) => {
          if (cancelled) return;
          setInfo(value);
          setBase(value.defaultBranch ?? "main");
          if (!value.remoteUrl)
            setError(
              "This project has no remote. Add a GitHub remote before creating a PR.",
            );
          else if (!value.branch)
            setError("Check out a branch before creating a PR.");
        })
        .catch((e) => !cancelled && setError(String(e)))
        .finally(() => !cancelled && setBusy(false));
    }
    if (kind === "run")
      readTextFile(`${cwd}/package.json`)
        .then((raw) => {
          const pkg = JSON.parse(raw);
          if (
            !cancelled &&
            pkg.scripts &&
            typeof pkg.scripts === "object" &&
            !Array.isArray(pkg.scripts)
          )
            setSuggestions(
              Object.keys(pkg.scripts)
                .filter(
                  (key) =>
                    /^[\w][\w:-]*$/.test(key) &&
                    typeof pkg.scripts[key] === "string",
                )
                .slice(0, 12)
                .map((key) => ({ name: key, command: `npm run ${key}` })),
            );
        })
        .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [kind, cwd]);
  const chooseParent = async () => {
    const path = await pickFolder(
      kind === "clone" ? "Clone into folder" : "Create project inside folder",
    );
    if (path && mounted.current) setParent(path);
  };
  const submit = async () => {
    if (busy || submitting.current) return;
    submitting.current = true;
    setError("");
    setBusy(true);
    try {
      if ((kind === "clone" || kind === "create") && !parent.trim())
        throw new Error("Choose a parent folder.");
      if (kind === "clone")
        onCreated(
          await cloneRepo(routedCloneUrl(name), parent),
          profileId,
        );
      else if (kind === "create") {
        if (
          !name.trim() ||
          /[\\/\0]/.test(name) ||
          [".", ".."].includes(name.trim())
        )
          throw new Error("Use a single folder name.");
        onCreated(await createPath(parent, name.trim(), true), profileId);
      } else if (kind === "run") {
        if (!name.trim() || !isValidRunCommand(command))
          throw new Error(
            "Enter a name and a single-line command without control characters.",
          );
        onScriptsChange([
          ...scripts,
          {
            id: crypto.randomUUID(),
            name: name.trim(),
            command: command.trim(),
          },
        ]);
      } else if (kind === "pr") {
        if (!info?.remoteUrl || !info.branch)
          throw new Error(
            "Wait for a project with a GitHub remote and current branch.",
          );
        await openInAppUrl(
          githubCompareUrl(info.remoteUrl, base, info.branch, name, body),
        );
      }
      if (mounted.current) onClose();
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const title = {
    clone: "Clone from URL",
    create: "Quick start new project",
    run: "Run scripts",
    pr: "Create PR",
  }[kind];
  return (
    <Frame title={title} busy={busy} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {(kind === "clone" || kind === "create") && (
          <>
            <p>Add a project to {profileName}.</p>
            <label>
              {kind === "clone" ? "Repository URL" : "Project name"}
              <input
                autoFocus
                value={name}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  kind === "clone"
                    ? "https://github.com/owner/repository"
                    : "My project"
                }
                required
              />
            </label>
            <label>
              Location
              <button
                type="button"
                className="workspace-folder-button"
                onClick={() => void chooseParent()}
                disabled={busy}
              >
                {parent || "Choose a folder…"}
              </button>
            </label>
          </>
        )}
        {kind === "run" && (
          <>
            {scripts.length > 0 && (
              <ul className="workspace-saved-scripts">
                {scripts.map((script) => (
                  <li key={script.id}>
                    <span>
                      {script.name}
                      <small>{script.command}</small>
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${script.name}`}
                      onClick={() =>
                        onScriptsChange(
                          scripts.filter((row) => row.id !== script.id),
                        )
                      }
                    >
                      <X className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <label>
              Name
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Development server"
                required
              />
            </label>
            <label>
              Command
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="npm run dev"
                required
              />
            </label>
            {suggestions.length > 0 && (
              <div className="workspace-script-suggestions">
                {suggestions.map((script) => (
                  <button
                    type="button"
                    key={script.name}
                    onClick={() => {
                      setName(script.name);
                      setCommand(script.command);
                    }}
                  >
                    {script.name}
                  </button>
                ))}
              </div>
            )}
            <p>Runs in {cwd}. Saving does not run the command.</p>
          </>
        )}
        {kind === "pr" && (
          <>
            <p>
              Review the comparison in GitHub, then create the pull request
              there. Commits must already be pushed.
            </p>
            {info && (
              <div className="workspace-pr-context">
                <span>{info.remoteUrl || "No remote"}</span>
                <span>From {info.branch || "Detached HEAD"}</span>
              </div>
            )}
            <label>
              Base branch
              <input
                autoFocus
                value={base}
                disabled={busy}
                onChange={(e) => setBase(e.target.value)}
                required
              />
            </label>
            <label>
              Title
              <input
                value={name}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
                placeholder="Describe this change"
              />
            </label>
            <label>
              Description
              <textarea
                value={body}
                disabled={busy}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
              />
            </label>
          </>
        )}
        {error && (
          <p role="alert" className="workspace-action-error">
            {error}
          </p>
        )}
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className="workspace-primary-button"
            disabled={
              busy ||
              ((kind === "clone" || kind === "create") && !parent) ||
              (kind === "pr" && (!info?.branch || !info.remoteUrl))
            }
            type="submit"
          >
            {busy
              ? "Working…"
              : {
                  clone: "Clone project",
                  create: "Create project",
                  run: "Save script",
                  pr: "Continue in GitHub",
                }[kind]}
          </button>
        </footer>
      </form>
    </Frame>
  );
}

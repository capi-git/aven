import { memo, type ReactNode } from "react";
import { Terminal } from "./icons";
import "./WorkspaceFooter.css";

export type WorkspaceFooterProps = {
  active: boolean;
  /** The active working copy, including a session worktree when applicable. */
  cwd: string;
  onToggleTerminal?: () => void;
  terminalOpen?: boolean;
  /** Account usage for the agents in use. */
  usage?: ReactNode;
};

/**
 * Agents and the terminal only. Branch, changes and pull requests live in
 * the file sidebar's Changes tab, beside the diff they describe.
 */
export const WorkspaceFooter = memo(function WorkspaceFooter({
  active,
  cwd,
  onToggleTerminal,
  terminalOpen = false,
  usage,
}: WorkspaceFooterProps) {
  if (!active) return null;
  const terminalEnabled = !!cwd && cwd !== "~" && !!onToggleTerminal;

  return (
    <footer className="workspace-footer" aria-label="Workspace status">
      <div className="workspace-footer-usage">{usage}</div>

      <div className="workspace-footer-tools">
        <button
          type="button"
          className="workspace-footer-icon"
          disabled={!terminalEnabled}
          title={
            terminalEnabled
              ? `${terminalOpen ? "Hide" : "Show"} terminal`
              : "Open a project to use the terminal"
          }
          aria-label={`${terminalOpen ? "Hide" : "Show"} terminal`}
          aria-pressed={terminalOpen}
          onClick={onToggleTerminal}
        >
          <Terminal className="size-3.5" strokeWidth={1.75} aria-hidden />
        </button>
      </div>
    </footer>
  );
});

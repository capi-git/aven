import { memo, type ReactNode } from "react";
import "./WorkspaceFooter.css";

export type WorkspaceFooterProps = {
  active: boolean;
  /**
   * The window's shrunk teams (see `TeamWatchPills`): a slot of their own,
   * so they never float over the work area or the side panel.
   */
  teams?: ReactNode;
};

/**
 * Agents, their teams and the terminal only. Branch, changes and pull
 * requests live in the file sidebar's Changes tab, beside the diff they
 * describe.
 */
export const WorkspaceFooter = memo(function WorkspaceFooter({
  active,
  teams,
}: WorkspaceFooterProps) {
  if (!active) return null;

  return (
    <footer className="workspace-footer" aria-label="Workspace status">
      {teams ? <div className="workspace-footer-teams">{teams}</div> : null}
    </footer>
  );
});

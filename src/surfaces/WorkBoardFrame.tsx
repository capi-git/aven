import { ProjectMark } from "../chrome/ProjectMark";
import {
  projectDisplayName,
  useProjectLabels,
} from "../hooks/useProjectLabels";
import { BOARD_COLUMNS } from "../lib/workBoard";
import "./WorkBoard.css";

/** The board's title: its project's mark and name, and one line under it. */
export function WorkBoardHeading({
  project,
  line,
}: {
  project: string;
  line: string;
}) {
  const labels = useProjectLabels();
  return (
    <header className="work-board-header">
      <ProjectMark path={project} className="work-board-mark" />
      <div className="work-board-heading">
        <h1>{projectDisplayName(project, labels)}</h1>
        <p className="work-board-today">{line}</p>
      </div>
    </header>
  );
}

/**
 * The board while its own code loads: its title and its four columns,
 * drawn at once with the workspace's code and styles, so opening a board
 * never shows a blank pane. The board itself then draws in the same place.
 */
export function WorkBoardFrame({ project }: { project: string }) {
  const labels = useProjectLabels();
  return (
    <div
      className="work-board"
      data-work-board-frame={project}
      aria-busy="true"
      aria-label={`${projectDisplayName(project, labels)} board`}
    >
      <WorkBoardHeading project={project} line="Loading…" />
      <div className="work-board-columns">
        {BOARD_COLUMNS.map((column) => (
          <section
            key={column.id}
            className="work-board-column"
            data-board-column={column.id}
            aria-label={column.title}
          >
            <h2 className="work-board-column-title">
              <span>{column.title}</span>
            </h2>
            <p className="work-board-empty">Loading…</p>
          </section>
        ))}
      </div>
    </div>
  );
}

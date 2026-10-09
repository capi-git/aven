import { lazy, type ReactNode, Suspense, useSyncExternalStore } from "react";
import { basename } from "../lib/fs";
import { looksLikeProject } from "../lib/recents";
import { isProjectlessCwd } from "../lib/projectlessWorkspace";
import {
  loadGridArcadeEnabled,
  GRID_ARCADE_ENABLED_DEFAULT,
  subscribeGridArcadeEnabled,
} from "../lib/settings";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import "./EmptySession.css";

// The decorative arcade (canvas games and sprites) loads after the first paint.
const TerminalGridBackground = lazy(() =>
  import("./TerminalGridBackground").then((module) => ({
    default: module.TerminalGridBackground,
  })),
);

type Props = {
  cwd: string;
  visible: boolean;
  composer?: ReactNode;
  hasChatBackground?: boolean;
};

export function EmptySession({
  cwd,
  visible,
  composer,
  hasChatBackground,
}: Props) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const arcadeEnabled = useSyncExternalStore(
    subscribeGridArcadeEnabled,
    loadGridArcadeEnabled,
    () => GRID_ARCADE_ENABLED_DEFAULT,
  );
  const project =
    !isProjectlessCwd(cwd) && looksLikeProject(cwd) ? basename(cwd) : null;
  return (
    <div
      ref={lockOverscroll}
      className="aven-opening empty-session"
      data-composer-docked={!composer || undefined}
    >
      {arcadeEnabled && !hasChatBackground ? (
        <Suspense fallback={null}>
          <TerminalGridBackground visible={visible} />
        </Suspense>
      ) : null}
      <div className="personal-empty-session">
        <div className="aven-opening-heading personal-empty-session-heading">
          <h1>Make room for your next idea.</h1>
          <p title={project ? cwd : undefined}>
            {project
              ? `Start something in ${project}.`
              : "What would you like to build?"}
          </p>
        </div>

        {composer ? (
          <div className="empty-session-composer">{composer}</div>
        ) : null}
      </div>
    </div>
  );
}

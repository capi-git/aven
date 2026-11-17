import {
  type ReactNode,
  Suspense,
  useContext,
  useSyncExternalStore,
} from "react";
import { SurfaceBoundary } from "../chrome/SurfaceBoundary";
import { basename } from "../lib/fs";
import { looksLikeProject } from "../lib/recents";
import { retryableLazy } from "../lib/retryableLazy";
import { isProjectlessCwd } from "../lib/projectlessWorkspace";
import {
  loadGridArcadeEnabled,
  GRID_ARCADE_ENABLED_DEFAULT,
  subscribeGridArcadeEnabled,
} from "../lib/settings";
import { GettingStartedCard, GettingStartedContext } from "./GettingStarted";
import "./EmptySession.css";

// The decorative arcade (canvas games and sprites) loads after the first paint.
const TerminalGridBackground = retryableLazy(() =>
  import("./TerminalGridBackground").then(
    (module) => module.TerminalGridBackground,
  ),
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
  const arcadeEnabled = useSyncExternalStore(
    subscribeGridArcadeEnabled,
    loadGridArcadeEnabled,
    () => GRID_ARCADE_ENABLED_DEFAULT,
  );
  const gettingStarted = useContext(GettingStartedContext);
  const project =
    !isProjectlessCwd(cwd) && looksLikeProject(cwd) ? basename(cwd) : null;
  return (
    <div
      className="aven-opening empty-session"
      data-composer-docked={!composer || undefined}
    >
      {arcadeEnabled && !hasChatBackground ? (
        <SurfaceBoundary label="arcade background" quiet>
          <Suspense fallback={null}>
            <TerminalGridBackground visible={visible} />
          </Suspense>
        </SurfaceBoundary>
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
        {composer && gettingStarted ? (
          <div className="empty-session-getting-started">
            <GettingStartedCard
              card={gettingStarted.card}
              onStart={gettingStarted.onStart}
              onHide={gettingStarted.onHide}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

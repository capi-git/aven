import { useBundledChangelog } from "../hooks/useBundledChangelog";
import {
  releaseNotesMarkdown,
  type ReleaseNotesTabSource,
} from "../lib/releaseNotes";
import { AgentMarkdown } from "./AgentMarkdown";

export function ReleaseNotesSurface({
  source,
}: {
  source: ReleaseNotesTabSource;
}) {
  const changelog = useBundledChangelog();
  const markdown =
    changelog === null ? null : releaseNotesMarkdown(source, changelog);

  return (
    <div className="h-full overflow-y-auto overscroll-none">
      <article
        aria-label="Release notes"
        className="mx-auto w-full max-w-3xl px-8 py-10"
      >
        {changelog === null ? null : markdown ? (
          <AgentMarkdown text={markdown} streaming={false} />
        ) : (
          <p className="text-ui-body text-content/60">
            Release notes for this version are not available in this build.
          </p>
        )}
      </article>
    </div>
  );
}

import { lazy, Suspense, type ComponentProps } from "react";
import type { UnifiedFileDiff } from "../lib/unifiedDiff";

/**
 * The diff viewer, loaded when a diff is first shown. It brings the editor
 * library with it, so screens that only sometimes show a diff (bot fixes,
 * crew cards, a team's batch) import this instead of `UnifiedDiffView`, and
 * the editor stays out of the startup bundle.
 */
const UnifiedDiffView = lazy(() =>
  import("./UnifiedDiffView").then((module) => ({
    default: module.UnifiedDiffView,
  })),
);

export function LazyUnifiedDiffView(
  props: ComponentProps<typeof UnifiedDiffView>,
) {
  return (
    <Suspense fallback={null}>
      <UnifiedDiffView {...props} />
    </Suspense>
  );
}

/** `buildUnifiedFile`, loaded with the diff viewer rather than at startup. */
export async function loadUnifiedFileBuilder(): Promise<
  (original: string, current: string) => UnifiedFileDiff
> {
  return (await import("../lib/unifiedDiff")).buildUnifiedFile;
}

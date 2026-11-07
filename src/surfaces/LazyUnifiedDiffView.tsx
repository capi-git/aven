import { Suspense, type ComponentProps } from "react";
import { retryableLazy } from "../lib/retryableLazy";
import type { UnifiedFileDiff } from "../lib/unifiedDiff";

/**
 * The diff viewer, kept out of the startup bundle because it brings the
 * editor library with it. Screens that only sometimes show a diff (bot
 * fixes, crew cards, a team's batch) import this instead of
 * `UnifiedDiffView`. `preloadLazyViews` loads it once the window is idle,
 * so by the time one of those screens opens it renders at once, as before.
 */
export const DeferredUnifiedDiffView = retryableLazy(() =>
  import("./UnifiedDiffView").then((module) => module.UnifiedDiffView),
);

export function LazyUnifiedDiffView(
  props: ComponentProps<typeof DeferredUnifiedDiffView>,
) {
  return (
    <Suspense fallback={null}>
      <DeferredUnifiedDiffView {...props} />
    </Suspense>
  );
}

/** `buildUnifiedFile`, loaded with the diff viewer rather than at startup. */
export async function loadUnifiedFileBuilder(): Promise<
  (original: string, current: string) => UnifiedFileDiff
> {
  return (await import("../lib/unifiedDiff")).buildUnifiedFile;
}

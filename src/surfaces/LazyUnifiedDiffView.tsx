import { Suspense, type ComponentProps } from "react";
import { retryableLazy } from "../lib/retryableLazy";
import type { UnifiedFileDiff } from "../lib/unifiedDiff";

/**
 * The diff viewer, kept out of the startup bundle because it brings the
 * editor library with it. Screens that only sometimes show a diff (bot
 * fixes, crew cards, a team's batch) import this instead of
 * `UnifiedDiffView` and call `prepareDiffView` as they start reading the
 * change, so the viewer loads while Git answers and is ready when the
 * change is. Not preloaded at startup: the speed test measured that as
 * ~40 ms on the first thing people do after launch.
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

/**
 * Start loading the diff viewer and return `buildUnifiedFile`, loaded with
 * it rather than at startup. Call it before waiting on Git, not after.
 */
export function prepareDiffView(): Promise<
  (original: string, current: string) => UnifiedFileDiff
> {
  void DeferredUnifiedDiffView.preload();
  const builder = import("../lib/unifiedDiff").then(
    (module) => module.buildUnifiedFile,
  );
  // A screen may stop before it needs the builder; a failed load is then
  // reported only to the code that awaits it.
  builder.catch(() => undefined);
  return builder;
}

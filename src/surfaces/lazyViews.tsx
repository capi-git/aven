import { Suspense, type ReactNode } from "react";
import { SurfaceBoundary } from "../chrome/SurfaceBoundary";
import { retryableLazy } from "../lib/retryableLazy";

// Views the workspace shows only when asked. Loading them on demand keeps
// their code out of the workspace's startup; `preloadLazyViews` loads the
// common ones once the window is idle, so opening one later has no delay.

export const SearchView = retryableLazy(() =>
  import("./SearchView").then((module) => module.SearchView),
);
export const SettingsView = retryableLazy(() =>
  import("./SettingsView").then((module) => module.SettingsView),
);
export const InboxView = retryableLazy(() =>
  import("./InboxView").then((module) => module.InboxView),
);
export const AutomationsView = retryableLazy(() =>
  import("./AutomationsView").then((module) => module.AutomationsView),
);
export const NotesView = retryableLazy(() =>
  import("./NotesView").then((module) => module.NotesView),
);
export const CommandPalette = retryableLazy(() =>
  import("../chrome/CommandPalette").then((module) => module.CommandPalette),
);
/** A project's board, opened as a tab; `WorkBoardFrame` stands in while it loads. */
export const WorkBoard = retryableLazy(() =>
  import("./WorkBoard").then((module) => module.WorkBoard),
);
// Shown at most once per launch, at startup or from Settings, so these load
// when they open instead of with the others.
export const WhatsNewDialog = retryableLazy(() =>
  import("../chrome/WhatsNewDialog").then((module) => module.WhatsNewDialog),
);
export const ProviderSetupDialog = retryableLazy(() =>
  import("./ProviderSetup").then((module) => module.ProviderSetupDialog),
);

const PRELOADED = [
  SearchView,
  SettingsView,
  InboxView,
  AutomationsView,
  NotesView,
  CommandPalette,
  WorkBoard,
];

/** Load the views people open from the sidebar, menus and shortcuts. */
export function preloadLazyViews(): Promise<void> {
  return Promise.all(PRELOADED.map((view) => view.preload())).then(
    () => undefined,
  );
}

/**
 * Where a lazy view renders: nothing while it loads, and a failure to load
 * stays in its slot. A full-screen view shows the failure with Retry; an
 * overlay (`quiet`) shows nothing and loads again the next time it opens.
 */
export function LazyViewSlot({
  label,
  quiet,
  children,
}: {
  label: string;
  quiet?: boolean;
  children: ReactNode;
}) {
  return (
    <SurfaceBoundary label={label} quiet={quiet} className="min-h-0 flex-1">
      <Suspense fallback={null}>{children}</Suspense>
    </SurfaceBoundary>
  );
}

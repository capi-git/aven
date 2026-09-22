import { ArrowDownCircle, Loader } from "./icons";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import {
  installPendingUpdate,
  runUpdateFlow,
  subscribeUpdater,
  getUpdaterSnapshot,
  startAutomaticUpdates,
  type UpdaterSnapshot,
} from "../lib/updater";
import type { InstalledUpdate } from "../lib/updateNotice";
import { UpdateRailCard } from "./UpdateRailCard";

// The sidebar row only earns its space when there is something to act on: an
// update waiting to be installed, or one already downloading. Every other phase
// — including a failed availability probe — stays silent. A failed download
// stays visible so the user can retry it.
export function isSidebarUpdateActionable(snapshot: UpdaterSnapshot): boolean {
  return (
    ["available", "downloading", "ready", "installing"].includes(
      snapshot.phase,
    ) ||
    (snapshot.phase === "error" && !!snapshot.availableVersion)
  );
}

export function SidebarUpdateFooter({
  update,
  onOpenWhatsNew,
  onDismissUpdate,
}: {
  update?: InstalledUpdate | null;
  onOpenWhatsNew?: (version: string) => void;
  onDismissUpdate?: () => void;
}) {
  const snapshot = useSyncExternalStore(
    subscribeUpdater,
    getUpdaterSnapshot,
    getUpdaterSnapshot,
  );
  useEffect(() => startAutomaticUpdates(), []);

  const card =
    update && onOpenWhatsNew && onDismissUpdate ? (
      <UpdateRailCard
        update={update}
        onOpen={onOpenWhatsNew}
        onDismiss={onDismissUpdate}
      />
    ) : null;
  const actionable = isSidebarUpdateActionable(snapshot);

  if (!card && !actionable) return null;

  // The gap down to the Settings block belongs to that block's own padding, so
  // the footer can disappear without leaving the sidebar's bottom row flush
  // against the scrolling list above it.
  return (
    <div className="flex flex-col gap-1.5 p-2 pb-0">
      {card}
      {actionable ? <SidebarUpdate snapshot={snapshot} /> : null}
    </div>
  );
}

export function SidebarUpdate({
  snapshot,
  onSnapshot,
}: {
  snapshot: UpdaterSnapshot;
  onSnapshot?: (next: UpdaterSnapshot) => void;
}) {
  const busy =
    snapshot.phase === "downloading" || snapshot.phase === "installing";
  // `busy` only flips after installPendingUpdate awaits readAppVersion, so a
  // second click can still land. The ref closes that window immediately.
  const installing = useRef(false);

  const onClick = useCallback(async () => {
    if (busy || installing.current) return;
    installing.current = true;
    try {
      if (snapshot.phase === "ready") await installPendingUpdate(onSnapshot);
      else await runUpdateFlow(false, onSnapshot);
    } finally {
      installing.current = false;
    }
  }, [busy, onSnapshot, snapshot.phase]);

  const label =
    snapshot.phase === "downloading"
      ? `Downloading${snapshot.progress != null ? ` ${snapshot.progress}%` : "…"}`
      : snapshot.phase === "installing"
        ? "Restarting to update…"
        : snapshot.phase === "ready"
          ? `Restart for ${snapshot.availableVersion}`
          : snapshot.phase === "error"
            ? "Retry update download"
            : `Download ${snapshot.availableVersion}`;

  return (
    <button
      type="button"
      title={
        snapshot.error ??
        (snapshot.phase === "ready"
          ? "Update downloaded. Restart when your tasks are finished."
          : undefined)
      }
      onClick={onClick}
      disabled={busy}
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors ${
        busy
          ? "bg-content/5 text-content/75 hover:bg-content/10 hover:text-content"
          : "bg-accent/15 text-content hover:bg-accent/20"
      } disabled:cursor-default disabled:opacity-70`}
    >
      <span className="grid size-[18px] shrink-0 place-items-center">
        {busy ? (
          <Loader className="size-4 animate-spin opacity-70" aria-hidden />
        ) : (
          <ArrowDownCircle className="size-4 text-accent" aria-hidden />
        )}
      </span>
      <span className="min-w-0 flex-1 flex items-center">
        <span className="block truncate text-[12px] font-medium leading-tight">
          {label}
        </span>
        <span className="ml-auto block text-[11px] text-content/40">
          v{snapshot.currentVersion}
        </span>
      </span>
    </button>
  );
}

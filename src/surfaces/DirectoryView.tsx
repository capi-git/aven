import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowUp,
  ChevronRight,
  File,
  Folder,
  RefreshCw,
} from "../chrome/icons";
import { basename, listDir, type FsEntry } from "../lib/fs";
import "./DirectoryView.css";

type Location = { path: string; name: string };
type Listing =
  | { status: "loading" }
  | { status: "ready"; entries: FsEntry[] }
  | { status: "error"; message: string };

/** Browse a linked folder without changing the task's project or working directory. */
export function DirectoryView({
  path,
  onOpenFile,
}: {
  path: string;
  onOpenFile?: (path: string) => void;
}) {
  const [trail, setTrail] = useState<Location[]>([
    { path, name: basename(path) },
  ]);
  const [listing, setListing] = useState<Listing>({ status: "loading" });
  const [refresh, setRefresh] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const rows = useRef<HTMLUListElement>(null);
  const focusAfterNavigation = useRef(false);
  const current = trail[trail.length - 1];

  useEffect(() => {
    setTrail([{ path, name: basename(path) }]);
  }, [path]);

  useEffect(() => {
    let cancelled = false;
    setListing({ status: "loading" });
    void listDir(current.path).then(
      (entries) => {
        if (cancelled) return;
        setListing({
          status: "ready",
          entries: [...entries].sort(
            (a, b) =>
              Number(b.isDir) - Number(a.isDir) ||
              a.name.localeCompare(b.name, undefined, {
                numeric: true,
                sensitivity: "base",
              }),
          ),
        });
      },
      (error: unknown) => {
        if (cancelled) return;
        setListing({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [current.path, refresh]);

  useEffect(() => {
    if (listing.status === "loading" || !focusAfterNavigation.current) return;
    focusAfterNavigation.current = false;
    const first = rows.current?.querySelector<HTMLButtonElement>(
      "button:not(:disabled)",
    );
    (first ?? heading.current)?.focus();
  }, [listing]);

  const navigate = (next: Location[]) => {
    focusAfterNavigation.current = true;
    setTrail(next);
  };

  const moveFocus = (event: KeyboardEvent<HTMLUListElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ),
    ];
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : Math.max(
              0,
              Math.min(
                buttons.length - 1,
                index + (event.key === "ArrowDown" ? 1 : -1),
              ),
            );
    event.preventDefault();
    buttons[next].focus();
  };

  return (
    <section className="directory-view" aria-label={`Folder ${current.name}`}>
      <header className="directory-view-header">
        <div className="directory-view-toolbar">
          <button
            className="directory-view-control"
            type="button"
            aria-label="Go up one folder"
            title="Go up one folder"
            disabled={trail.length === 1}
            onClick={() => navigate(trail.slice(0, -1))}
          >
            <ArrowUp size={15} aria-hidden />
          </button>
          <nav className="directory-view-breadcrumbs" aria-label="Folder path">
            <ol>
              {trail.map((location, index) => (
                <li key={`${index}:${location.path}`}>
                  {index > 0 && <ChevronRight size={12} aria-hidden />}
                  <button
                    type="button"
                    title={location.path}
                    aria-current={
                      index === trail.length - 1 ? "location" : undefined
                    }
                    onClick={() => navigate(trail.slice(0, index + 1))}
                  >
                    {location.name}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          <button
            className="directory-view-control"
            type="button"
            aria-label="Refresh folder"
            title="Refresh folder"
            onClick={() => setRefresh((value) => value + 1)}
          >
            <RefreshCw size={15} aria-hidden />
          </button>
        </div>
        <h2 ref={heading} tabIndex={-1}>
          <Folder size={18} aria-hidden />
          {current.name}
        </h2>
        <p className="directory-view-path">{current.path}</p>
      </header>
      <div
        className="directory-view-content"
        aria-busy={listing.status === "loading"}
      >
        {listing.status === "loading" ? (
          <p className="directory-view-message" role="status">
            Loading folder…
          </p>
        ) : listing.status === "error" ? (
          <div className="directory-view-message">
            <p role="alert">Couldn’t read this folder. {listing.message}</p>
            <button
              className="directory-view-control"
              type="button"
              onClick={() => setRefresh((value) => value + 1)}
            >
              Try again
            </button>
          </div>
        ) : listing.entries.length === 0 ? (
          <p className="directory-view-message" role="status">
            This folder is empty.
          </p>
        ) : (
          <ul
            ref={rows}
            className="directory-view-list"
            aria-label="Folder contents"
            onKeyDown={moveFocus}
          >
            {listing.entries.map((entry) => (
              <li key={entry.path}>
                <button
                  className="directory-view-entry"
                  type="button"
                  aria-label={`Open ${entry.isDir ? "folder" : "file"} ${entry.name}`}
                  title={entry.path}
                  disabled={!entry.isDir && !onOpenFile}
                  onClick={() =>
                    entry.isDir
                      ? navigate([
                          ...trail,
                          { path: entry.path, name: entry.name },
                        ])
                      : onOpenFile?.(entry.path)
                  }
                >
                  {entry.isDir ? (
                    <Folder size={16} aria-hidden />
                  ) : (
                    <File size={16} aria-hidden />
                  )}
                  <span className="directory-view-entry-name">
                    {entry.name}
                  </span>
                  <span className="directory-view-entry-kind">
                    {entry.isDir ? "Folder" : "File"}
                  </span>
                  {entry.isDir && <ChevronRight size={13} aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <footer className="directory-view-footer">
        {listing.status === "ready"
          ? `${listing.entries.length} ${listing.entries.length === 1 ? "item" : "items"}`
          : "Folder"}
      </footer>
    </section>
  );
}

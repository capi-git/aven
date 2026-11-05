import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { BrowserTabIcon } from "./BrowserTabIcon";
import { Pencil, X } from "./icons";
import { readableHost } from "../lib/browser";
import {
  removeBookmark,
  renameBookmark,
  type BrowserBookmark,
} from "../lib/browserBookmarks";
import "./BrowserBookmarks.css";

function BookmarkRename({
  name,
  onCommit,
  onCancel,
}: {
  name: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const [value, setValue] = useState(name);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const finish = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    if (commit) onCommit(value);
    else onCancel();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    }
  };
  return (
    <input
      ref={input}
      className="browser-bookmark-rename aven-field"
      aria-label="Bookmark name"
      value={value}
      spellCheck={false}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={onKeyDown}
    />
  );
}

/** What a blank browser tab shows once its project has bookmarks. */
export function BrowserBookmarks({
  project,
  bookmarks,
  onOpen,
}: {
  project: string;
  bookmarks: readonly BrowserBookmark[];
  onOpen: (url: string) => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  return (
    <section className="browser-bookmarks" aria-label="Bookmarks">
      <div className="browser-bookmarks-column">
        <h2 className="browser-bookmarks-heading">Bookmarks</h2>
        <ul className="browser-bookmarks-card">
          {bookmarks.map((bookmark) => {
            const host = readableHost(bookmark.url);
            return (
              <li key={bookmark.url} className="browser-bookmark">
                {renaming === bookmark.url ? (
                  <div className="browser-bookmark-face">
                    <BrowserTabIcon favicon={bookmark.favicon} />
                    <BookmarkRename
                      name={bookmark.name}
                      onCommit={(name) => {
                        renameBookmark(project, bookmark.url, name);
                        setRenaming(null);
                      }}
                      onCancel={() => setRenaming(null)}
                    />
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="browser-bookmark-face"
                      title={bookmark.url}
                      onClick={() => onOpen(bookmark.url)}
                    >
                      <BrowserTabIcon favicon={bookmark.favicon} />
                      <span className="browser-bookmark-text">
                        <span className="browser-bookmark-name">
                          {bookmark.name}
                        </span>
                        {host !== bookmark.name ? (
                          <span className="browser-bookmark-host">{host}</span>
                        ) : null}
                      </span>
                    </button>
                    <span className="browser-bookmark-tools">
                      <button
                        type="button"
                        aria-label={`Rename ${bookmark.name}`}
                        title="Rename"
                        onClick={() => setRenaming(bookmark.url)}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${bookmark.name}`}
                        title="Remove"
                        onClick={() => removeBookmark(project, bookmark.url)}
                      >
                        <X size={13} />
                      </button>
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

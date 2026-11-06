import { browserFavicon } from "./browserIcons";
import { projectKey } from "./paths";

/**
 * Pages bookmarked in a project, newest first, listed on its blank browser
 * tabs. Each project has its own key: two windows bookmarking in different
 * projects never write over each other, and deleting a project takes only
 * its own. What's stored is read on every call, so another window's change
 * is never missed; only an unchanged value reuses its list.
 */
export type BrowserBookmark = {
  url: string;
  name: string;
  favicon?: string;
};

const PREFIX = "aven.bookmarks.";
const NAME_LIMIT = 200;
const NONE: readonly BrowserBookmark[] = [];

const listeners = new Set<() => void>();
const parsed = new Map<
  string,
  { raw: string | null; bookmarks: readonly BrowserBookmark[] }
>();

function storageKey(project: string): string {
  return `${PREFIX}${projectKey(project)}`;
}

function validBookmark(value: unknown): BrowserBookmark | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { url, name, favicon } = value as Partial<BrowserBookmark>;
  if (typeof url !== "string" || !url.trim() || typeof name !== "string")
    return null;
  const shown = name.trim().slice(0, NAME_LIMIT);
  if (!shown) return null;
  const icon = browserFavicon(favicon);
  return { url, name: shown, ...(icon ? { favicon: icon } : {}) };
}

function parse(raw: string | null): readonly BrowserBookmark[] {
  if (!raw) return NONE;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return NONE;
    const urls = new Set<string>();
    const bookmarks = value.flatMap((item) => {
      const bookmark = validBookmark(item);
      if (!bookmark || urls.has(bookmark.url)) return [];
      urls.add(bookmark.url);
      return [bookmark];
    });
    return bookmarks.length ? bookmarks : NONE;
  } catch {
    return NONE;
  }
}

export function loadBookmarks(project: string): readonly BrowserBookmark[] {
  const key = storageKey(project);
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return NONE;
  }
  const known = parsed.get(key);
  if (known?.raw === raw) return known.bookmarks;
  const bookmarks = parse(raw);
  parsed.set(key, { raw, bookmarks });
  return bookmarks;
}

/** False when storage refused it: nothing changed, here or after a restart. */
function write(
  project: string,
  bookmarks: readonly BrowserBookmark[],
): boolean {
  try {
    if (bookmarks.length)
      localStorage.setItem(storageKey(project), JSON.stringify(bookmarks));
    else localStorage.removeItem(storageKey(project));
  } catch {
    return false;
  }
  listeners.forEach((listener) => listener());
  return true;
}

/** Puts a page first. A page already bookmarked keeps its name and place. */
export function addBookmark(
  project: string,
  bookmark: BrowserBookmark,
): boolean {
  const added = validBookmark(bookmark);
  if (!added) return false;
  const current = loadBookmarks(project);
  if (current.some((item) => item.url === added.url)) return true;
  return write(project, [added, ...current]);
}

export function removeBookmark(project: string, url: string): boolean {
  const current = loadBookmarks(project);
  const next = current.filter((item) => item.url !== url);
  return next.length === current.length ? true : write(project, next);
}

/** An empty name leaves the bookmark as it was. */
export function renameBookmark(
  project: string,
  url: string,
  name: string,
): boolean {
  const shown = name.trim().slice(0, NAME_LIMIT);
  const current = loadBookmarks(project);
  if (
    !shown ||
    !current.some((item) => item.url === url && item.name !== shown)
  )
    return true;
  return write(
    project,
    current.map((item) => (item.url === url ? { ...item, name: shown } : item)),
  );
}

/** Deleting a project takes its bookmarks; archiving one keeps them. */
export function clearBookmarks(project: string): void {
  write(project, NONE);
}

export function subscribeBookmarks(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(PREFIX)) listener();
  };
  listeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

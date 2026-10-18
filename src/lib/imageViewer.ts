import { attachmentPreviewSrc } from "./attachments";
import { isImagePath, isSvgPath } from "./filePreview";
import {
  basename,
  listDir,
  type FsEntry,
  type GitChangedFile,
  type GitFileDiffKind,
} from "./fs";
import { parentPath, pathKey } from "./paths";
import type { EditorNavigation, OpenFileOptions } from "./search";
import type { Attachment } from "./session";

/** One picture the viewer can show. */
export type ImageViewerItem = {
  /** The name in the viewer's top bar. */
  name: string;
  /**
   * A file on disk. The viewer reads it through the bounded binary reader,
   * and it is what Open in tab, Reveal and Copy path act on.
   */
  path?: string;
  /**
   * An image the page can already draw, such as inline data, an attachment's
   * preview or a note's asset URL. Shown instead of reading `path`.
   */
  src?: string;
  /** Size in bytes, when it is known without reading the file. */
  size?: number;
  /** A short caption, such as "Before", listed under the image. */
  label?: string;
};

export type ImageViewerRequest = {
  items: readonly ImageViewerItem[];
  index?: number;
};

export type ImageViewerState = {
  items: readonly ImageViewerItem[];
  index: number;
  /** Changes with every new request, so late folder listings can tell they are stale. */
  request: number;
};

/** Enough to step through a busy folder without reading thousands of names. */
export const MAX_FOLDER_IMAGES = 200;
/** Above this many images the count stops listing their captions. */
const MAX_LISTED_LABELS = 6;

let state: ImageViewerState | null = null;
let requests = 0;
let hosts = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of [...listeners]) listener();
}

export function subscribeImageViewer(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function imageViewerSnapshot(): ImageViewerState | null {
  return state;
}

/**
 * A window mounts one viewer. Until it has, image clicks keep their old
 * route, so a window without a viewer never swallows them.
 */
export function registerImageViewerHost(): () => void {
  hosts += 1;
  if (hosts === 1) emit();
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    hosts -= 1;
    if (hosts === 0) {
      state = null;
      emit();
    }
  };
}

export function imageViewerAvailable(): boolean {
  return hosts > 0;
}

/** Show `items`, starting at `index`. Returns false when no viewer is mounted. */
export function openImageViewer(request: ImageViewerRequest): boolean {
  if (!imageViewerAvailable()) return false;
  const items = request.items.filter((item) => item.path || item.src);
  if (!items.length) return false;
  requests += 1;
  state = {
    items,
    index: clampIndex(request.index ?? 0, items.length),
    request: requests,
  };
  emit();
  return true;
}

export function closeImageViewer() {
  if (!state) return;
  state = null;
  emit();
}

/** Step to the next or previous image, wrapping at either end. */
export function stepImageViewer(delta: number) {
  if (!state || state.items.length < 2) return;
  const count = state.items.length;
  state = {
    ...state,
    index: (((state.index + delta) % count) + count) % count,
  };
  emit();
}

function clampIndex(index: number, count: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.min(count - 1, Math.max(0, Math.trunc(index)));
}

/** Whether the viewer, rather than an editor, shows this path. */
export function opensInImageViewer(path: string): boolean {
  return isImagePath(path) || isSvgPath(path);
}

/**
 * Route one of the user's own file opens. Pictures show in the viewer, SVG
 * too unless a line was asked for (that is a request for its source). Open
 * in tab, and any window without a viewer, keep the editor tab.
 */
export function shouldOpenInImageViewer(
  path: string,
  navigation?: EditorNavigation,
  options?: OpenFileOptions,
): boolean {
  if (options?.asTab || !imageViewerAvailable()) return false;
  if (isImagePath(path)) return true;
  return isSvgPath(path) && !navigation;
}

/**
 * The pictures beside `path` in its folder, in the listing's order (the file
 * tree's), at most `cap` of them around the one asked for.
 */
export function folderImageGroup(
  path: string,
  entries: readonly FsEntry[],
  cap = MAX_FOLDER_IMAGES,
): { items: ImageViewerItem[]; index: number } {
  const own = { name: basename(path), path };
  const key = pathKey(path);
  const images = entries.filter(
    (entry) => !entry.isDir && opensInImageViewer(entry.name),
  );
  const index = images.findIndex((entry) => pathKey(entry.path) === key);
  if (index < 0) return { items: [own], index: 0 };
  const limit = Math.max(1, cap);
  const start = Math.max(
    0,
    Math.min(index - Math.floor(limit / 2), images.length - limit),
  );
  return {
    items: images
      .slice(start, start + limit)
      .map((entry) => ({ name: entry.name, path: entry.path })),
    index: index - start,
  };
}

/**
 * Open one image file at once, then let ←/→ reach the other pictures in its
 * folder once the folder has been listed. A failed listing leaves the one.
 */
export function openImageFile(
  path: string,
  list: (folder: string) => Promise<FsEntry[]> = listDir,
): boolean {
  if (!openImageViewer({ items: [{ name: basename(path), path }] })) {
    return false;
  }
  const request = state?.request;
  void list(parentPath(path)).then(
    (entries) => {
      if (!state || state.request !== request || state.items.length !== 1)
        return;
      const group = folderImageGroup(path, entries);
      if (group.items.length < 2) return;
      state = { ...state, items: group.items, index: group.index };
      emit();
    },
    () => {},
  );
  return true;
}

/**
 * A changed picture in the Changes panel: the viewer shows it with the other
 * pictures changed in the same section. SVG keeps its text diff.
 */
export function changedImageGroup(
  files: readonly GitChangedFile[],
  path: string,
  kind: GitFileDiffKind,
): { items: ImageViewerItem[]; index: number } | null {
  if (!isImagePath(path)) return null;
  const key = pathKey(path);
  const images = files.filter(
    (file) =>
      (kind === "staged" ? file.staged : file.unstaged) &&
      file.status !== "deleted" &&
      isImagePath(file.path),
  );
  const index = images.findIndex((file) => pathKey(file.path) === key);
  if (index < 0) return { items: [{ name: basename(path), path }], index: 0 };
  return {
    items: images.map((file) => ({
      name: basename(file.path),
      path: file.path,
    })),
    index,
  };
}

/** An image attachment as the viewer shows it, or null for other files. */
export function attachmentViewerItem(
  attachment: Attachment,
): ImageViewerItem | null {
  if (attachment.kind !== "image") return null;
  const src = attachmentPreviewSrc(attachment);
  if (!attachment.path && !src) return null;
  return {
    name: attachment.name,
    ...(attachment.path ? { path: attachment.path } : {}),
    // An inline copy shows at once; a saved file is read from disk.
    ...(src ? { src } : {}),
    size: attachment.size,
  };
}

/** The pictures among a message's attachments, starting at `attachment`'s. */
export function attachmentImageGroup(
  attachment: Attachment,
  group: readonly Attachment[] = [attachment],
): { items: ImageViewerItem[]; index: number } | null {
  const members = group.includes(attachment) ? group : [attachment];
  const items: ImageViewerItem[] = [];
  let index = -1;
  for (const member of members) {
    const item = attachmentViewerItem(member);
    if (!item) continue;
    if (member === attachment) index = items.length;
    items.push(item);
  }
  return index < 0 ? null : { items, index };
}

/** "2 of 2 · Before, After": where you are, and the captions when they are short. */
export function imageGroupSummary(
  items: readonly ImageViewerItem[],
  index: number,
): string {
  if (items.length < 2) return "";
  const position = `${index + 1} of ${items.length}`;
  const labels = items.map((item) => item.label?.trim());
  if (
    items.length > MAX_LISTED_LABELS ||
    labels.some((label) => !label || label.length > 24)
  )
    return position;
  return `${position} · ${labels.join(", ")}`;
}

/** The decoded size of a base64 `data:` URL, worked out without decoding it. */
export function dataUrlBytes(src: string): number | undefined {
  const match = /^data:[^,]*;base64,/i.exec(src);
  if (!match) return undefined;
  const body = src.slice(match[0].length).replace(/\s/g, "");
  const padding = body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((body.length * 3) / 4) - padding);
}

/**
 * Pictures in rendered Markdown that the viewer can open: a local image file
 * (`data-local-image` holds its path) or an inline one (`data-viewer-image`,
 * drawn by the `img` inside it).
 */
const VIEWER_IMAGES = "[data-local-image], [data-viewer-image]";
/** Pictures inside one of these step together; a chat reply is one. */
const IMAGE_GROUP_SELECTOR = "[data-image-group], .agent-markdown";

function itemFromElement(element: Element): ImageViewerItem | null {
  const path = element.getAttribute("data-local-image") || undefined;
  const image =
    element instanceof HTMLImageElement
      ? element
      : element.querySelector("img");
  const src = path ? undefined : image?.getAttribute("src") || undefined;
  if (!path && !src) return null;
  const caption = element
    .closest("figure")
    ?.querySelector("figcaption")
    ?.textContent?.trim();
  const name = element.getAttribute("data-viewer-name")?.trim();
  return {
    name: path ? basename(path) : name || "Image",
    ...(path ? { path } : { src }),
    ...(caption ? { label: caption } : {}),
  };
}

/**
 * The pictures that belong with the one clicked, read from the page in the
 * order they appear: a Before/After pair, or every image in one reply.
 */
export function collectImageGroup(target: Element): {
  items: ImageViewerItem[];
  index: number;
} {
  const own = target.closest(VIEWER_IMAGES) ?? target;
  const root = own.closest(IMAGE_GROUP_SELECTOR);
  const elements = root ? [...root.querySelectorAll(VIEWER_IMAGES)] : [own];
  if (!elements.includes(own)) elements.unshift(own);
  const items: ImageViewerItem[] = [];
  let index = 0;
  for (const element of elements) {
    const item = itemFromElement(element);
    if (!item) continue;
    if (element === own) index = items.length;
    items.push(item);
  }
  return { items, index };
}

/** Open the clicked picture with the others in its group. */
export function openImageGroupAt(target: Element): boolean {
  return openImageViewer(collectImageGroup(target));
}

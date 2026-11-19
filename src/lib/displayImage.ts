import { invoke } from "@tauri-apps/api/core";
import { readBinaryFile } from "./fs";

/**
 * Chat pictures draw a smaller display copy; the image viewer, Open and copy
 * actions keep the full original. Twice the 800 px chat column keeps copies
 * sharp on Retina screens.
 */
export const CHAT_IMAGE_WIDTH = 1600;
/**
 * Attachment chips are 36 px squares cropped from the picture; this covers
 * 2× with room for a wide picture to crop to its middle.
 */
export const ATTACHMENT_THUMB_WIDTH = 256;
/** Inline pictures smaller than this are drawn as they are. */
export const INLINE_COPY_MIN_BYTES = 256 * 1024;
const INLINE_COPY_LIMIT = 24;

/**
 * The bytes a chat should draw for a picture on disk: a cached copy no wider
 * than `maxWidth`, made natively, or the original when the picture is small,
 * cannot be scaled, or anything goes wrong.
 */
export async function readDisplayImage(
  path: string,
  maxWidth = CHAT_IMAGE_WIDTH,
): Promise<Uint8Array> {
  try {
    const buffer = await invoke<ArrayBuffer>("read_display_image", {
      path,
      maxWidth,
    });
    const bytes = new Uint8Array(buffer);
    if (bytes.length) return bytes;
  } catch {
    // Older native builds and other failures draw the original.
  }
  return readBinaryFile(path);
}

/** Copies of inline pictures, most recently used last. */
const inlineCopies = new Map<string, Promise<string | undefined>>();

/**
 * A smaller copy of an inline picture (a `data:` or `blob:` URL) for drawing
 * in a chat, made once per `key` and width. Resolves to undefined, meaning
 * draw `src` itself, when the picture is already narrow enough or cannot be
 * scaled here.
 */
export function inlineDisplayCopy(
  key: string,
  src: string,
  maxWidth = CHAT_IMAGE_WIDTH,
): Promise<string | undefined> {
  const id = `${maxWidth}:${key}`;
  const known = inlineCopies.get(id);
  if (known) {
    inlineCopies.delete(id);
    inlineCopies.set(id, known);
    return known;
  }
  const made = scaleInlineImage(src, maxWidth).catch(() => undefined);
  inlineCopies.set(id, made);
  while (inlineCopies.size > INLINE_COPY_LIMIT) {
    const [oldest, copy] = inlineCopies.entries().next().value!;
    inlineCopies.delete(oldest);
    void copy.then((url) => {
      if (url) URL.revokeObjectURL(url);
    });
  }
  return made;
}

/** Forget every inline copy. For tests. */
export function clearInlineDisplayCopies() {
  for (const copy of inlineCopies.values())
    void copy.then((url) => {
      if (url) URL.revokeObjectURL(url);
    });
  inlineCopies.clear();
}

/** A stable cache key for a `data:` URL without hashing all of it. */
export function inlineImageKey(src: string): string {
  const head = src.slice(0, 96);
  const tail = src.slice(-96);
  let hash = 0;
  const step = Math.max(1, Math.floor(src.length / 4096));
  for (let index = 0; index < src.length; index += step)
    hash = (Math.imul(hash, 31) + src.charCodeAt(index)) | 0;
  return `${src.length}:${hash}:${head}:${tail}`;
}

async function scaleInlineImage(
  src: string,
  maxWidth: number,
): Promise<string | undefined> {
  if (typeof document === "undefined" || typeof Image === "undefined")
    return undefined;
  const image = new Image();
  image.decoding = "async";
  image.src = src;
  await image.decode();
  const { naturalWidth: width, naturalHeight: height } = image;
  if (!width || !height || width <= maxWidth) return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = maxWidth;
  canvas.height = Math.max(1, Math.round((height * maxWidth) / width));
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  // Photos stay JPEG; screenshots stay PNG so text keeps sharp edges.
  const type = /^data:image\/jpe?g[;,]/i.test(src) ? "image/jpeg" : "image/png";
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, 0.9),
  );
  canvas.width = canvas.height = 0;
  return blob ? URL.createObjectURL(blob) : undefined;
}

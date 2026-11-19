/**
 * The natural size of pictures already shown, by file path or note asset, so
 * a picture drawn again (its reply re-rendered, its pane moved, earlier turns
 * loaded) reserves its box before the file loads, and the text below it does
 * not jump when it arrives. Sizes come from the loaded image itself.
 */
export type PictureSize = { width: number; height: number };

/** Enough for the pictures of many long chats; the oldest go first. */
const LIMIT = 500;
const sizes = new Map<string, PictureSize>();

export function pictureSize(key: string): PictureSize | undefined {
  return sizes.get(key);
}

/** Remember `image`'s natural size under `key`; returns it, if it has one. */
export function rememberPictureSize(
  key: string,
  image: HTMLImageElement,
): PictureSize | undefined {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (!(width > 0 && height > 0)) return undefined;
  const known = sizes.get(key);
  if (known && known.width === width && known.height === height) return known;
  const size = { width, height };
  sizes.delete(key);
  sizes.set(key, size);
  if (sizes.size > LIMIT) sizes.delete(sizes.keys().next().value!);
  return size;
}

/** For tests. */
export function forgetPictureSizes() {
  sizes.clear();
}

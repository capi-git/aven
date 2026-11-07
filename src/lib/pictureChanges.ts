import type { PagePicture, PictureBox } from "./pagePictures";

/**
 * Where a page looks different between its before and after pictures, for
 * numbering on Avos's Review when its Builder named no spots: the pictures
 * are compared cell by cell, and touching changed cells become one box.
 */

/** Boxes numbered at most: the largest, then read top to bottom. */
export const CHANGES_MAX = 6;
/** A change covering more than this much of the page isn't a spot. */
const WHOLE_PAGE = 0.6;
/** How different a pixel must be (summed over red, green and blue). */
const PIXEL_DIFFERENT = 48;

/**
 * Changed boxes between two same-sized RGBA pictures, as fractions of
 * them, a few at most; none when they don't match in size or the whole
 * page changed (a new theme, say).
 */
export function changedBoxes(
  before: ArrayLike<number>,
  after: ArrayLike<number>,
  width: number,
  height: number,
  cell = 8,
): PictureBox[] {
  if (
    width < 1 ||
    height < 1 ||
    before.length !== width * height * 4 ||
    after.length !== before.length
  )
    return [];
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const counts = new Uint16Array(cols * rows);
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const at = (y * width + x) * 4;
      const difference =
        Math.abs(before[at] - after[at]) +
        Math.abs(before[at + 1] - after[at + 1]) +
        Math.abs(before[at + 2] - after[at + 2]);
      if (difference > PIXEL_DIFFERENT)
        counts[Math.floor(y / cell) * cols + Math.floor(x / cell)]++;
    }
  }
  // A cell with a couple of different pixels is noise (anti-aliasing).
  const hot = counts.map((count) => (count >= 2 ? 1 : 0));
  const seen = new Uint8Array(cols * rows);
  let boxes: [number, number, number, number][] = [];
  for (let start = 0; start < hot.length; start++) {
    if (!hot[start] || seen[start]) continue;
    let [left, top, right, bottom] = [cols, rows, -1, -1];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const index = stack.pop()!;
      const cx = index % cols;
      const cy = Math.floor(index / cols);
      left = Math.min(left, cx);
      top = Math.min(top, cy);
      right = Math.max(right, cx);
      bottom = Math.max(bottom, cy);
      // Neighbours up to two cells away join, so a line of text is one box.
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const next = ny * cols + nx;
          if (hot[next] && !seen[next]) {
            seen[next] = 1;
            stack.push(next);
          }
        }
      }
    }
    boxes.push([left, top, right + 1, bottom + 1]);
  }
  const area = ([l, t, r, b]: (typeof boxes)[number]) => (r - l) * (b - t);
  if (boxes.some((box) => area(box) > WHOLE_PAGE * cols * rows)) return [];
  boxes = boxes.sort((a, b) => area(b) - area(a)).slice(0, CHANGES_MAX);
  boxes.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const round = (n: number) => Math.round(n * 10000) / 10000;
  return boxes.map(([l, t, r, b]) => [
    round((l * cell) / width),
    round((t * cell) / height),
    round((Math.min(r * cell, width) - l * cell) / width),
    round((Math.min(b * cell, height) - t * cell) / height),
  ]);
}

/** Compared at this width at most: plenty to find a change, and quick. */
const COMPARE_WIDTH = 400;

async function pixels(
  picture: PagePicture,
  width: number,
  height: number,
): Promise<Uint8ClampedArray> {
  const image = new Image();
  image.src = picture.src;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("No canvas");
  context.drawImage(image, 0, 0, width, height);
  return context.getImageData(0, 0, width, height).data;
}

/** Where `after` looks different from `before`; none if they can't compare. */
export async function pictureChanges(
  before: PagePicture,
  after: PagePicture,
): Promise<PictureBox[]> {
  if (before.width !== after.width || before.height !== after.height) return [];
  const scale = Math.min(1, COMPARE_WIDTH / after.width);
  const width = Math.max(1, Math.round(after.width * scale));
  const height = Math.max(1, Math.round(after.height * scale));
  const [a, b] = await Promise.all([
    pixels(before, width, height),
    pixels(after, width, height),
  ]);
  return changedBoxes(a, b, width, height);
}

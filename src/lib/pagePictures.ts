import { invoke } from "@tauri-apps/api/core";

/**
 * Pictures of a page of an app running on this Mac, at a phone's or a
 * desktop's size: Aven loads it off screen, with no saved cookies, and
 * WebKit takes the picture. For the before and after in Avos's Review.
 */

export type PictureSize = "phone" | "desktop";

/** Each size's window, in CSS pixels. */
export const PICTURE_SIZES: Readonly<
  Record<PictureSize, { width: number; height: number }>
> = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
};

/** Part of a picture, as fractions of it: left, top, width, height. */
export type PictureBox = readonly [number, number, number, number];

/** Something on the page you might click to leave Avos a note. */
export type PicturePart = {
  box: PictureBox;
  /** A few words on what it is: "button “Sign up”". */
  what: string;
  /** A selector for it. */
  element: string;
};

export type PagePicture = {
  /** A PNG, as a data URL. */
  src: string;
  width: number;
  height: number;
  /** Where each spot asked for is, in the order asked (null: not found). */
  spots?: (PictureBox | null)[];
  /** What is where, when the page said. */
  parts?: PicturePart[];
};

function pictureBox(value: unknown): PictureBox | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const [left, top, width, height] = value.map(Number);
  const fraction = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
  return [left, top, width, height].every(fraction) &&
    left + width <= 1.0001 &&
    top + height <= 1.0001
    ? [left, top, width, height]
    : null;
}

/** The page's layout reply, kept only where it has the expected shape. */
export function readLayout(
  value: unknown,
): Pick<PagePicture, "spots" | "parts"> {
  const raw = value as { spots?: unknown; parts?: unknown } | null;
  if (!raw || typeof raw !== "object") return {};
  const spots = Array.isArray(raw.spots) ? raw.spots.map(pictureBox) : [];
  const parts = Array.isArray(raw.parts)
    ? raw.parts.flatMap((part): PicturePart[] => {
        const item = part as Partial<Record<keyof PicturePart, unknown>>;
        const box = pictureBox(item?.box);
        return box &&
          typeof item.what === "string" &&
          typeof item.element === "string"
          ? [
              {
                box,
                what: item.what.slice(0, 80),
                element: item.element.slice(0, 200),
              },
            ]
          : [];
      })
    : [];
  return { spots, parts };
}

/** A part bigger than this much of the picture names nothing in particular. */
const PART_MAX_AREA = 0.5;

/**
 * The smallest part under a point of the picture (fractions), which is
 * the most particular thing you clicked; none when only something as big
 * as the page itself is there.
 */
export function partAt(
  parts: readonly PicturePart[] | undefined,
  x: number,
  y: number,
): PicturePart | undefined {
  let best: PicturePart | undefined;
  for (const part of parts ?? []) {
    const [left, top, width, height] = part.box;
    if (x < left || y < top || x > left + width || y > top + height) continue;
    if (width * height > PART_MAX_AREA) continue;
    if (!best || width * height < best.box[2] * best.box[3]) best = part;
  }
  return best;
}

/** `page` ("/pricing") on the app at `base` ("http://127.0.0.1:5174"). */
export function pageAddress(base: string, page: string): string {
  return new URL(page, base.endsWith("/") ? base : `${base}/`).href;
}

/**
 * A picture of `url` at `size`, with where `marks` (selectors) are on it
 * and what you might click.
 */
export async function takePagePicture(
  url: string,
  size: PictureSize,
  marks: readonly string[] = [],
): Promise<PagePicture> {
  const { width, height } = PICTURE_SIZES[size];
  const shot = await invoke<{
    dataUrl: string;
    width: number;
    height: number;
    layout?: unknown;
  }>("page_picture", { url, width, height, marks });
  return {
    src: shot.dataUrl,
    width: shot.width,
    height: shot.height,
    ...readLayout(shot.layout),
  };
}

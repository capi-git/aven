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

export type PagePicture = {
  /** A PNG, as a data URL. */
  src: string;
  width: number;
  height: number;
};

/** `page` ("/pricing") on the app at `base` ("http://127.0.0.1:5174"). */
export function pageAddress(base: string, page: string): string {
  return new URL(page, base.endsWith("/") ? base : `${base}/`).href;
}

export async function takePagePicture(
  url: string,
  size: PictureSize,
): Promise<PagePicture> {
  const { width, height } = PICTURE_SIZES[size];
  const shot = await invoke<{
    dataUrl: string;
    width: number;
    height: number;
  }>("page_picture", { url, width, height });
  return { src: shot.dataUrl, width: shot.width, height: shot.height };
}

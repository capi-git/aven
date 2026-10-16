/** Only small, decoded native favicon thumbnails may enter the app chrome. */
export function browserFavicon(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length <= 32768 &&
    /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
    ? value
    : undefined;
}

/** Aven's mark on its tile, drawn with whole-pixel cells at the 14 px tab icon size. */
export const BROWSER_FALLBACK_ICON = "/aven-mark.svg";

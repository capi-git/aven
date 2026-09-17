/** Only small, decoded native favicon thumbnails may enter the app chrome. */
export function browserFavicon(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length <= 32768 &&
    /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
    ? value
    : undefined;
}

export const BROWSER_FALLBACK_ICON = "/aven.png";

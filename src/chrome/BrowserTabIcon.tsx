import { BROWSER_FALLBACK_ICON, browserFavicon } from "../lib/browserIcons";

export function BrowserTabIcon({ favicon }: { favicon?: string }) {
  const src = browserFavicon(favicon) ?? BROWSER_FALLBACK_ICON;
  return (
    <img
      key={src}
      src={src}
      alt=""
      aria-hidden="true"
      draggable={false}
      className="size-3.5 shrink-0 object-contain"
      onError={(event) => {
        if (event.currentTarget.getAttribute("src") !== BROWSER_FALLBACK_ICON)
          event.currentTarget.src = BROWSER_FALLBACK_ICON;
      }}
    />
  );
}

import { SETTINGS } from "./settings";

/**
 * Settings › Appearance › Typography: the chat's text size and the code
 * font, as the CSS variables the rest of Aven already reads.
 */
export function applyTypography(root: HTMLElement = document.documentElement) {
  const size = SETTINGS.chatTextSize.load();
  if (size === SETTINGS.chatTextSize.defaultValue)
    root.style.removeProperty("--text-ui-reading");
  else root.style.setProperty("--text-ui-reading", `${size}px`);
  const font = SETTINGS.codeFont.load();
  if (!font) root.style.removeProperty("--font-mono");
  else
    root.style.setProperty(
      "--font-mono",
      `"${font}", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`,
    );
}

export function initTypography(): () => void {
  applyTypography();
  return SETTINGS.chatTextSize.subscribe(() => applyTypography());
}

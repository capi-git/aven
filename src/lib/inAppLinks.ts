import { normalizeBrowserUrl } from "./browser";
import { resolveWorkspacePath } from "./paths";
import type { EditorNavigation, OpenFileFn } from "./search";

// A fragment survives Markdown URL hardening without becoming a WebView URL.
export const LOCAL_FILE_LINK = "#covecode-file=";

export function resolveFileLink(
  href: string,
  cwd?: string,
): { path: string; navigation?: EditorNavigation } | undefined {
  let value = href.trim();
  if (value.startsWith(LOCAL_FILE_LINK)) {
    try {
      value = decodeURIComponent(value.slice(LOCAL_FILE_LINK.length));
    } catch {
      return;
    }
  }
  if (/^file:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.hostname && url.hostname !== "localhost") return;
      value = url.pathname + url.hash;
    } catch {
      return;
    }
  } else if (
    /^[a-z][a-z0-9+.-]*:/i.test(value) &&
    !/^[A-Za-z]:[\\/]/.test(value)
  ) {
    return;
  }
  if (
    !value ||
    value.startsWith("#") ||
    value.startsWith("?") ||
    value.startsWith("//")
  )
    return;
  const location = value.match(/(?::(\d+)(?::(\d+))?|#L(\d+)(?:-L\d+)?)$/);
  if (location) value = value.slice(0, location.index);
  else value = value.split("#", 1)[0];
  try {
    value = decodeURIComponent(value);
  } catch {
    return;
  }
  // Never reinterpret an encoded URL scheme as a local path.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[A-Za-z]:[\\/]/.test(value))
    return;
  const path = resolveWorkspacePath(value, cwd);
  if (!path) return;
  const line = location ? Number(location[1] ?? location[3]) : 0;
  return {
    path,
    ...(line > 0
      ? {
          navigation: {
            line,
            ...(location?.[2] ? { column: Number(location[2]) } : {}),
          },
        }
      : {}),
  };
}

type LinkHost = {
  openUrl: (url: string) => void | Promise<void>;
  openFile: OpenFileFn;
};
let host: LinkHost | undefined;

export async function openInAppUrl(value: string): Promise<void> {
  const url = normalizeBrowserUrl(value);
  if (!host)
    throw new Error("The workspace is still opening. Try the link again.");
  await host.openUrl(url);
}

export function openInAppFile(path: string, navigation?: EditorNavigation) {
  host?.openFile(path, navigation);
}

/** One event-driven router per trusted app window, never installed in web pages. */
export function installInAppLinks(
  next: LinkHost,
  report: (error: unknown) => void,
) {
  host = next;
  const click = (event: MouseEvent) => {
    if (event.defaultPrevented || (event.button !== 0 && event.button !== 1))
      return;
    const anchor = event
      .composedPath()
      .find(
        (node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement,
      );
    const href = anchor?.getAttribute("href");
    if (!href || !/^https?:\/\//i.test(href)) return;
    event.preventDefault();
    void openInAppUrl(href).catch(report);
  };
  // React handles local file links first; document runs before the native opener's window listener.
  document.addEventListener("click", click);
  document.addEventListener("auxclick", click);
  return () => {
    document.removeEventListener("click", click);
    document.removeEventListener("auxclick", click);
    if (host === next) host = undefined;
  };
}

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Attachment } from "./session";

export type BrowserBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  /** CSS viewport height after WebKit excludes any native window chrome. */
  viewportHeight?: number;
  /** Covered edge strips; the native page keeps its full viewport dimensions. */
  clipLeft?: number;
  clipRight?: number;
};

export type BrowserAction =
  | "back"
  | "forward"
  | "reload"
  | "stop"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"
  | "devtools"
  | "stop-find";

export type BrowserEditSelection = {
  url: string;
  title: string;
  selector: string;
  tag: string;
  text: string;
};

export type BrowserEditEvent = {
  id: string;
  token: string;
  active: boolean;
  selection?: BrowserEditSelection;
  screenshot?: BrowserEditScreenshot;
  error?: string;
};

export type BrowserEditScreenshot = {
  dataUrl: string;
  width: number;
  height: number;
};

/** Keep element selection visual and durable without inserting page JSON into a draft. */
export async function browserEditAttachment(
  screenshot: BrowserEditScreenshot,
): Promise<Attachment> {
  const prefix = "data:image/png;base64,";
  const data = screenshot.dataUrl?.startsWith(prefix)
    ? screenshot.dataUrl.slice(prefix.length)
    : "";
  if (
    !Number.isFinite(screenshot.width) ||
    screenshot.width <= 0 ||
    !Number.isFinite(screenshot.height) ||
    screenshot.height <= 0 ||
    !data.startsWith("iVBORw0KGgo") ||
    data.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
  )
    throw new Error(
      "Could not capture the selected element. Please select it again.",
    );
  const size =
    (data.length / 4) * 3 -
    (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
  if (size > 20 * 1024 * 1024)
    throw new Error(
      "The selected element is too large. Select a smaller area.",
    );
  const name = "Selected element.png";
  const path = await invoke<string>("write_attachment", { name, data });
  if (!path) throw new Error("Could not save the selected element screenshot.");
  return {
    id: crypto.randomUUID(),
    name,
    mimeType: "image/png",
    kind: "image",
    size,
    data,
    path,
  };
}

export type BrowserFindResult = {
  query: string;
  activeMatch: number;
  totalMatches: number;
};

export type BrowserDownload = {
  id: string;
  filename: string;
  receivedBytes: number;
  totalBytes?: number | null;
  state: "in-progress" | "completed" | "cancelled" | "failed";
  error?: string | null;
};

export type BrowserToolbarCommand = {
  id: string;
  action: "find" | "address";
};

export type BrowserState = {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  loading: boolean;
  loadProgress?: number | null;
  zoomFactor?: number;
  findResult?: BrowserFindResult | null;
  canGoBack: boolean;
  canGoForward: boolean;
  error: string | null;
  notice: string | null;
  /** Authored by the native window's first-responder observer. */
  focused?: boolean;
  floating?: boolean;
  /** Native menus can sit above Chromium without replacing the page. */
  nativeMenus?: boolean;
  nativeDropIndicator?: boolean;
  /** The native page was destroyed; Retry must allocate a fresh page. */
  closed?: boolean;
};

export type BrowserDropIndicator = {
  x: number;
  y: number;
  width: number;
  height: number;
  edge: "tab" | "left" | "right" | "up" | "down";
  kind: "tab" | "group";
  title: string;
};

export type BrowserMenuOptions = {
  canAddToChat: boolean;
  canFloat: boolean;
  floating: boolean;
  canUsePage: boolean;
};

const HOST_WITH_PORT = /^(?:\[[a-f\d:.]+\]|[a-z\d.-]+):\d+(?:[/?#]|$)/i;
const LOCAL_ADDRESS =
  /^(?:localhost|[a-z\d.-]+\.localhost|[a-z\d.-]+\.local|(?:\d{1,3}\.){3}\d{1,3}|\[[a-f\d:.]+\])(?::\d+)?(?:[/?#]|$)/i;

function isHostWithPort(input: string): boolean {
  return (
    HOST_WITH_PORT.test(input) &&
    !/^(?:https?|javascript|file|data|tauri|asset|ipc|ftp|mailto|about|blob|tel):/i.test(
      input,
    )
  );
}

export function browserSearchUrl(query: string): string {
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", query.trim());
  return url.href;
}

/** User-entered omnibox text; strict URL validation still owns the native boundary. */
export function resolveBrowserAddress(value: string): string {
  const input = value.trim();
  if (!input) throw new Error("Enter a search or web address.");
  if (/[\u0000-\u001f\u007f]/.test(input)) {
    throw new Error("Enter a search or address without control characters.");
  }
  const explicitScheme =
    /^[a-z][a-z\d+.-]*:/i.test(input) && !isHostWithPort(input);
  const domain = /^[^\s/?#:@]+\.[^\s/?#:@]+(?::\d+)?(?:[/?#]|$)/.test(input);
  if (
    explicitScheme ||
    LOCAL_ADDRESS.test(input) ||
    isHostWithPort(input) ||
    domain
  ) {
    return normalizeBrowserUrl(input);
  }
  return browserSearchUrl(input);
}

/** Help repair old auto-prefixed single-word addresses without rewriting explicit intranet URLs. */
export function browserSearchSuggestion(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      ["http:", "https:"].includes(url.protocol) &&
      /^[a-z\d-]+$/i.test(url.hostname) &&
      url.hostname !== "localhost" &&
      !url.port &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    ) {
      return url.hostname;
    }
  } catch {
    /* Only valid web addresses can have a single-label host. */
  }
  return undefined;
}

/** Preview accepts web URLs, never app protocols, files, or executable URLs. */
export function normalizeBrowserUrl(value: string): string {
  const input = value.trim();
  if (!input) throw new Error("Enter a website or localhost address.");
  if (/[\u0000-\u0020\u007f]/.test(input)) {
    throw new Error("Enter an address without spaces or control characters.");
  }
  const local =
    LOCAL_ADDRESS.test(input) || /^[a-z\d-]+:\d+(?:[/?#]|$)/i.test(input);
  const explicitScheme =
    /^[a-z][a-z\d+.-]*:/i.test(input) && !isHostWithPort(input);
  let url: URL;
  try {
    url = new URL(
      explicitScheme ? input : `${local ? "http" : "https"}://${input}`,
    );
  } catch {
    throw new Error("That address is not a valid web URL.");
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname) {
    throw new Error("Preview supports http and https addresses only.");
  }
  if (url.username || url.password) {
    throw new Error(
      "Use a web address without an embedded username or password.",
    );
  }
  if (
    ["tauri.localhost", "asset.localhost", "ipc.localhost"].includes(
      url.hostname.toLowerCase(),
    )
  ) {
    throw new Error("Internal app addresses cannot be opened in Preview.");
  }
  return url.href;
}

export function browserBounds(element: HTMLElement): BrowserBounds | null {
  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1 || rect.x < 0 || rect.y < 0)
    return null;
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    scale: window.devicePixelRatio || 1,
    viewportHeight: window.innerHeight,
  };
}

export const nativeBrowser = {
  dropIndicator: (id: string, indicator: BrowserDropIndicator | null) =>
    invoke<void>("browser_drop_indicator", { id, indicator }),
  menu: (id: string, anchor: BrowserBounds, options: BrowserMenuOptions) =>
    invoke<string | null>("browser_menu", { id, anchor, options }),
  edit: (id: string, active: boolean, token: string) =>
    invoke<void>("browser_edit", { id, active, token }),
  listenEditing: (callback: (event: BrowserEditEvent) => void) =>
    getCurrentWebview().listen<BrowserEditEvent>(
      "browser-edit",
      ({ payload }) => callback(payload),
    ),
  attach: (id: string) => invoke<BrowserState>("browser_attach", { id }),
  create: (id: string, url: string, bounds: BrowserBounds) =>
    invoke<void>("browser_create", { id, url, bounds }),
  navigate: (id: string, url: string) =>
    invoke<void>("browser_navigate", { id, url }),
  action: (id: string, action: BrowserAction) =>
    invoke<void>("browser_action", { id, action }),
  find: (
    id: string,
    text: string,
    forward = true,
    findNext = false,
    matchCase = false,
  ) => invoke<void>("browser_find", { id, text, forward, findNext, matchCase }),
  downloads: (id: string) =>
    invoke<BrowserDownload[]>("browser_downloads", { id }),
  downloadAction: (
    id: string,
    downloadId: string,
    action: "open" | "reveal" | "cancel",
  ) => invoke<void>("browser_download_action", { id, downloadId, action }),
  listenDownloads: (
    callback: (event: { id: string; downloads: BrowserDownload[] }) => void,
  ) =>
    getCurrentWebview().listen<{ id: string; downloads: BrowserDownload[] }>(
      "browser-downloads",
      ({ payload }) => callback(payload),
    ),
  listenToolbar: (callback: (event: BrowserToolbarCommand) => void) =>
    getCurrentWebview().listen<BrowserToolbarCommand>(
      "browser-toolbar-command",
      ({ payload }) => callback(payload),
    ),
  layout: (id: string, bounds: BrowserBounds, visible: boolean) =>
    invoke<void>("browser_layout", { id, bounds, visible }),
  snapshot: (id: string) => invoke<string>("browser_snapshot", { id }),
  close: (id: string) => invoke<void>("browser_close", { id }),
  setFloating: (id: string, floating: boolean) =>
    invoke<string | null>("browser_set_floating", { id, floating }),
  showFloating: (id: string) => invoke<void>("browser_show_floating", { id }),
  listen: (callback: (state: BrowserState) => void) =>
    getCurrentWebview().listen<BrowserState>("browser-state", ({ payload }) =>
      callback(payload),
    ),
};

export function openBrowserExternally(url: string): Promise<void> {
  return openUrl(normalizeBrowserUrl(url), "Brave Browser");
}

/** Compact transfer size without inventing a total for unknown-length downloads. */
export function browserDownloadProgress(download: BrowserDownload): string {
  const format = (bytes: number) => {
    const safe = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
    if (safe < 1024) return `${Math.round(safe)} B`;
    if (safe < 1024 * 1024) return `${(safe / 1024).toFixed(1)} KB`;
    return `${(safe / (1024 * 1024)).toFixed(1)} MB`;
  };
  const received = format(download.receivedBytes);
  return download.totalBytes != null &&
    Number.isFinite(download.totalBytes) &&
    download.totalBytes > 0
    ? `${received} of ${format(download.totalBytes)}`
    : received;
}

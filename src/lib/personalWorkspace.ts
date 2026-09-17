import { browserFavicon } from "./browserIcons";

const SIDEBAR_KEY = "monocode.personal.sidebarOpen";
const BROWSER_KEY = "monocode.personal.browser";

export type BrowserTab = {
  id: string;
  url: string;
  title?: string;
  favicon?: string;
};

export type BrowserWorkspace = {
  open: boolean;
  mode: "tab" | "split";
  url: string;
  ratio: number;
  expanded: boolean;
  /** Optional only for legacy callers and stored single-page workspaces. */
  tabs?: BrowserTab[];
  activeTabId?: string | null;
};
export type NormalizedBrowserWorkspace = BrowserWorkspace & {
  tabs: BrowserTab[];
  activeTabId: string | null;
};
export const EMPTY_BROWSER: NormalizedBrowserWorkspace = {
  open: false,
  mode: "tab",
  expanded: false,
  url: "",
  ratio: 0.44,
  tabs: [],
  activeTabId: null,
};

function validTab(value: unknown): BrowserTab | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const tab = value as Partial<BrowserTab>;
  if (typeof tab.id !== "string" || !tab.id.trim() || tab.id.length > 200)
    return null;
  return {
    id: tab.id,
    url: typeof tab.url === "string" ? tab.url : "",
    ...(browserFavicon(tab.favicon) ? { favicon: tab.favicon } : {}),
    ...(typeof tab.title === "string" && tab.title.trim()
      ? { title: tab.title.trim() }
      : {}),
  };
}

/** Deterministic migration also retains a page saved while its browser was hidden. */
export function normalizeBrowserWorkspace(
  value: unknown,
): NormalizedBrowserWorkspace {
  const v =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Partial<BrowserWorkspace>)
      : {};
  const ids = new Set<string>();
  const tabs = (Array.isArray(v.tabs) ? v.tabs : []).flatMap((value) => {
    const tab = validTab(value);
    if (!tab || ids.has(tab.id)) return [];
    ids.add(tab.id);
    return [tab];
  });
  const legacyUrl = typeof v.url === "string" ? v.url : "";
  if (!tabs.length && (legacyUrl || v.open === true))
    tabs.push({ id: "legacy", url: legacyUrl });
  const active = tabs.find((tab) => tab.id === v.activeTabId) ?? tabs[0];
  return {
    open: v.open === true,
    mode: v.mode === "split" ? "split" : "tab",
    expanded: v.mode ? v.expanded === true : v.open === true,
    url: active?.url ?? "",
    ratio:
      typeof v.ratio === "number" && Number.isFinite(v.ratio)
        ? Math.min(0.7, Math.max(0.25, v.ratio))
        : EMPTY_BROWSER.ratio,
    tabs,
    activeTabId: active?.id ?? null,
  };
}

/** New identities are supplied by the caller so state transitions stay pure. */
export function addBrowserTab(
  state: BrowserWorkspace,
  value: BrowserTab,
): NormalizedBrowserWorkspace {
  const current = normalizeBrowserWorkspace(state);
  const tab = validTab(value);
  if (!tab) return current;
  if (current.tabs.some((item) => item.id === tab.id))
    return selectBrowserTab(current, tab.id);
  return {
    ...current,
    tabs: [...current.tabs, tab],
    activeTabId: tab.id,
    url: tab.url,
    open: true,
    expanded: current.mode === "tab",
  };
}

export function selectBrowserTab(
  state: BrowserWorkspace,
  id: string,
): NormalizedBrowserWorkspace {
  const current = normalizeBrowserWorkspace(state);
  const tab = current.tabs.find((tab) => tab.id === id);
  return tab
    ? {
        ...current,
        activeTabId: tab.id,
        url: tab.url,
        open: true,
        expanded: current.mode === "tab",
      }
    : current;
}

export function updateBrowserTab(
  state: BrowserWorkspace,
  id: string,
  patch: Partial<Pick<BrowserTab, "url" | "title" | "favicon">>,
): NormalizedBrowserWorkspace {
  const current = normalizeBrowserWorkspace(state);
  const tabs = current.tabs.map((tab) => {
    if (tab.id !== id) return tab;
    const next = { ...tab };
    if (typeof patch.url === "string") {
      if (next.url !== patch.url) {
        try {
          if (new URL(next.url).origin !== new URL(patch.url).origin)
            delete next.favicon;
        } catch {
          delete next.favicon;
        }
      }
      next.url = patch.url;
    }
    if ("favicon" in patch) {
      const favicon = browserFavicon(patch.favicon);
      if (favicon) next.favicon = favicon;
      else delete next.favicon;
    }
    if (typeof patch.title === "string") {
      if (patch.title.trim()) next.title = patch.title.trim();
      else delete next.title;
    }
    return next;
  });
  return {
    ...current,
    tabs,
    url: tabs.find((tab) => tab.id === current.activeTabId)?.url ?? "",
  };
}

export function closeBrowserTab(
  state: BrowserWorkspace,
  id: string,
): NormalizedBrowserWorkspace {
  const current = normalizeBrowserWorkspace(state);
  const index = current.tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return current;
  const tabs = current.tabs.filter((tab) => tab.id !== id);
  const active =
    current.activeTabId === id
      ? tabs[Math.min(index, tabs.length - 1)]
      : tabs.find((tab) => tab.id === current.activeTabId);
  return {
    ...current,
    tabs,
    activeTabId: active?.id ?? null,
    url: active?.url ?? "",
    open: tabs.length > 0 && current.open,
    expanded: tabs.length > 0 && current.expanded,
  };
}

/** Old single-page controls can still patch url/open without losing tab state. */
export function patchBrowserWorkspace(
  state: BrowserWorkspace,
  patch: Partial<BrowserWorkspace>,
): NormalizedBrowserWorkspace {
  const current = normalizeBrowserWorkspace(state);
  let next = { ...current, ...patch };
  if (
    patch.url !== undefined &&
    patch.tabs === undefined &&
    typeof patch.url === "string"
  ) {
    const targetId = patch.activeTabId ?? current.activeTabId;
    next = {
      ...next,
      tabs: targetId
        ? current.tabs.map((tab) =>
            tab.id === targetId ? { ...tab, url: patch.url! } : tab,
          )
        : [],
    };
  }
  return normalizeBrowserWorkspace(next);
}

export function loadPersonalSidebar(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== "false";
  } catch {
    return true;
  }
}

export function savePersonalSidebar(open: boolean) {
  try {
    localStorage.setItem(SIDEBAR_KEY, String(open));
  } catch {
    /* Keep the current window usable. */
  }
}

export function loadBrowserWorkspaces(): Record<
  string,
  NormalizedBrowserWorkspace
> {
  try {
    const raw = JSON.parse(localStorage.getItem(BROWSER_KEY) ?? "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw).flatMap(([path, value]) => {
        if (!value || typeof value !== "object" || Array.isArray(value))
          return [];
        return [[path, normalizeBrowserWorkspace(value)]];
      }),
    );
  } catch {
    return {};
  }
}

export function saveBrowserWorkspaces(value: Record<string, BrowserWorkspace>) {
  try {
    localStorage.setItem(
      BROWSER_KEY,
      JSON.stringify(
        Object.fromEntries(
          Object.entries(value).map(([path, workspace]) => [
            path,
            normalizeBrowserWorkspace(workspace),
          ]),
        ),
      ),
    );
  } catch {
    /* Keep the current window usable. */
  }
}

/** Stable, webview-label-safe identity; the window label is added by native code. */
export function browserIdForProject(path: string): string {
  let hash = 2166136261;
  for (const char of path)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `project-${(hash >>> 0).toString(16)}`;
}

/** A bounded native label, stable across reloads and distinct for project + tab. */
export function browserIdForTab(project: string, tabId: string): string {
  const key = JSON.stringify([project, tabId]);
  const hash = (seed: number) => {
    let value = seed;
    for (let index = 0; index < key.length; index++)
      value = Math.imul(value ^ key.charCodeAt(index), 16777619);
    return (value >>> 0).toString(16).padStart(8, "0");
  };
  return `browser-${hash(2166136261)}${hash(0x9e3779b9)}`;
}

const INSPECTOR_KEY = "monocode.personal.inspector";
export type PersonalInspector = {
  open: boolean;
  tab: "files" | "changes";
  width: number;
};
export function loadPersonalInspector(): PersonalInspector {
  try {
    const value = JSON.parse(localStorage.getItem(INSPECTOR_KEY) ?? "null");
    return {
      open: value?.open !== false,
      tab: value?.tab === "changes" ? "changes" : "files",
      width:
        typeof value?.width === "number" && Number.isFinite(value.width)
          ? Math.min(380, Math.max(260, value.width))
          : 280,
    };
  } catch {
    return { open: true, tab: "files", width: 280 };
  }
}
export function savePersonalInspector(value: PersonalInspector) {
  try {
    localStorage.setItem(INSPECTOR_KEY, JSON.stringify(value));
  } catch {
    /* In-memory layout remains usable. */
  }
}

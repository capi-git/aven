import { HAS_NATIVE_GLASS } from "./platform";
import type { SettingsSectionId } from "./settings";

export type SettingsSearchResult = {
  id: string;
  label: string;
  description: string;
  section: SettingsSectionId;
};

/** Shared with settings rows so search always targets the rendered control. */
export function settingSearchAnchor(label: string): string {
  return `setting-${label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

type SearchEntry = SettingsSearchResult & {
  keywords: string;
  nativeGlass?: boolean;
};

function setting(
  section: SettingsSectionId,
  label: string,
  description: string,
  keywords = "",
  nativeGlass = false,
): SearchEntry {
  return {
    id: settingSearchAnchor(label),
    label,
    description,
    section,
    keywords,
    nativeGlass,
  };
}

// Index actual controls and stable page/card anchors, never hidden child controls.
const SETTINGS_SEARCH_ENTRIES: readonly SearchEntry[] = [
  setting(
    "provider-setup",
    "Provider setup",
    "Choose providers, install their CLIs, sign in, and check your connections.",
    "onboarding first launch getting started cli installation login authentication Windows macOS PATH Claude Codex",
  ),
  setting(
    "git",
    "When an agent finishes",
    "Leave changes for you, commit them, or open a pull request.",
    "pull request pr commit push branch finish done review automatic turn off",
  ),
  setting(
    "skills",
    "Installed skills",
    "Find reusable instructions from this project and your personal skills.",
    "slash commands agents skill markdown create inspect",
  ),
  setting(
    "skills",
    "In-app browser",
    "Browser tools are built into Aven and scoped to each task.",
    "tools chromium web localhost automation",
  ),
  setting(
    "skills",
    "Desktop control",
    "Let agents see and use apps on this Mac with Aven's built-in desktop control.",
    "tools native computer use macOS enable switch off allow accessibility screen recording permissions",
  ),
  setting(
    "connections",
    "Agent connections",
    "Add, remove, and sign in to MCP servers for Claude and Codex.",
    "mcp servers connectors apps sign in login add remove claude.ai chatgpt integration status",
  ),
  setting(
    "tasks",
    "Default task access",
    "Choose the approval policy for new tasks.",
    "permissions full access supervised auto accept safety",
  ),
  setting(
    "tasks",
    "Transcript layout",
    "Choose full-width prompts or chat-style messages.",
    "conversation alignment bubbles",
  ),
  setting(
    "tasks",
    "Diff view",
    "Review changes in the editor or a unified view.",
    "code review files inline patch",
  ),
  setting(
    "tasks",
    "Follow-up behavior",
    "Queue messages until a turn finishes, or steer it immediately.",
    "followup queued send busy running",
  ),
  setting(
    "tasks",
    "Anchor prompts to top",
    "Position new prompts at the top of the conversation.",
    "chat scrolling reply bottom",
  ),
  setting(
    "general",
    "Composer mascot",
    "Show the animated project mascot during a turn.",
    "pet animation working",
  ),
  setting(
    "general",
    "Empty session games",
    "Show small games in empty conversations.",
    "pacman snake arcade idle",
  ),
  setting(
    "general",
    "Notes",
    "Show the shared Markdown notebook in the project rail.",
    "notebook note save add chat",
  ),
  setting(
    "general",
    "Working agents",
    "Show running tasks and recently finished work in the project rail.",
    "activity status progress card",
  ),
  setting(
    "browser",
    "Memory saver",
    "Keep your three most recent browser tabs ready. Older inactive tabs can sleep after five minutes and reload when reopened. Pages in use stay awake.",
    "ram memory performance browser sleeping suspend inactive tabs resources",
  ),
  setting(
    "browser",
    "Lightweight browser",
    "Uses Chromium's reduced-memory mode for web pages and keeps only your most recent inactive tab ready. For laptops with little memory; applies when Aven starts.",
    "ram memory low-end lightweight performance browser laptop restart",
  ),
  setting(
    "notifications",
    "Sounds",
    "Control sound cues for tasks and workspace actions.",
    "audio mute volume",
  ),
  setting(
    "notifications",
    "Notifications",
    "Show desktop notifications when a task needs attention.",
    "alerts banners macos completion",
  ),
  setting(
    "notifications",
    "Activity alerts",
    "Choose alerts for input requests, failures, and finished tasks.",
    "approvals errors stopped attention sound",
  ),
  setting(
    "notifications",
    "Quiet mode",
    "Record activity without task banners or sounds.",
    "do not disturb dnd mute focus",
  ),
  setting(
    "tasks",
    "Claude Code hooks",
    "Run configured Claude Code hooks on future turns.",
    "automation pretooluse settings json",
  ),
  setting(
    "connections",
    "Linear API key",
    "Connect Linear to access your teams and issues.",
    "integration account token disconnect",
  ),
  setting(
    "general",
    "Version",
    "Check for app updates, read what's new, and restart to install.",
    "automatic update release changelog download build about",
  ),
  setting(
    "appearance",
    "Same appearance across workspaces",
    "Copy colors, transparency, blur, and sidebar styling to other workspaces.",
    "sync match work personal identical",
  ),
  setting(
    "appearance",
    "Theme",
    "Use the system appearance, dark mode, or light mode.",
    "automatic night day",
  ),
  setting(
    "appearance",
    "Workspace colors",
    "Drag to pick any background, accent, or highlight color.",
    "dark light hex tint hue saturation palette picker theme",
  ),
  setting(
    "appearance",
    "Match sidebars to workspace",
    "Use the workspace background and transparency in both sidebars.",
    "panels same separate colors",
  ),
  setting(
    "appearance",
    "Background opacity",
    "Adjust desktop transparency in dark appearance.",
    "glass transparent translucent see through",
    true,
  ),
  setting(
    "appearance",
    "Blur radius",
    "Adjust the desktop blur behind transparent surfaces.",
    "glass frosted transparency",
    true,
  ),
  setting(
    "appearance",
    "Include workspace",
    "Show the desktop behind chat panes and editors.",
    "glass transparency main content",
    true,
  ),
  setting(
    "appearance",
    "Chat background",
    "Choose a local image and control where and how strongly it appears.",
    "wallpaper photo picture visibility empty sessions",
  ),
  setting(
    "appearance",
    "Interface scale",
    "Make the whole interface larger or smaller.",
    "zoom text size font accessibility",
  ),
  setting(
    "keybindings",
    "Keybindings",
    "Find keyboard shortcuts and when each command is available.",
    "keyboard hotkeys bindings keys commands",
  ),
  setting(
    "providers",
    "Providers",
    "Choose default models and which providers and models appear in the picker.",
    "connections cli refresh discovery claude codex cursor grok opencode pi omp fx available show hide",
  ),
  setting(
    "providers",
    "Keep provider tools up to date",
    "Automatically update supported provider tools and discover available models.",
    "automatic updates cli codex claude new models catalog refresh",
  ),
  setting(
    "archive",
    "Archived projects",
    "Browse, restore, or delete archived projects.",
    "history recover unarchive folders",
  ),
  setting(
    "archive",
    "Archived conversations",
    "Browse, restore, or delete archived conversations.",
    "history recover unarchive sessions tasks chats",
  ),
  setting(
    "archive",
    "Show archived in the sidebar",
    "Include archived conversations in the sidebar.",
    "history hidden sessions tasks chats",
  ),
];

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Empty or unrelated queries have no results; every search term must match. */
export function searchSettings(query: string): SettingsSearchResult[] {
  const normalized = normalize(query);
  if (!normalized) return [];
  const terms = normalized.split(/\s+/);

  return SETTINGS_SEARCH_ENTRIES.flatMap((entry) => {
    if (entry.nativeGlass && !HAS_NATIVE_GLASS) return [];
    const label = normalize(entry.label);
    const description = normalize(entry.description);
    const words = normalize(
      `${entry.label} ${entry.description} ${entry.keywords}`,
    ).split(" ");
    if (!terms.every((term) => words.some((word) => word.startsWith(term))))
      return [];

    const score =
      (label === normalized ? 100 : 0) +
      (label.startsWith(normalized) ? 40 : 0) +
      terms.reduce(
        (total, term) =>
          total +
          (label.includes(term) ? 10 : description.includes(term) ? 3 : 1),
        0,
      );
    const { id, description: resultDescription, section } = entry;
    return [
      {
        result: {
          id,
          label: entry.label,
          description: resultDescription,
          section,
        },
        score,
      },
    ];
  })
    .sort(
      (a, b) =>
        b.score - a.score || a.result.label.localeCompare(b.result.label),
    )
    .map(({ result }) => result);
}

type AnchorListener = (id: string, section: SettingsSectionId) => void;
const anchorListeners = new Set<AnchorListener>();

/** The sidebar search asks the open settings page to reveal a result. */
export function requestSettingsAnchor(id: string, section: SettingsSectionId) {
  for (const listener of anchorListeners) listener(id, section);
}

export function subscribeSettingsAnchor(listener: AnchorListener) {
  anchorListeners.add(listener);
  return () => {
    anchorListeners.delete(listener);
  };
}

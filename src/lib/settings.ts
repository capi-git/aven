import { ALT, CTRL, MOD, SHIFT } from "./platform";
import { SETTINGS } from "./settingDefinitions";
import { defineStoredSetting } from "./settingsRegistry";
export { SETTINGS } from "./settingDefinitions";

export type SettingsSectionId =
  | "general"
  | "appearance"
  | "notifications"
  | "keybindings"
  | "providers"
  | "provider-setup"
  | "tasks"
  | "skills"
  | "git"
  | "connections"
  | "browser"
  | "archive";

export type SettingsSectionGroup =
  "Personal" | "Agents" | "Coding" | "Integrations" | "Archived";

/** Navigation order. Each group starts where its first section appears. */
export const SETTINGS_SECTIONS: {
  id: SettingsSectionId;
  group: SettingsSectionGroup;
  label: string;
  description: string;
}[] = [
  {
    id: "general",
    group: "Personal",
    label: "General",
    description: "Updates, the sidebar, and small extras.",
  },
  {
    id: "appearance",
    group: "Personal",
    label: "Appearance",
    description: "Theme, accent colour, glass and chat background.",
  },
  {
    id: "notifications",
    group: "Personal",
    label: "Notifications",
    description: "Decide when and how Aven gets your attention.",
  },
  {
    id: "keybindings",
    group: "Personal",
    label: "Keyboard shortcuts",
    description: "Find keyboard shortcuts and where they work.",
  },
  {
    id: "provider-setup",
    group: "Agents",
    label: "Provider setup",
    description: "Choose agent apps, install them, and connect your accounts.",
  },
  {
    id: "providers",
    group: "Agents",
    label: "Providers & models",
    description: "Choose your agents, models, and defaults for new chats.",
  },
  {
    id: "tasks",
    group: "Agents",
    label: "Chats & review",
    description:
      "How chats start, handle your follow-up messages, and show their work.",
  },
  {
    id: "skills",
    group: "Agents",
    label: "Skills & tools",
    description:
      "Reusable instructions, browser tools, and optional desktop control.",
  },
  {
    id: "git",
    group: "Coding",
    label: "Git",
    description: "What agents do with their changes when they finish.",
  },
  {
    id: "connections",
    group: "Integrations",
    label: "Connections",
    description: "Services Aven connects to on your behalf.",
  },
  {
    id: "browser",
    group: "Integrations",
    label: "Browser",
    description: "Open dev previews and keep browser tabs ready.",
  },
  {
    id: "archive",
    group: "Archived",
    label: "Archive",
    description: "Find and restore archived projects and chats.",
  },
];

export const SETTINGS_SECTION_DEFAULT: SettingsSectionId = "general";

export function isSettingsSectionId(
  value: unknown,
): value is SettingsSectionId {
  return SETTINGS_SECTIONS.some((section) => section.id === value);
}

export function settingsSectionLabel(id: SettingsSectionId): string {
  return (
    SETTINGS_SECTIONS.find((section) => section.id === id)?.label ?? "General"
  );
}

export function settingsSectionDescription(id: SettingsSectionId): string {
  return (
    SETTINGS_SECTIONS.find((section) => section.id === id)?.description ?? ""
  );
}

const settingsSection = defineStoredSetting<SettingsSectionId>({
  key: "monocode.settingsSection",
  defaultValue: SETTINGS_SECTION_DEFAULT,
  parse: (raw) => (isSettingsSectionId(raw) ? raw : SETTINGS_SECTION_DEFAULT),
  serialize: (value) => value,
});

export const loadSettingsSection = settingsSection.load;
export const saveSettingsSection = settingsSection.save;

export type FollowUpBehavior = "steer" | "queue";
export type DiffViewer = "editor" | "unified";

export const FOLLOW_UP_BEHAVIOR_DEFAULT =
  SETTINGS.followUpBehavior.defaultValue;
export const loadFollowUpBehavior = SETTINGS.followUpBehavior.load;
export const saveFollowUpBehavior = SETTINGS.followUpBehavior.save;
export const subscribeFollowUpBehavior = SETTINGS.followUpBehavior.subscribe;

export const COMPOSER_RUNNER_DEFAULT = SETTINGS.composerRunner.defaultValue;
export const COMPOSER_RUNNER_CHANGE_EVENT =
  SETTINGS.composerRunner.changeEvent!;
export const loadComposerRunner = SETTINGS.composerRunner.load;
export const saveComposerRunner = SETTINGS.composerRunner.save;

export const NOTES_ENABLED_DEFAULT = SETTINGS.notesEnabled.defaultValue;
export const NOTES_ENABLED_CHANGE_EVENT = SETTINGS.notesEnabled.changeEvent!;
export const loadNotesEnabled = SETTINGS.notesEnabled.load;
export const saveNotesEnabled = SETTINGS.notesEnabled.save;
export const subscribeNotesEnabled = SETTINGS.notesEnabled.subscribe;

export const LIVE_AGENTS_ENABLED_DEFAULT =
  SETTINGS.liveAgentsEnabled.defaultValue;
export const LIVE_AGENTS_ENABLED_CHANGE_EVENT =
  SETTINGS.liveAgentsEnabled.changeEvent!;
export const loadLiveAgentsEnabled = SETTINGS.liveAgentsEnabled.load;
export const saveLiveAgentsEnabled = SETTINGS.liveAgentsEnabled.save;
export const subscribeLiveAgentsEnabled = SETTINGS.liveAgentsEnabled.subscribe;

export const BROWSER_MEMORY_SAVER_DEFAULT =
  SETTINGS.browserMemorySaver.defaultValue;
export const loadBrowserMemorySaver = SETTINGS.browserMemorySaver.load;
export const saveBrowserMemorySaver = SETTINGS.browserMemorySaver.save;
export const subscribeBrowserMemorySaver =
  SETTINGS.browserMemorySaver.subscribe;

export const BROWSER_LOW_MEMORY_DEFAULT =
  SETTINGS.browserLowMemory.defaultValue;
export const loadBrowserLowMemory = SETTINGS.browserLowMemory.load;
export const saveBrowserLowMemory = SETTINGS.browserLowMemory.save;
export const subscribeBrowserLowMemory = SETTINGS.browserLowMemory.subscribe;

export const GRID_ARCADE_ENABLED_DEFAULT =
  SETTINGS.gridArcadeEnabled.defaultValue;
export const GRID_ARCADE_ENABLED_CHANGE_EVENT =
  SETTINGS.gridArcadeEnabled.changeEvent!;
export const loadGridArcadeEnabled = SETTINGS.gridArcadeEnabled.load;
export const saveGridArcadeEnabled = SETTINGS.gridArcadeEnabled.save;
export const subscribeGridArcadeEnabled = SETTINGS.gridArcadeEnabled.subscribe;

export const DIFF_VIEWER_DEFAULT = SETTINGS.diffViewer.defaultValue;
export const DIFF_VIEWER_CHANGE_EVENT = SETTINGS.diffViewer.changeEvent!;
export const loadDiffViewer = SETTINGS.diffViewer.load;
export const saveDiffViewer = SETTINGS.diffViewer.save;
export const subscribeDiffViewer = SETTINGS.diffViewer.subscribe;

export const AUTOSAVE_DEFAULT = SETTINGS.autosave.defaultValue;
export const loadAutosave = SETTINGS.autosave.load;
export function saveAutosave(value: boolean): boolean {
  SETTINGS.autosave.save(value);
  return loadAutosave();
}
export const subscribeAutosave = SETTINGS.autosave.subscribe;

export const CLAUDE_HOOKS_DEFAULT = SETTINGS.claudeHooks.defaultValue;
export const loadClaudeHooks = SETTINGS.claudeHooks.load;
export const saveClaudeHooks = SETTINGS.claudeHooks.save;

export type KeybindingRow = {
  command: string;
  keys: string;
  when: string;
};

/**
 * Mirrors the bindings we actually handle: the native menu accelerators in
 * `src-tauri/src/menu.rs`, `tabCommand`, and the window key handler in App.
 */
export const KEYBINDINGS: KeybindingRow[] = [
  { command: "App: Command palette", keys: `${MOD}K`, when: "Always" },
  {
    command: "App: Search",
    keys: `${MOD === "⌘" ? "⇧⌘" : "Ctrl+Shift+"}K`,
    when: "Always",
  },
  { command: "App: Go to File", keys: `${MOD}P`, when: "Always" },
  { command: "App: Find in Files", keys: `${MOD}${SHIFT}F`, when: "Always" },
  { command: "App: Open Project", keys: `${MOD}O`, when: "Always" },
  { command: "App: New Window", keys: `${MOD}${SHIFT}N`, when: "Always" },
  { command: "App: Toggle Sidebar", keys: `${MOD}B`, when: "Always" },
  { command: "App: Switch Model", keys: `${MOD}.`, when: "Always" },
  { command: "View: Zoom In", keys: `${MOD}+`, when: "Always" },
  { command: "View: Zoom Out", keys: `${MOD}-`, when: "Always" },
  { command: "View: Reset Zoom", keys: `${MOD}0`, when: "Always" },
  { command: "Chat: New", keys: `${MOD}T`, when: "Always" },
  { command: "Tab: Close Others", keys: `${MOD}${ALT}T`, when: "Always" },
  { command: "Tab: Next", keys: `${MOD}${SHIFT}]`, when: "Always" },
  { command: "Tab: Previous", keys: `${MOD}${SHIFT}[`, when: "Always" },
  { command: "Tab: Cycle Next", keys: `${CTRL}Tab`, when: "Always" },
  {
    command: "Tab: Cycle Previous",
    keys: `${CTRL}${SHIFT}Tab`,
    when: "Always",
  },
  { command: "Tab: Back", keys: `${MOD}[`, when: "Always" },
  { command: "Tab: Forward", keys: `${MOD}]`, when: "Always" },
  { command: "Tab: Activate 1–8", keys: `${MOD}1 … ${MOD}8`, when: "Always" },
  { command: "Tab: Activate Last", keys: `${MOD}9`, when: "Always" },
  {
    command: "Chat: Archive",
    keys: `${MOD}${SHIFT}A`,
    when: "sessionFocus && !overlay",
  },
  {
    command: "Chat: Previous",
    keys: `${MOD}${SHIFT}↑`,
    when: "!overlay && (!textFocus || emptyComposer)",
  },
  {
    command: "Chat: Next",
    keys: `${MOD}${SHIFT}↓`,
    when: "!overlay && (!textFocus || emptyComposer)",
  },
  {
    command: "Project: Previous",
    keys: `${MOD}${SHIFT}←`,
    when: "!overlay && (!textFocus || emptyComposer)",
  },
  {
    command: "Project: Next",
    keys: `${MOD}${SHIFT}→`,
    when: "!overlay && (!textFocus || emptyComposer)",
  },
  { command: "Pane: Close", keys: `${MOD}W`, when: "Always" },
  { command: "Pane: Split Right", keys: `${MOD}D`, when: "!editorFocus" },
  {
    command: "Pane: Split Down",
    keys: `${MOD}${SHIFT}D`,
    when: "!editorFocus",
  },
  { command: "Pane: Focus Left", keys: `${MOD}${ALT}←`, when: "Always" },
  { command: "Pane: Focus Right", keys: `${MOD}${ALT}→`, when: "Always" },
  { command: "Pane: Focus Up", keys: `${MOD}${ALT}↑`, when: "Always" },
  { command: "Pane: Focus Down", keys: `${MOD}${ALT}↓`, when: "Always" },
  { command: "Terminal: New", keys: `${MOD}\``, when: "Always" },
  { command: "Terminal: New Tab", keys: `${MOD}${SHIFT}\``, when: "Always" },
  { command: "Terminal: Toggle Dock", keys: `${MOD}J`, when: "Always" },
  { command: "Editor: Find", keys: `${MOD}F`, when: "editorFocus" },
  { command: "Editor: Replace", keys: `${MOD}${ALT}F`, when: "editorFocus" },
];

/** Display copy only: the shortcut definitions retain their original contexts. */
export function formatKeybindingContext(when: string): string {
  switch (when) {
    case "sessionFocus && !overlay":
      return "In a chat, with other views closed";
    case "!overlay && (!textFocus || emptyComposer)":
      return "In the workspace, outside text fields or in an empty composer";
    case "!editorFocus":
      return "Outside the editor";
    case "editorFocus":
      return "In the editor";
    default:
      return when;
  }
}

export function filterKeybindings(
  rows: KeybindingRow[],
  query: string,
): KeybindingRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter(
    (row) =>
      row.command.toLowerCase().includes(needle) ||
      row.keys.toLowerCase().includes(needle) ||
      row.when.toLowerCase().includes(needle) ||
      formatKeybindingContext(row.when).toLowerCase().includes(needle),
  );
}

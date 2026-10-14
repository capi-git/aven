import {
  AGENT_KEEP_AWAKE_DESCRIPTION,
  AGENT_KEEP_AWAKE_LABEL,
} from "./agentKeepAwake";
import type { DiffViewer, FollowUpBehavior } from "./settings";
import {
  defineSetting,
  defineStoredSetting,
  storedBoolean,
} from "./settingsRegistry";

// Row copy and search summaries intentionally differ where more context helps.
export const SETTINGS = {
  providerSetup: defineSetting({
    section: "provider-setup",
    label: "Provider setup",
    description:
      "Choose providers, install their CLIs, sign in, and check your connections.",
    keywords:
      "onboarding first launch getting started cli installation login authentication Windows macOS PATH Claude Codex",
  }),
  gitFinish: defineSetting({
    section: "git",
    label: "When an agent finishes",
    description: "Leave changes for you, commit them, or open a pull request.",
    keywords:
      "pull request pr commit push branch finish done review automatic turn off",
  }),
  installedSkills: defineSetting({
    section: "skills",
    label: "Installed skills",
    description:
      "Find reusable instructions from this project and your personal skills.",
    keywords: "slash commands agents skill markdown create inspect",
  }),
  inAppBrowser: defineSetting({
    section: "skills",
    label: "In-app browser",
    description: "Browser tools are built into Aven and scoped to each task.",
    keywords: "tools chromium web localhost automation",
  }),
  desktopControl: defineSetting({
    section: "skills",
    label: "Desktop control",
    description:
      "Let agents see and use apps on this Mac with Aven's built-in desktop control.",
    keywords:
      "tools native computer use macOS enable switch off allow accessibility screen recording permissions",
  }),
  agentConnections: defineSetting({
    section: "connections",
    label: "Agent connections",
    description:
      "Add, remove, and sign in to MCP servers for Claude and Codex.",
    keywords:
      "mcp servers connectors apps sign in login add remove claude.ai chatgpt integration status",
    rowDescription:
      "Add, remove, and sign in to the MCP servers Claude and Codex can reach. Each provider keeps its own settings and sign-in.",
  }),
  defaultTaskAccess: defineSetting({
    section: "tasks",
    label: "Default task access",
    description: "Choose the approval policy for new tasks.",
    keywords: "permissions full access supervised auto accept safety",
    rowDescription:
      "Applies to new tasks. Existing tasks keep their own access setting.",
  }),
  transcriptLayout: defineSetting({
    section: "tasks",
    label: "Transcript layout",
    description: "Choose full-width prompts or chat-style messages.",
    keywords: "conversation alignment bubbles",
    rowDescription: "Choose full-width prompts or a familiar chat layout.",
  }),
  diffViewer: defineSetting({
    ...defineStoredSetting<DiffViewer>({
      key: "monocode.diffViewer",
      defaultValue: "editor",
      parse: (raw) => (raw === "editor" || raw === "unified" ? raw : "editor"),
      serialize: (value) => value,
      normalizeSave: (value) =>
        value === "editor" || value === "unified" ? value : "editor",
      changeEvent: "monocode:diff-viewer-change",
      eventDetail: true,
    }),
    section: "tasks",
    label: "Diff view",
    description: "Review changes in the editor or a unified view.",
    keywords: "code review files inline patch",
    rowDescription:
      "Review changes in the editor or together in one unified view.",
  }),
  agentKeepAwake: defineSetting({
    section: "tasks",
    label: AGENT_KEEP_AWAKE_LABEL,
    description: AGENT_KEEP_AWAKE_DESCRIPTION,
    keywords:
      "sleep idle caffeinate power lock locked screen background energy app nap awake",
  }),
  autosave: defineSetting({
    ...defineStoredSetting<boolean>({
      key: "aven.fileEditorAutosave",
      ...storedBoolean(false),
      changeEvent: "aven:file-editor-autosave-change",
      storageChanges: true,
    }),
    section: "tasks",
    label: "Autosave files",
    description: "Save edited files shortly after you stop typing.",
    keywords: "editor auto save automatic write disk",
  }),
  followUpBehavior: defineSetting({
    ...defineStoredSetting<FollowUpBehavior>({
      key: "monocode.followUpBehavior",
      defaultValue: "queue",
      parse: (raw) => (raw === "queue" || raw === "steer" ? raw : "queue"),
      serialize: (value) => value,
      changeEvent: "monocode:follow-up-behavior-change",
      storageChanges: true,
    }),
    section: "tasks",
    label: "Follow-up behavior",
    description:
      "Queue messages until a turn finishes, or steer it immediately.",
    keywords: "followup queued send busy running",
    rowDescription:
      "Queue follow-ups until the active turn finishes, or steer the active turn immediately.",
  }),
  transcriptAnchor: defineSetting({
    section: "tasks",
    label: "Anchor prompts to top",
    description: "Position new prompts at the top of the conversation.",
    keywords: "chat scrolling reply bottom",
    rowDescription:
      "Keep your latest prompt at the top while the response grows below it.",
  }),
  composerRunner: defineSetting({
    ...defineStoredSetting<boolean>({
      key: "monocode.composerRunner",
      ...storedBoolean(false),
      changeEvent: "monocode:composer-runner-change",
      eventDetail: true,
    }),
    section: "general",
    label: "Composer mascot",
    description: "Show the animated project mascot during a turn.",
    keywords: "pet animation working",
    rowDescription: "Show a small animated mascot while an agent is working.",
  }),
  gridArcadeEnabled: defineSetting({
    ...defineStoredSetting<boolean>({
      key: "monocode.gridArcadeEnabled",
      ...storedBoolean(false),
      changeEvent: "monocode:grid-arcade-enabled-change",
      eventDetail: true,
    }),
    section: "general",
    label: "Empty session games",
    description: "Show small games in empty conversations.",
    keywords: "pacman snake arcade idle",
    rowDescription:
      "Show interactive games in empty sessions. Turn off for a quieter workspace.",
  }),
  notesEnabled: defineSetting({
    ...defineStoredSetting<boolean>({
      key: "monocode.notesEnabled",
      ...storedBoolean(true),
      changeEvent: "monocode:notes-enabled-change",
      eventDetail: true,
    }),
    section: "general",
    label: "Notes",
    description: "Show the shared Markdown notebook in the project rail.",
    keywords: "notebook note save add chat",
    rowDescription:
      "Keep reusable notes in the sidebar. Add them to a conversation with @note.",
  }),
  liveAgentsEnabled: defineSetting({
    ...defineStoredSetting<boolean>({
      key: "monocode.liveAgentsEnabled",
      ...storedBoolean(true),
      changeEvent: "monocode:live-agents-enabled-change",
      eventDetail: true,
    }),
    section: "general",
    label: "Working agents",
    description:
      "Show running tasks and recently finished work in the project rail.",
    keywords: "activity status progress card",
    rowDescription:
      "Show running agents together in the sidebar when multiple tasks are active.",
  }),
  browserMemorySaver: defineSetting({
    ...defineStoredSetting<boolean>({
      key: "aven.browserMemorySaver",
      ...storedBoolean(true, true),
      changeEvent: "aven:browser-memory-saver-change",
      storageChanges: true,
    }),
    section: "browser",
    label: "Memory saver",
    description:
      "Keep your three most recent browser tabs ready. Older inactive tabs can sleep after five minutes and reload when reopened. Pages in use stay awake.",
    keywords:
      "ram memory performance browser sleeping suspend inactive tabs resources",
  }),
  browserLowMemory: defineSetting({
    ...defineStoredSetting<boolean>({
      key: "aven.browserLowMemory",
      ...storedBoolean(false),
      changeEvent: "aven:browser-low-memory-change",
      storageChanges: true,
    }),
    section: "browser",
    label: "Lightweight browser",
    description:
      "Uses Chromium's reduced-memory mode for web pages and keeps only your most recent inactive tab ready. For laptops with little memory; applies when Aven starts.",
    keywords:
      "ram memory low-end lightweight performance browser laptop restart",
    rowDescription:
      "Uses Chromium's reduced-memory mode for web pages. With Memory saver on, keeps only your most recent inactive tab ready and sleeps others after two minutes. For laptops with little memory; the engine mode applies when Aven starts.",
    restartDescription:
      "Uses Chromium's reduced-memory mode for web pages. Restart Aven to apply this change.",
  }),
  sounds: defineSetting({
    section: "notifications",
    label: "Sounds",
    description: "Control sound cues for tasks and workspace actions.",
    keywords: "audio mute volume",
    rowDescription:
      "Play short cues for task completion, inbox items, updates, and interactions.",
  }),
  notifications: defineSetting({
    section: "notifications",
    label: "Notifications",
    description: "Show desktop notifications when a task needs attention.",
    keywords: "alerts banners macos completion",
    rowDescription:
      "Send macOS notifications when a task needs attention while you are elsewhere. Activity keeps a local history even when these are off.",
  }),
  activityAlerts: defineSetting({
    section: "notifications",
    label: "Activity alerts",
    description:
      "Choose alerts for input requests, failures, and finished tasks.",
    keywords: "approvals errors stopped attention sound",
    rowDescription:
      "Choose which outcomes can interrupt you. Every outcome still appears in Activity.",
  }),
  quietMode: defineSetting({
    section: "notifications",
    label: "Quiet mode",
    description: "Record activity without task banners or sounds.",
    keywords: "do not disturb dnd mute focus",
    rowDescription:
      "Keep recording Activity without task banners or task sounds. Your other sound settings stay unchanged.",
  }),
  claudeHooks: defineSetting({
    ...defineStoredSetting<boolean>({
      key: "monocode.claudeHooks",
      ...storedBoolean(true),
    }),
    section: "tasks",
    label: "Claude Code hooks",
    description: "Run configured Claude Code hooks on future turns.",
    keywords: "automation pretooluse settings json",
    rowDescription:
      "Run your configured Claude Code hooks. Changes apply on the next turn.",
  }),
  linearApiKey: defineSetting({
    section: "connections",
    label: "Linear API key",
    description: "Connect Linear to access your teams and issues.",
    keywords: "integration account token disconnect",
  }),
  version: defineSetting({
    section: "general",
    label: "Version",
    description:
      "Check for app updates, read what's new, and restart to install.",
    keywords: "automatic update release changelog download build about",
  }),
  sameAppearance: defineSetting({
    section: "appearance",
    label: "Same appearance across workspaces",
    description:
      "Copy colors, transparency, blur, and sidebar styling to other workspaces.",
    keywords: "sync match work personal identical",
    rowDescription:
      "Copy these colors, transparency, blur, and sidebar styles to your other workspaces.",
  }),
  theme: defineSetting({
    section: "appearance",
    label: "Theme",
    description: "Use the system appearance, dark mode, or light mode.",
    keywords: "automatic night day",
    rowDescription: "Follow your system, or choose a light or dark appearance.",
  }),
  workspaceColors: defineSetting({
    section: "appearance",
    label: "Workspace colors",
    description: "Drag to pick any background, accent, or highlight color.",
    keywords: "dark light hex tint hue saturation palette picker theme",
  }),
  matchPanels: defineSetting({
    section: "appearance",
    label: "Match sidebars to workspace",
    description:
      "Use the workspace background and transparency in both sidebars.",
    keywords: "panels same separate colors",
    rowDescription:
      "Use the same background and transparency across the workspace and sidebars.",
  }),
  backgroundOpacity: defineSetting({
    section: "appearance",
    label: "Background opacity",
    description: "Adjust desktop transparency in dark appearance.",
    keywords: "glass transparent translucent see through",
    rowDescription:
      "Background opacity for this workspace. Lower values show more of the desktop; text remains solid.",
    disabledDescription:
      "Light mode always uses an opaque window. Your dark-mode value is preserved.",
    nativeGlass: true,
  }),
  blurRadius: defineSetting({
    section: "appearance",
    label: "Blur radius",
    description: "Adjust the desktop blur behind transparent surfaces.",
    keywords: "glass frosted transparency",
    rowDescription:
      "Desktop blur for this workspace. Zero turns blur off; higher values cost more to composite.",
    disabledDescription:
      "Background blur is unavailable while light mode uses an opaque window.",
    opaqueDescription:
      "Lower background opacity to see desktop blur. At 100% opacity, the window covers it.",
    nativeGlass: true,
  }),
  bodyGlass: defineSetting({
    section: "appearance",
    label: "Include workspace",
    description: "Show the desktop behind chat panes and editors.",
    keywords: "glass transparency main content",
    rowDescription:
      "Also show the desktop behind sessions and editors in this workspace.",
    disabledDescription:
      "Main pane glass is unavailable while light mode uses an opaque window.",
    nativeGlass: true,
  }),
  chatBackground: defineSetting({
    section: "appearance",
    label: "Chat background",
    description:
      "Choose a local image and control where and how strongly it appears.",
    keywords: "wallpaper photo picture visibility empty sessions",
    rowDescription: "An image behind your chat panes. It stays on this device.",
  }),
  statusBarOpacity: defineSetting({
    section: "appearance",
    label: "Status bar opacity",
    description: "Adjust the bottom bar background when the sidebar is hidden.",
    keywords: "footer transparent translucent background strength",
    rowDescription:
      "Background strength of the bottom bar when the sidebar is hidden. Text and controls stay solid.",
  }),
  uiScale: defineSetting({
    section: "appearance",
    label: "Interface scale",
    description: "Make the whole interface larger or smaller.",
    keywords: "zoom text size font accessibility",
    rowDescription:
      "Resize the whole interface. Use Cmd +/− and Cmd 0 on Mac, or Ctrl on Windows and Linux.",
  }),
  keybindings: defineSetting({
    section: "keybindings",
    label: "Keybindings",
    description: "Find keyboard shortcuts and when each command is available.",
    keywords: "keyboard hotkeys bindings keys commands",
  }),
  providers: defineSetting({
    section: "providers",
    label: "Providers",
    description:
      "Choose default models and which providers and models appear in the picker.",
    keywords:
      "connections cli refresh discovery claude codex cursor grok opencode pi omp fx available show hide",
  }),
  providerToolAutoUpdates: defineSetting({
    section: "providers",
    label: "Keep provider tools up to date",
    description:
      "Automatically update supported provider tools and discover available models.",
    keywords: "automatic updates cli codex claude new models catalog refresh",
    rowDescription:
      "Check supported Codex and Claude installations daily so newly released models appear automatically. Model lists also refresh while Aven is open. Your selected models stay the same.",
  }),
  archivedProjects: defineSetting({
    section: "archive",
    label: "Archived projects",
    description: "Browse, restore, or delete archived projects.",
    keywords: "history recover unarchive folders",
  }),
  archivedConversations: defineSetting({
    section: "archive",
    label: "Archived conversations",
    description: "Browse, restore, or delete archived conversations.",
    keywords: "history recover unarchive sessions tasks chats",
  }),
  showArchived: defineSetting({
    section: "archive",
    label: "Show archived in the sidebar",
    description: "Include archived conversations in the sidebar.",
    keywords: "history hidden sessions tasks chats",
    rowDescription:
      "Keep archived conversations listed alongside the active ones.",
  }),
};

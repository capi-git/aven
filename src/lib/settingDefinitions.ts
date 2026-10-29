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
      "Choose agent apps, install them, sign in, and check your connections.",
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
    description:
      "Browser tools are built into Aven and kept separate for each chat.",
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
    label: "MCP servers",
    description:
      "Extra tools Claude and Codex can use: add, sign in to, turn off, or remove MCP servers.",
    keywords:
      "agent connections connectors apps sign in login add remove turn off disable hide claude.ai chatgpt integration status",
  }),
  defaultTaskAccess: defineSetting({
    section: "tasks",
    label: "Default access for new chats",
    description: "Choose what agents may do without asking in new chats.",
    keywords:
      "permissions full access ask first supervised auto accept safety task session approval policy",
    rowDescription:
      "Applies to new chats. Existing chats keep their own access.",
  }),
  transcriptLayout: defineSetting({
    section: "tasks",
    label: "Transcript layout",
    description: "Choose full-width prompts or chat-style messages.",
    keywords: "conversation chat alignment bubbles",
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
    label: "While an agent is working, new messages",
    description:
      "Hold new messages until the agent finishes, or send them to it right away.",
    keywords:
      "follow-up followup behavior queue queued steer send busy running",
    rowDescription:
      "Wait their turn: sent once the agent finishes. Send right away: the agent reads it while it works.",
  }),
  transcriptAnchor: defineSetting({
    section: "tasks",
    label: "Anchor prompts to top",
    description: "Position new prompts at the top of the chat.",
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
    label: "Mascot in the message box",
    description: "Show the project's animated mascot while an agent works.",
    keywords: "composer pet animation working",
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
    label: "Games in empty chats",
    description: "Show small games in empty chats.",
    keywords: "pacman snake arcade idle session conversation",
    rowDescription:
      "Show small games to play in empty chats. Turn off for a quieter workspace.",
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
    description: "Show the shared Markdown notebook in the sidebar.",
    keywords: "notebook note save add chat",
    rowDescription:
      "Keep reusable notes in the sidebar. Add them to a chat with @note.",
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
      "Show running agents and recently finished work in the sidebar.",
    keywords: "activity status progress card",
    rowDescription:
      "Show running agents together in the sidebar when several chats are working.",
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
    label: "Use less memory for web pages",
    description:
      "Runs web pages in a lighter mode and keeps only your most recent inactive tab ready. For computers with little memory; applies when Aven starts.",
    keywords:
      "ram memory low-end lightweight browser chromium reduced performance laptop restart",
    rowDescription:
      "Runs web pages in a lighter mode that needs less memory. With Memory saver on, also keeps only your most recent inactive tab ready and puts others to sleep after two minutes. For computers with little memory; the lighter mode applies when Aven starts.",
    restartDescription:
      "Runs web pages in a lighter mode that needs less memory. Restart Aven to apply this change.",
  }),
  devPreviewAutoOpen: defineSetting({
    ...defineStoredSetting<boolean>({
      key: "aven.devPreviewAutoOpen",
      ...storedBoolean(false),
      changeEvent: "aven:dev-preview-auto-open-change",
      storageChanges: true,
    }),
    section: "browser",
    label: "Open dev previews automatically",
    description:
      "Show a project's app beside the chat as soon as its dev server starts.",
    keywords:
      "live preview localhost dev server vite next port automatic split terminal agent",
    rowDescription:
      "When a dev server starts in a terminal or an agent's command, show its page beside the chat once, without asking. When off, a Preview ready chip offers it instead.",
  }),
  sounds: defineSetting({
    section: "notifications",
    label: "Sounds",
    description: "Control sound cues for agents and workspace actions.",
    keywords: "audio mute volume",
    rowDescription:
      "Play short cues when an agent finishes, and for inbox items, updates, and interactions.",
  }),
  notifications: defineSetting({
    section: "notifications",
    label: "Notifications",
    description: "Show desktop notifications when an agent needs you.",
    keywords: "alerts banners macos completion",
    rowDescription:
      "Send macOS notifications when an agent needs you while you are elsewhere. Activity keeps a local history even when these are off.",
  }),
  activityAlerts: defineSetting({
    section: "notifications",
    label: "Activity alerts",
    description:
      "Choose alerts for when an agent needs you, fails, or finishes.",
    keywords: "approvals errors stopped attention sound",
    rowDescription:
      "Choose which outcomes can interrupt you. Every outcome still appears in Activity.",
  }),
  quietMode: defineSetting({
    section: "notifications",
    label: "Quiet mode",
    description: "Record activity without banners or sounds.",
    keywords: "do not disturb dnd mute focus",
    rowDescription:
      "Keep recording Activity without agent banners or sounds. Your other sound settings stay unchanged.",
  }),
  claudeHooks: defineSetting({
    ...defineStoredSetting<boolean>({
      key: "monocode.claudeHooks",
      ...storedBoolean(true),
    }),
    section: "tasks",
    label: "Claude Code hooks",
    description: "Run your configured Claude Code hooks.",
    keywords: "automation pretooluse settings json",
    rowDescription:
      "Run your configured Claude Code hooks. Changes apply from your next message.",
  }),
  tour: defineSetting({
    section: "general",
    label: "Tour",
    description:
      "Take the short tour of the message box, sidebar, preview, Changes, board and project memory again.",
    keywords: "walkthrough onboarding guide help getting started welcome",
  }),
  version: defineSetting({
    section: "general",
    label: "Version",
    description:
      "Check for app updates, read what's new, and restart to install.",
    keywords: "automatic update release changelog download build about",
  }),
  theme: defineSetting({
    section: "appearance",
    label: "Theme",
    description: "Use the system appearance, dark mode, or light mode.",
    keywords: "automatic night day",
    rowDescription: "Follow your system, or choose a light or dark appearance.",
  }),
  accentColor: defineSetting({
    section: "appearance",
    label: "Accent colour",
    description: "Pick the colour for buttons, links and selections.",
    keywords:
      "color colour palette highlight tint hue swatch preset custom hex picker theme",
    rowDescription:
      "Used for buttons, links and selections. Each preset has a dark and a light shade.",
  }),
  uiScale: defineSetting({
    section: "appearance",
    label: "Interface scale",
    description: "Make the whole interface larger or smaller.",
    keywords: "zoom text size font accessibility",
    rowDescription:
      "Resize the whole interface. Use Cmd +/− and Cmd 0 on Mac, or Ctrl on Windows and Linux.",
  }),
  glass: defineSetting({
    section: "appearance",
    label: "Glass",
    description:
      "Keep the window solid, or let the desktop show through, softly blurred.",
    keywords:
      "transparency transparent translucent opacity blur radius frosted see through desktop window background status bar footer include workspace",
    rowDescription:
      "Solid hides the desktop. Slide toward glass to see it through the window, softly blurred. Text stays sharp.",
    disabledDescription:
      "Light mode always uses a solid window. Glass applies in dark mode.",
    nativeGlass: true,
  }),
  reduceMotion: defineSetting({
    ...defineStoredSetting<boolean>({
      key: "aven.reduceMotion",
      ...storedBoolean(false),
      changeEvent: "aven:reduce-motion-change",
      storageChanges: true,
    }),
    section: "appearance",
    label: "Reduce motion",
    description: "Show changes at once instead of sliding and fading.",
    keywords:
      "animation animations transitions motion movement fade slide spring accessibility calm",
    rowDescription:
      "Messages, menus, panes and lists change at once instead of sliding or fading. Aven also follows your system’s Reduce motion setting.",
  }),
  chatBackground: defineSetting({
    section: "appearance",
    label: "Chat background",
    description:
      "Choose a local image behind your chats and how strongly it shows.",
    keywords: "wallpaper photo picture image visibility",
    rowDescription: "An image behind your chat panes. It stays on this device.",
  }),
  useForAllWorkspaces: defineSetting({
    section: "appearance",
    label: "Use for all workspaces",
    description:
      "Copy this workspace's theme, accent colour and glass to your other workspaces.",
    keywords: "same sync match copy apply every work personal identical",
    rowDescription:
      "Copy this workspace’s theme, accent colour and glass to your other workspaces. Each can still be changed later.",
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
    label: "Archived chats",
    description: "Browse, restore, or delete archived chats.",
    keywords: "history recover unarchive sessions tasks conversations",
  }),
  showArchived: defineSetting({
    section: "archive",
    label: "Show archived in the sidebar",
    description: "Include archived chats in the sidebar.",
    keywords: "history hidden sessions tasks conversations",
    rowDescription: "Keep archived chats listed alongside the active ones.",
  }),
};

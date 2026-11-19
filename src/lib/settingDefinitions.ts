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
  promptsGit: defineSetting({
    section: "prompts",
    label: "Git prompts",
    description:
      "Instructions for pull requests, commits and the merge line's fixes.",
    keywords:
      "prompt instruction create pr pull request commit push resolve conflicts fix checks ci investigate blocked review changes requested agent action custom default",
  }),
  promptsActions: defineSetting({
    section: "prompts",
    label: "Action prompts",
    description:
      "Instructions for commit messages, prompt enhancement and review replies.",
    keywords:
      "prompt instruction commit message wand enhance improve draft sparkle review replies reply thread custom default",
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
      "Extra tools your agents can use: add, sign in to, turn off, or remove MCP servers.",
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
    section: "appearance",
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
    section: "appearance",
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
    section: "appearance",
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
    section: "appearance",
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
    label: "Running mark in the message box",
    description:
      "Show the project's mark running along the message box while an agent works.",
    keywords: "composer pet mascot animation working runner",
    rowDescription:
      "Show the project's mark running along the message box while an agent is working.",
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
  agentsReadAnyTab: defineSetting({
    ...defineStoredSetting<boolean>({
      key: "aven.agentsReadAnyTab",
      ...storedBoolean(true, true),
      changeEvent: "aven:agents-read-any-tab-change",
      storageChanges: true,
    }),
    section: "browser",
    label: "Agents can read any open tab",
    description:
      "Let Claude, Codex and other agents find and read any page open in Aven, including sites you're signed in to, and save it into a project.",
    keywords:
      "privacy agents tabs read pages notion gmail signed in export save copy content claude codex access",
    rowDescription:
      "Agents can find any page you have open in Aven, in any project or window, read it and save it into a project with its images. A bar shows which agent is using which tab. When off, an agent sees only its own project's tabs.",
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
    description: "Take the short tour of Aven again.",
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
    label: "Opacity",
    description:
      "How solid the window is, from Solid to letting the desktop show through.",
    keywords:
      "glass transparency transparent translucent opacity see through solid desktop window background status bar footer include workspace",
    rowDescription:
      "How solid the window is. Lower it to let the desktop show through. Text stays sharp.",
    disabledDescription:
      "Light mode always uses a solid window. Glass applies in dark mode.",
    nativeGlass: true,
  }),
  translucency: defineSetting({
    section: "appearance",
    label: "Translucency",
    description:
      "How clearly the desktop shows through, from frosted to clear.",
    keywords: "glass blur radius frosted frost clear see through desktop",
    rowDescription:
      "How clearly the desktop shows through. Lower it for frosted glass.",
    disabledDescription: "Applies to glass in dark mode.",
    solidDescription: "Lower Opacity to see the desktop through the window.",
    nativeGlass: true,
  }),
  frameTone: defineSetting({
    section: "appearance",
    label: "Frame",
    description: "How dark the sidebar and the rows around your work are.",
    keywords: "dark darker lighter shade tone border brightness sidebar",
    rowDescription: "How dark the sidebar and the rows around your work are.",
    disabledDescription: "Applies in dark mode.",
  }),
  workingMark: defineSetting({
    ...defineStoredSetting<"bot" | "dots">({
      key: "aven.workingMark",
      defaultValue: "bot",
      parse: (raw) => (raw === "dots" ? "dots" : "bot"),
      serialize: (value) => value,
      changeEvent: "aven:working-mark-change",
      storageChanges: true,
    }),
    section: "appearance",
    label: "Working mark",
    description: "What the message box shows while an agent works.",
    keywords:
      "orb bot face dots spinner working busy mascot indicator thinking",
    rowDescription: "What the message box shows while an agent works.",
  }),
  sidebarStyle: defineSetting({
    ...defineStoredSetting<"simple" | "tiles">({
      key: "aven.sidebarStyle",
      defaultValue: "simple",
      parse: (raw) => (raw === "tiles" ? "tiles" : "simple"),
      serialize: (value) => value,
      changeEvent: "aven:sidebar-style-change",
      storageChanges: true,
    }),
    section: "general",
    label: "Sidebar style",
    description:
      "Show projects as names alone, or with a logo and a New chat button.",
    keywords: "sidebar projects logo icon tile super compact simple look",
    rowDescription: "Tiles show each project's logo and a New chat button.",
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
  keybindings: defineSetting({
    section: "keybindings",
    label: "Keyboard shortcuts",
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
  confirmQuit: defineSetting({
    ...defineStoredSetting<boolean>({
      key: "aven.confirmQuit",
      ...storedBoolean(false),
      changeEvent: "aven:confirm-quit-change",
      storageChanges: true,
    }),
    section: "general",
    label: "Ask before quitting",
    description: "Ask before Aven quits, even when nothing is working.",
    keywords: "quit exit close confirm cmd q prompt",
    rowDescription:
      "Ask before Aven quits with Cmd+Q or Quit. Aven always asks while agents work.",
  }),
  confirmCloseWorkingTab: defineSetting({
    ...defineStoredSetting<boolean>({
      key: "aven.confirmCloseWorkingTab",
      ...storedBoolean(false),
      changeEvent: "aven:confirm-close-working-tab-change",
      storageChanges: true,
    }),
    section: "general",
    label: "Ask before closing a working tab",
    description: "Ask before you close a tab while an agent works in it.",
    keywords: "close tab confirm running busy agent working prompt",
    rowDescription:
      "Ask before you close a tab while an agent works in it. The agent keeps working; its chat stays in the sidebar.",
  }),
  copyBase: defineSetting({
    ...defineStoredSetting<"current" | "default">({
      key: "aven.copyBase",
      defaultValue: "current",
      parse: (raw) => (raw === "default" ? "default" : "current"),
      serialize: (value) => value,
      changeEvent: "aven:copy-base-change",
      storageChanges: true,
    }),
    section: "worktrees",
    label: "Start new copies from",
    description: "The commit a new copy of a project starts from.",
    keywords: "worktree copy branch base main default head commit",
    rowDescription:
      "The project's current commit, or its main branch as last fetched.",
  }),
  setupInNewCopies: defineSetting({
    ...defineStoredSetting<boolean>({
      key: "aven.setupInNewCopies",
      ...storedBoolean(true, true),
      changeEvent: "aven:setup-in-new-copies-change",
      storageChanges: true,
    }),
    section: "worktrees",
    label: "Set up new copies",
    description: "Run a project's Setup command when a new copy opens.",
    keywords: "worktree copy setup install script npm automatic",
    rowDescription:
      "Run the project's Setup command the first time a new copy opens, for example to install packages.",
  }),
  removeBuildFolders: defineSetting({
    ...defineStoredSetting<boolean>({
      key: "aven.removeBuildFolders",
      ...storedBoolean(true, true),
      changeEvent: "aven:remove-build-folders-change",
      storageChanges: true,
    }),
    section: "worktrees",
    label: "Remove build folders with a copy",
    description: "Let a copy go with its build folders, such as node_modules.",
    keywords:
      "worktree copy remove delete ignored build node_modules dist target",
    rowDescription:
      "Folders a build makes again (node_modules, .build, build, dist, target) do not stop a removal. Other ignored files, such as .env, still do.",
  }),
  terminalFont: defineSetting({
    ...defineStoredSetting<string>({
      key: "aven.terminalFont",
      defaultValue: "",
      parse: (raw) => (raw && /^[\w .-]{1,40}$/.test(raw) ? raw : ""),
      serialize: (value) => value,
      changeEvent: "aven:terminal-change",
      storageChanges: true,
    }),
    section: "terminal",
    label: "Font",
    description: "The terminal's font.",
    keywords: "terminal font family monospace typeface",
    rowDescription: "A font you do not have falls back to Aven's code font.",
  }),
  terminalFontSize: defineSetting({
    ...defineStoredSetting<number>({
      key: "aven.terminalFontSize",
      defaultValue: 13,
      parse: (raw) => {
        const size = Number(raw);
        return Number.isInteger(size) && size >= 10 && size <= 20 ? size : 13;
      },
      serialize: (value) => String(value),
      changeEvent: "aven:terminal-change",
      storageChanges: true,
    }),
    section: "terminal",
    label: "Text size",
    description: "The size of the terminal's text.",
    keywords: "terminal font size zoom text bigger smaller",
    rowDescription: "The size of text in every terminal.",
  }),
  terminalCursor: defineSetting({
    ...defineStoredSetting<"bar" | "block" | "underline">({
      key: "aven.terminalCursor",
      defaultValue: "bar",
      parse: (raw) => (raw === "block" || raw === "underline" ? raw : "bar"),
      serialize: (value) => value,
      changeEvent: "aven:terminal-change",
      storageChanges: true,
    }),
    section: "terminal",
    label: "Cursor",
    description: "The shape of the terminal's cursor.",
    keywords: "terminal cursor caret bar block underline",
    rowDescription: "The shape of the cursor where you type.",
  }),
  terminalCursorBlink: defineSetting({
    ...defineStoredSetting<boolean>({
      key: "aven.terminalCursorBlink",
      ...storedBoolean(true, true),
      changeEvent: "aven:terminal-change",
      storageChanges: true,
    }),
    section: "terminal",
    label: "Blinking cursor",
    description: "Let the terminal's cursor blink.",
    keywords: "terminal cursor blink flash",
    rowDescription: "Let the cursor blink while the terminal has focus.",
  }),
  chatTextSize: defineSetting({
    ...defineStoredSetting<number>({
      key: "aven.chatTextSize",
      defaultValue: 14,
      parse: (raw) => {
        const size = Number(raw);
        return Number.isInteger(size) && size >= 12 && size <= 18 ? size : 14;
      },
      serialize: (value) => String(value),
      changeEvent: "aven:typography-change",
      storageChanges: true,
    }),
    section: "appearance",
    label: "Chat text size",
    description: "The size of messages and replies in chats.",
    keywords: "font size text bigger smaller reading chat messages typography",
    rowDescription:
      "The size of messages and replies. Interface scale changes everything else.",
  }),
  codeFont: defineSetting({
    ...defineStoredSetting<string>({
      key: "aven.codeFont",
      defaultValue: "",
      parse: (raw) => (raw && /^[\w .-]{1,40}$/.test(raw) ? raw : ""),
      serialize: (value) => value,
      changeEvent: "aven:typography-change",
      storageChanges: true,
    }),
    section: "appearance",
    label: "Code font",
    description: "The font for code, diffs and file contents.",
    keywords: "font monospace code editor diff typeface typography",
    rowDescription:
      "Used for code, diffs and files. The terminal has its own font in Terminal.",
  }),
};

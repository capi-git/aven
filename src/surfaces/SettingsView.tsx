import {
  ArrowDownCircle,
  Check,
  ImagePlus,
  Loader,
  RefreshCw,
  RotateCcw,
  Search,
  X,
  ChevronRight,
} from "../chrome/icons";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { SettingsNav } from "../chrome/SettingsRail";
import {
  settingSearchAnchor,
  subscribeSettingsAnchor,
} from "../lib/settingsSearch";
import {
  GIT_FINISH_BEHAVIOR_DEFAULT,
  GIT_FINISH_BEHAVIOR_OPTIONS,
  loadGitFinishBehavior,
  saveGitFinishBehavior,
  subscribeGitFinishBehavior,
  type GitFinishBehavior,
} from "../lib/gitPreference";
import {
  PageHeader,
  Heading,
  Row,
  Segmented,
  Slider,
  Toggle,
  Select,
  SecondaryButton,
  SettingsGroup,
} from "./SettingsControls";
import "./SettingsView.css";
import {
  AUTOSAVE_DEFAULT,
  loadAutosave,
  saveAutosave,
  subscribeAutosave,
} from "../lib/settings";
import { HarnessIcon } from "../chrome/HarnessIcon";
import { OverlayNav } from "../chrome/TitleBar";
import {
  IS_PERSONAL_BUILD,
  PERSONAL_UPDATE_DESCRIPTION,
} from "../lib/personalBuild";
import { AccessPicker } from "../chrome/AccessPicker";
import {
  loadDefaultRuntimeMode,
  saveDefaultRuntimeMode,
  subscribeDefaultRuntimeMode,
} from "../lib/runtimeMode";
import { InboxProviderMark } from "../chrome/InboxProviderMark";
import { RemoveProjectDialog } from "../chrome/RemoveProjectDialog";
import { WindowControls } from "../chrome/WindowControls";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { useColorScheme } from "../hooks/useColorScheme";
import {
  applyChatBackground,
  applyChatBackgroundOpacity,
  applyChatBackgroundScope,
  CHAT_BACKGROUND_OPACITY_DEFAULT,
  CHAT_BACKGROUND_OPACITY_MAX,
  CHAT_BACKGROUND_OPACITY_MIN,
  CHAT_BACKGROUND_SCOPE_DEFAULT,
  chatBackgroundSrc,
  loadChatBackgroundOpacity,
  loadChatBackgroundPath,
  loadChatBackgroundScope,
  loadTranscriptLayout,
  loadTranscriptAnchor,
  saveChatBackgroundOpacity,
  saveChatBackgroundPath,
  saveChatBackgroundScope,
  saveTranscriptLayout,
  saveTranscriptAnchor,
  TRANSCRIPT_ANCHOR_CHANGE_EVENT,
  SIDEBAR_BLUR_MAX,
  SIDEBAR_BLUR_MIN,
  SIDEBAR_OPACITY_MAX,
  SIDEBAR_OPACITY_MIN,
  type ThemePreference,
  type ChatBackgroundScope,
  type TranscriptLayout,
  applyThemeColors,
} from "../lib/appearance";
import {
  pickAndSaveChatBackground,
  removeChatBackground,
} from "../lib/chatBackground";
import {
  applyUiScale,
  loadUiScale,
  saveUiScale,
  subscribeUiScale,
  UI_SCALE_DEFAULT,
  UI_SCALE_PERCENTS,
} from "../lib/uiScale";
import {
  getHarnessAvailabilitySnapshot,
  hasProbedHarnessAvailability,
  harnessUnavailableHint,
  isHarnessAvailable,
  probeHarnessAvailability,
  subscribeHarnessAvailability,
} from "../lib/harness/availability";
import { refreshHarnessCatalogs } from "../lib/harness/registry";
import {
  loadProviderToolAutoUpdates,
  saveProviderToolAutoUpdates,
  subscribeProviderToolAutoUpdates,
} from "../lib/providerToolUpdates";
import {
  defaultSessionChoice,
  getModelSnapshot,
  getPickerVisibilitySnapshot,
  isPickerProviderVisible,
  modelsFor,
  pickerModelsFor,
  preferredModelId,
  saveDefaultModel,
  saveLastModelChoice,
  savePickerProviderVisible,
  savePickerModelVisible,
  showAllPickerModels,
  subscribeModels,
  subscribePickerVisibility,
} from "../lib/models";
import { prettyCwd, projectKey, projectName } from "../lib/paths";
import { HAS_NATIVE_GLASS, IS_MAC } from "../lib/platform";
import {
  loadArchivedProjects,
  looksLikeProject,
  subscribeArchivedProjects,
  type ArchivedProject,
} from "../lib/recents";
import {
  HARNESSES,
  HARNESS_TITLE,
  sessionDisplayTitle,
  type HarnessId,
} from "../lib/session";
import {
  loadSessionSidebarFilters,
  saveSessionSidebarFilters,
} from "../lib/sessionFilters";
import type { SessionSummary } from "../lib/sessionStore";
import { clearInboxCache } from "../lib/githubTasks";
import {
  disconnectLinear,
  LINEAR_CHANGE_EVENT,
  linearConnected,
  listLinearTeams,
  loadHiddenLinearTeamIds,
  notifyLinearChange,
  saveHiddenLinearTeamIds,
  saveLinearToken,
  type LinearTeam,
} from "../lib/linear";
import { loadTabGroupLabels, resolveTabGroupLabel } from "../lib/tabGroups";
import {
  filterKeybindings,
  formatKeybindingContext,
  KEYBINDINGS,
  BROWSER_BUBBLE_DEFAULT,
  BROWSER_MEMORY_SAVER_DEFAULT,
  loadBrowserBubble,
  loadBrowserMemorySaver,
  loadBrowserLowMemory,
  loadClaudeHooks,
  loadComposerRunner,
  loadDiffViewer,
  loadFollowUpBehavior,
  loadGridArcadeEnabled,
  loadLiveAgentsEnabled,
  loadNotesEnabled,
  saveClaudeHooks,
  saveComposerRunner,
  saveDiffViewer,
  saveFollowUpBehavior,
  saveGridArcadeEnabled,
  saveLiveAgentsEnabled,
  saveNotesEnabled,
  saveBrowserBubble,
  saveBrowserMemorySaver,
  subscribeBrowserBubble,
  subscribeBrowserMemorySaver,
  saveBrowserLowMemory,
  subscribeBrowserLowMemory,
  BROWSER_LOW_MEMORY_DEFAULT,
  settingsSectionDescription,
  settingsSectionLabel,
  type DiffViewer,
  type FollowUpBehavior,
  type SettingsSectionId,
} from "../lib/settings";
import {
  browserEngineRestartNeeded,
  subscribeBrowserEngineRestart,
} from "../lib/browserEngine";
import { loadSoundsEnabled, saveSoundsEnabled } from "../lib/sounds";
import {
  cachedNotificationPermission,
  loadNotificationsEnabled,
  loadNotificationPreferences,
  saveNotificationPreferences,
  NOTIFICATION_PREFERENCES_EVENT,
  type NotificationPreferences,
  openNotificationSettings,
  probeNotificationPermission,
  requestNotificationPermission,
  saveNotificationsEnabled,
  type NotificationPermission,
} from "../lib/notifications";
import { ApplyWorkspaceThemeButton } from "../chrome/ApplyWorkspaceThemeButton";
import {
  resolvedWorkspaceColors,
  resetWorkspaceTheme,
  saveWorkspaceColor,
  saveWorkspaceTheme,
  type WorkspaceColorTarget,
  useActiveWorkspaceTheme,
} from "../lib/workspaceThemes";
import {
  installPendingUpdate,
  runUpdateFlow,
  getUpdaterSnapshot,
  subscribeUpdater,
} from "../lib/updater";
import { SkillsSettings } from "./SkillsSettings";
import { SettingsColorPicker } from "./SettingsColorPicker";
import { ProviderConnections } from "./ProviderConnections";
import { ProviderSetup } from "./ProviderSetup";

type Props = {
  section: SettingsSectionId;
  onSelectSection?: (section: SettingsSectionId) => void;
  workspaceName?: string;
  cwd: string;
  sessions: SessionSummary[];
  besideRail?: boolean;
  /** False when the workspace window bar provides Settings navigation. */
  showToolbar?: boolean;
  onToggleSidebar?: () => void;
  onClose: () => void;
  onOpenSession: (sessionId: string) => void;
  onArchiveSession: (sessionId: string, archived: boolean) => void;
  onDeleteSession: (sessionId: string) => void;
  onRestoreProject?: (path: string) => void;
  onDeleteProject?: (path: string) => void;
  onOpenWhatsNew: (version: string) => void;
};

export function SettingsView({
  section: requestedSection,
  onSelectSection,
  workspaceName = "Current workspace",
  cwd,
  sessions,
  besideRail = false,
  showToolbar = true,
  onToggleSidebar,
  onClose,
  onOpenSession,
  onArchiveSession,
  onDeleteSession,
  onRestoreProject,
  onDeleteProject,
  onOpenWhatsNew,
}: Props) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const setScrollRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollRef.current = node;
      lockOverscroll(node);
    },
    [lockOverscroll],
  );
  const [localSection, setLocalSection] = useState(requestedSection);
  const section = onSelectSection ? requestedSection : localSection;
  // A fresh object per pick, so choosing the same result again still reveals it.
  const [pendingAnchor, setPendingAnchor] = useState<{ id: string } | null>(
    null,
  );
  const searchDestination = useRef<SettingsSectionId | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const appearance = useAppearanceSettings();
  useEffect(() => {
    setLocalSection(requestedSection);
    if (searchDestination.current !== requestedSection) setPendingAnchor(null);
    searchDestination.current = null;
  }, [requestedSection]);

  // The sidebar search names the setting to reveal once its page is open.
  useEffect(
    () =>
      subscribeSettingsAnchor((id, destination) => {
        searchDestination.current = destination;
        setPendingAnchor({ id });
      }),
    [],
  );
  const selectSection = (next: SettingsSectionId) => {
    // A search pick has already named its anchor; plain navigation clears it.
    if (searchDestination.current !== next) {
      searchDestination.current = null;
      setPendingAnchor(null);
    }
    if (onSelectSection) onSelectSection(next);
    else setLocalSection(next);
  };

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [section]);

  useEffect(() => {
    if (!pendingAnchor) return;
    const target = document.getElementById(pendingAnchor.id);
    if (!target) return;
    searchDestination.current = null;
    target.scrollIntoView?.({ block: "center" });
    target.focus({ preventScroll: true });
    target.dataset.searchMatch = "true";
    const timer = window.setTimeout(
      () => delete target.dataset.searchMatch,
      2400,
    );
    return () => {
      window.clearTimeout(timer);
      delete target.dataset.searchMatch;
    };
  }, [pendingAnchor, section]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape") return;
      // Portaled menus and dialogs own their dismissal before Settings does.
      if (
        document.querySelector(
          '[role="dialog"], [role="alertdialog"], [role="menu"]',
        )
      )
        return;
      event.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      role="region"
      aria-label="Settings"
      data-app-settings
      className="settings-view"
    >
      {showToolbar ? (
        <div className="settings-toolbar" data-tauri-drag-region="deep">
          {IS_MAC && !besideRail ? <div className="w-[78px] shrink-0" /> : null}
          <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />
          <div className="settings-breadcrumb">
            <span>Settings</span>
            <ChevronRight aria-hidden className="size-3" />
            <span>{settingsSectionLabel(section)}</span>
          </div>
          <button
            type="button"
            className="settings-close"
            aria-label="Close settings"
            onClick={onClose}
            data-tauri-drag-region="false"
          >
            <X className="size-4" aria-hidden />
          </button>
          {IS_MAC ? null : <WindowControls />}
        </div>
      ) : null}
      <div className="settings-layout" data-embedded-nav={!besideRail}>
        {!besideRail ? (
          <aside
            className="settings-navigation"
            aria-label="Settings categories"
          >
            <div className="settings-navigation-title">Settings</div>
            <SettingsNav
              embedded
              section={section}
              onSelect={selectSection}
              onClose={onClose}
            />
            <p className="settings-navigation-note">
              Make Aven feel like yours.
            </p>
          </aside>
        ) : null}
        <div ref={setScrollRef} className="settings-scroll">
          <div key={section} className="settings-content">
            <div className="settings-page-top">
              <PageHeader
                title={settingsSectionLabel(section)}
                description={settingsSectionDescription(section)}
              />
            </div>
            <div className="settings-scope-line">
              <span className="settings-scope-dot" aria-hidden />
              <span>
                {section === "appearance" ? workspaceName : "On this device"}
              </span>
              <span className="settings-scope-hint">
                {section === "appearance"
                  ? "Workspace colors · device display preferences"
                  : section === "skills"
                    ? "Project instructions · device tools"
                    : section === "connections"
                      ? "Provider connections for this project · device services"
                      : "Your preferences are saved automatically"}
              </span>
            </div>
            {isPreferencesSection(section) ? (
              <PreferencesPage page={section} onOpenWhatsNew={onOpenWhatsNew} />
            ) : null}
            {section === "appearance" ? (
              <AppearancePage appearance={appearance} />
            ) : null}
            {section === "keybindings" ? <KeybindingsPage /> : null}
            {section === "git" ? <GitPage /> : null}
            {section === "providers" ? <ProvidersPage /> : null}
            {section === "provider-setup" ? (
              <div id="setting-provider-setup" tabIndex={-1}>
                <ProviderSetup />
              </div>
            ) : null}
            {section === "skills" ? <SkillsSettings cwd={cwd} /> : null}
            {section === "connections" ? <ConnectionsPage cwd={cwd} /> : null}
            {section === "archive" ? (
              <ArchivePage
                cwd={cwd}
                sessions={sessions}
                onOpenSession={onOpenSession}
                onArchiveSession={onArchiveSession}
                onDeleteSession={onDeleteSession}
                onRestoreProject={onRestoreProject}
                onDeleteProject={onDeleteProject}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

type PreferencesSection = Extract<
  SettingsSectionId,
  "general" | "notifications" | "tasks" | "browser"
>;

function isPreferencesSection(
  section: SettingsSectionId,
): section is PreferencesSection {
  return (
    section === "general" ||
    section === "notifications" ||
    section === "tasks" ||
    section === "browser"
  );
}

/** What agents do with their work once they finish, in every project. */
function GitPage() {
  const behavior = useSyncExternalStore(
    subscribeGitFinishBehavior,
    loadGitFinishBehavior,
    () => GIT_FINISH_BEHAVIOR_DEFAULT,
  );
  const selected = GIT_FINISH_BEHAVIOR_OPTIONS.find(
    (option) => option.value === behavior,
  );
  return (
    <SettingsGroup
      title="Agents and Git"
      description="Applies to every agent in every project from its next turn. Asking for something different in a chat still wins."
      scope="Device"
    >
      <Row label="When an agent finishes" description={selected?.description}>
        <Select
          label="When an agent finishes"
          value={behavior}
          options={GIT_FINISH_BEHAVIOR_OPTIONS.map(({ value, label }) => ({
            value,
            label,
          }))}
          onChange={(value) =>
            saveGitFinishBehavior(value as GitFinishBehavior)
          }
        />
      </Row>
    </SettingsGroup>
  );
}

/** The device preferences that used to share one General page, one page each. */
function PreferencesPage({
  page,
  onOpenWhatsNew,
}: {
  page: PreferencesSection;
  onOpenWhatsNew: (version: string) => void;
}) {
  const defaultAccess = useSyncExternalStore(
    subscribeDefaultRuntimeMode,
    loadDefaultRuntimeMode,
    loadDefaultRuntimeMode,
  );
  const [transcriptLayout, setTranscriptLayout] =
    useState<TranscriptLayout>(loadTranscriptLayout);
  const [transcriptAnchor, setTranscriptAnchor] =
    useState(loadTranscriptAnchor);
  const [diffViewer, setDiffViewer] = useState<DiffViewer>(loadDiffViewer);
  const [followUpBehavior, setFollowUpBehavior] =
    useState<FollowUpBehavior>(loadFollowUpBehavior);
  const [composerRunner, setComposerRunner] = useState(loadComposerRunner);
  const [gridArcadeEnabled, setGridArcadeEnabled] = useState(
    loadGridArcadeEnabled,
  );
  const [notesEnabled, setNotesEnabled] = useState(loadNotesEnabled);
  const browserMemorySaver = useSyncExternalStore(
    subscribeBrowserMemorySaver,
    loadBrowserMemorySaver,
    () => BROWSER_MEMORY_SAVER_DEFAULT,
  );
  const browserBubble = useSyncExternalStore(
    subscribeBrowserBubble,
    loadBrowserBubble,
    () => BROWSER_BUBBLE_DEFAULT,
  );
  const browserLowMemory = useSyncExternalStore(
    subscribeBrowserLowMemory,
    loadBrowserLowMemory,
    () => BROWSER_LOW_MEMORY_DEFAULT,
  );
  const browserEngineRestart = useSyncExternalStore(
    subscribeBrowserEngineRestart,
    browserEngineRestartNeeded,
    () => false,
  );
  const [liveAgentsEnabled, setLiveAgentsEnabled] = useState(
    loadLiveAgentsEnabled,
  );
  const [soundsEnabled, setSoundsEnabled] = useState(loadSoundsEnabled);
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    loadNotificationsEnabled,
  );
  const [notificationPreferences, setNotificationPreferences] = useState(
    loadNotificationPreferences,
  );
  useEffect(() => {
    const refresh = () =>
      setNotificationPreferences(loadNotificationPreferences());
    window.addEventListener(NOTIFICATION_PREFERENCES_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(NOTIFICATION_PREFERENCES_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  const onNotificationPreference = (
    key: keyof NotificationPreferences,
    value: boolean,
  ) => {
    saveNotificationPreferences({ [key]: value });
    setNotificationPreferences(loadNotificationPreferences());
  };
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermission>(cachedNotificationPermission);
  const [claudeHooks, setClaudeHooks] = useState(loadClaudeHooks);

  // The user may flip the switch in System Settings and come back: re-read
  // the OS state whenever the window regains focus while the toggle is on.
  useEffect(() => {
    if (!notificationsEnabled || page !== "notifications") return;
    const refresh = () => {
      void probeNotificationPermission().then(setNotificationPermission);
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [notificationsEnabled, page]);

  useEffect(() => {
    const onAnchor = (event: Event) => {
      setTranscriptAnchor((event as CustomEvent<boolean>).detail === true);
    };
    window.addEventListener(TRANSCRIPT_ANCHOR_CHANGE_EVENT, onAnchor);
    return () => {
      window.removeEventListener(TRANSCRIPT_ANCHOR_CHANGE_EVENT, onAnchor);
    };
  }, []);

  const onTranscriptLayout = (next: TranscriptLayout) => {
    saveTranscriptLayout(next);
    setTranscriptLayout(next);
  };

  const onTranscriptAnchor = (next: boolean) => {
    saveTranscriptAnchor(next);
    setTranscriptAnchor(next);
  };

  const onDiffViewer = (next: DiffViewer) => {
    saveDiffViewer(next);
    setDiffViewer(next);
  };

  const onFollowUpBehavior = (next: FollowUpBehavior) => {
    saveFollowUpBehavior(next);
    setFollowUpBehavior(next);
  };

  const onComposerRunner = (next: boolean) => {
    saveComposerRunner(next);
    setComposerRunner(next);
  };

  const onGridArcadeEnabled = (next: boolean) => {
    saveGridArcadeEnabled(next);
    setGridArcadeEnabled(next);
  };

  const onNotesEnabled = (next: boolean) => {
    saveNotesEnabled(next);
    setNotesEnabled(next);
  };

  const onLiveAgentsEnabled = (next: boolean) => {
    saveLiveAgentsEnabled(next);
    setLiveAgentsEnabled(next);
  };

  const onSoundsEnabled = (next: boolean) => {
    saveSoundsEnabled(next);
    setSoundsEnabled(next);
  };

  const onNotificationsEnabled = (next: boolean) => {
    saveNotificationsEnabled(next);
    setNotificationsEnabled(next);
    if (!next) return;
    void requestNotificationPermission().then(setNotificationPermission);
  };

  const onClaudeHooks = (next: boolean) => {
    saveClaudeHooks(next);
    setClaudeHooks(next);
  };

  const workspaceGroup = (
    <SettingsGroup
      title="Project rail &amp; extras"
      description="Choose what appears around your work."
      scope="Device"
    >
      <Row
        label="Notes"
        description="Keep reusable notes in the sidebar. Add them to a conversation with @note."
      >
        <Toggle label="Notes" on={notesEnabled} onChange={onNotesEnabled} />
      </Row>
      <Row
        label="Working agents"
        description="Show running agents together in the sidebar when multiple tasks are active."
      >
        <Toggle
          label="Working agents"
          on={liveAgentsEnabled}
          onChange={onLiveAgentsEnabled}
        />
      </Row>
      <Row
        label="Composer mascot"
        description="Show a small animated mascot while an agent is working."
      >
        <Toggle
          label="Composer mascot"
          on={composerRunner}
          onChange={onComposerRunner}
        />
      </Row>
      <Row
        label="Empty session games"
        description="Show interactive games in empty sessions. Turn off for a quieter workspace."
      >
        <Toggle
          label="Empty session games"
          on={gridArcadeEnabled}
          onChange={onGridArcadeEnabled}
        />
      </Row>
    </SettingsGroup>
  );

  const notificationsGroup = (
    <SettingsGroup
      title="Alerts &amp; sound"
      description="Decide what needs your attention."
      scope="Device"
    >
      <Row
        label="Notifications"
        description="Send macOS notifications when a task needs attention while you are elsewhere. Activity keeps a local history even when these are off."
      >
        {notificationsEnabled && notificationPermission === "denied" ? (
          <NotificationsBlocked />
        ) : null}
        {notificationsEnabled && notificationPermission === "unsupported" ? (
          <span className="text-[12px] text-content/45">
            Not available on this platform
          </span>
        ) : null}
        <Toggle
          label="Notifications"
          on={notificationsEnabled}
          onChange={onNotificationsEnabled}
        />
      </Row>
      <Row
        label="Activity alerts"
        description="Choose which outcomes can interrupt you. Every outcome still appears in Activity."
      >
        <div className="settings-alert-options">
          {(
            [
              ["needsInput", "Needs input"],
              ["failures", "Failures"],
              ["finished", "Finished / stopped"],
              ["sound", "Sound"],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              className="flex items-center gap-2 text-[11px] text-content/65"
            >
              {label}
              <Toggle
                label={`Activity: ${label}`}
                on={notificationPreferences[key]}
                onChange={(value) => onNotificationPreference(key, value)}
              />
            </label>
          ))}
        </div>
      </Row>
      <Row
        label="Quiet mode"
        description="Keep recording Activity without task banners or task sounds. Your other sound settings stay unchanged."
      >
        <Toggle
          label="Quiet mode"
          on={notificationPreferences.quiet}
          onChange={(value) => onNotificationPreference("quiet", value)}
        />
      </Row>
      <Row
        label="Sounds"
        description="Play short cues for task completion, inbox items, updates, and interactions."
      >
        <Toggle label="Sounds" on={soundsEnabled} onChange={onSoundsEnabled} />
      </Row>
    </SettingsGroup>
  );

  if (page === "general")
    return (
      <>
        {workspaceGroup}
        <SettingsGroup
          title="About Aven"
          description="Your installed version and software updates."
          scope="Device"
        >
          <UpdateRow onOpenWhatsNew={onOpenWhatsNew} />
        </SettingsGroup>
      </>
    );

  if (page === "browser")
    return (
      <>
      <SettingsGroup
        title="Aven bubble"
        description="Ask your chat about the page you're on."
        scope="Device"
      >
        <Row
          label="Show the bubble on web pages"
          description="A small Aven bubble floats at the bottom of the page. Click it to ask the chat in this workspace; the answer appears above it."
        >
          <Toggle
            label="Show the bubble on web pages"
            on={browserBubble}
            onChange={saveBrowserBubble}
          />
        </Row>
      </SettingsGroup>
      <SettingsGroup
        title="Memory"
        description="Keep browser tabs ready while managing memory."
        scope="Device"
      >
        <Row
          label="Memory saver"
          description="Keep your three most recent browser tabs ready. Older inactive tabs can sleep after five minutes and reload when reopened. Pages in use stay awake."
        >
          <Toggle
            label="Memory saver"
            on={browserMemorySaver}
            onChange={saveBrowserMemorySaver}
          />
        </Row>
        <Row
          label="Lightweight browser"
          description={
            browserEngineRestart
              ? "Uses Chromium's reduced-memory mode for web pages. Restart Aven to apply this change."
              : "Uses Chromium's reduced-memory mode for web pages. With Memory saver on, keeps only your most recent inactive tab ready and sleeps others after two minutes. For laptops with little memory; the engine mode applies when Aven starts."
          }
        >
          <Toggle
            label="Lightweight browser"
            on={browserLowMemory}
            onChange={saveBrowserLowMemory}
          />
        </Row>
      </SettingsGroup>
      </>
    );

  if (page === "notifications") return notificationsGroup;

  return (
    <>
      <SettingsGroup
        title="Tasks"
        description="Task defaults and behavior."
        scope="Device"
      >
        <Row
          label="Default task access"
          description="Applies to new tasks. Existing tasks keep their own access setting."
        >
          <AccessPicker value={defaultAccess} onChange={saveDefaultRuntimeMode} />
        </Row>
        <Row
          label="Follow-up behavior"
          description="Queue follow-ups until the active turn finishes, or steer the active turn immediately."
        >
          <Segmented
            label="Follow-up behavior"
            value={followUpBehavior}
            options={[
              { value: "queue", label: "Queue" },
              { value: "steer", label: "Steer" },
            ]}
            onChange={onFollowUpBehavior}
          />
        </Row>
        <Row
          label="Claude Code hooks"
          description="Run your configured Claude Code hooks. Changes apply on the next turn."
        >
          <Toggle
            label="Claude Code hooks"
            on={claudeHooks}
            onChange={onClaudeHooks}
          />
        </Row>
      </SettingsGroup>
      <SettingsGroup
        title="Conversation &amp; review"
        description="Read and review in the way that works for you."
        scope="Device"
      >
        <Row
          label="Transcript layout"
          description="Choose full-width prompts or a familiar chat layout."
        >
          <Segmented
            label="Transcript layout"
            value={transcriptLayout}
            options={[
              { value: "full", label: "Full width" },
              { value: "chat", label: "Chat" },
            ]}
            onChange={onTranscriptLayout}
          />
        </Row>
        <Row
          label="Anchor prompts to top"
          description="Keep your latest prompt at the top while the response grows below it."
        >
          <Toggle
            label="Anchor prompts to top"
            on={transcriptAnchor}
            onChange={onTranscriptAnchor}
          />
        </Row>
        <Row
          label="Diff view"
          description="Review changes in the editor or together in one unified view."
        >
          <Segmented
            label="Diff view"
            value={diffViewer}
            options={[
              { value: "editor", label: "Editor" },
              { value: "unified", label: "Unified" },
            ]}
            onChange={onDiffViewer}
          />
        </Row>
        <AutosaveRow />
      </SettingsGroup>
    </>
  );
}

function AutosaveRow() {
  const autosave = useSyncExternalStore(
    subscribeAutosave,
    loadAutosave,
    () => AUTOSAVE_DEFAULT,
  );
  return (
    <Row
      label="Autosave files"
      description="Save edited files shortly after you stop typing."
    >
      <Toggle
        label="Autosave files"
        on={autosave}
        onChange={(next) => void saveAutosave(next)}
      />
    </Row>
  );
}

/** Agent connections come from each provider; Linear is Aven's own. */
function ConnectionsPage({ cwd }: { cwd: string }) {
  return (
    <>
      <SettingsGroup
        title="Agent connections"
        id={settingSearchAnchor("Agent connections")}
        description="Add, remove, and sign in to the MCP servers Claude and Codex can reach. Each provider keeps its own settings and sign-in."
        scope="Project"
      >
        <ProviderConnections cwd={cwd} />
      </SettingsGroup>
      <SettingsGroup
        title="Linear"
        description="Bring Linear issues into your inbox."
        scope="Device"
      >
        <div id="setting-linear-api-key" tabIndex={-1}>
          <LinearSettings />
        </div>
      </SettingsGroup>
    </>
  );
}

function LinearSettings() {
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [teams, setTeams] = useState<LinearTeam[]>([]);
  const [hiddenTeamIds, setHiddenTeamIds] = useState(loadHiddenLinearTeamIds);

  const loadTeams = useCallback(async () => {
    try {
      const next = await listLinearTeams();
      setTeams(next);
    } catch {
      setTeams([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void linearConnected().then((status) => {
      if (cancelled) return;
      setConnected(status.connected);
      if (status.connected) void loadTeams();
    });
    return () => {
      cancelled = true;
    };
  }, [loadTeams]);

  // The inbox filter menu writes the same list, so follow it while both are mounted.
  useEffect(() => {
    const onChange = () => setHiddenTeamIds(loadHiddenLinearTeamIds());
    window.addEventListener(LINEAR_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(LINEAR_CHANGE_EVENT, onChange);
  }, []);

  const onSave = async () => {
    if (!token.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveLinearToken(token);
      setToken("");
      setConnected(true);
      clearInboxCache();
      notifyLinearChange();
      await loadTeams();
    } catch (err: unknown) {
      setConnected(false);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onDisconnect = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await disconnectLinear();
      setConnected(false);
      setTeams([]);
      clearInboxCache();
      notifyLinearChange();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleTeam = (id: string) => {
    const next = new Set(hiddenTeamIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    const ids = [...next];
    setHiddenTeamIds(ids);
    saveHiddenLinearTeamIds(ids);
    clearInboxCache();
  };

  return (
    <>
      <Row
        label={
          <span className="flex items-center gap-2">
            <InboxProviderMark provider="linear" className="size-4 shrink-0" />
            API key
          </span>
        }
        description="Create a personal API key in Linear → Settings → Security & Access. Disconnect deletes it."
      >
        {connected ? (
          <SecondaryButton onClick={() => void onDisconnect()} disabled={busy}>
            Disconnect
          </SecondaryButton>
        ) : (
          <div className="flex items-center gap-2">
            <label className="flex h-7 w-52 shrink-0 items-center rounded-md border border-content/10 px-2 focus-within:border-content/20">
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void onSave();
                }}
                placeholder="lin_api_…"
                aria-label="Linear API key"
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent text-[12px] text-content outline-none placeholder:text-content/35 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/60"
              />
            </label>
            <SecondaryButton
              onClick={() => void onSave()}
              disabled={busy || !token.trim()}
            >
              {busy ? "Saving" : "Connect"}
            </SecondaryButton>
          </div>
        )}
      </Row>
      {error ? (
        <p className="pb-2 text-[12px] text-red-400/90">{error}</p>
      ) : null}
      {connected && teams.length > 0 ? (
        <div className="border-b border-content/5 py-4">
          <div className="text-[13px] font-medium text-content">
            Linear Teams
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-content/45">
            Unchecked teams stay out of the inbox.
          </p>
          <div className="mt-3 flex flex-col gap-0.5 -mx-2">
            {teams.map((team) => {
              const checked = !hiddenTeamIds.includes(team.id);
              return (
                <button
                  key={team.id}
                  type="button"
                  onClick={() => toggleTeam(team.id)}
                  className="flex h-7 items-center gap-2 rounded-md px-2 text-left text-[13px] text-content hover:bg-content/5"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {team.name}
                    {team.key ? (
                      <span className="ml-1.5 text-content/40">{team.key}</span>
                    ) : null}
                  </span>
                  {checked ? (
                    <Check className="size-3.5 shrink-0" strokeWidth={2.25} />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </>
  );
}

function UpdateRow({
  onOpenWhatsNew,
}: {
  onOpenWhatsNew: (version: string) => void;
}) {
  const snapshot = useSyncExternalStore(
    subscribeUpdater,
    getUpdaterSnapshot,
    getUpdaterSnapshot,
  );
  const busy = ["checking", "downloading", "installing"].includes(
    snapshot.phase,
  );
  const hasUpdate = snapshot.phase === "ready";
  const onClick = async () => {
    if (busy) return;
    if (hasUpdate) await installPendingUpdate();
    else await runUpdateFlow(true);
  };

  const status = snapshot.developmentBuild
    ? "Aven Dev runs from your source checkout. Rebuild and restart this preview to use your latest changes."
    : IS_PERSONAL_BUILD
      ? PERSONAL_UPDATE_DESCRIPTION
      : snapshot.phase === "ready"
        ? (snapshot.error ??
          `Version ${snapshot.availableVersion} is downloaded and ready. Restart when your tasks are finished.`)
        : snapshot.phase === "installing"
          ? "Saving your workspace and restarting…"
          : snapshot.phase === "available"
            ? `Version ${snapshot.availableVersion} is available.`
            : snapshot.phase === "downloading"
              ? `Downloading${snapshot.progress != null ? ` ${snapshot.progress}%` : "…"}`
              : snapshot.phase === "checking"
                ? "Checking for updates…"
                : snapshot.phase === "current"
                  ? "You're on the latest version."
                  : snapshot.phase === "error"
                    ? (snapshot.error ?? "Update check failed.")
                    : "Updates download automatically. You choose when to restart.";

  return (
    <Row
      id="setting-version"
      label={
        <span className="flex items-baseline gap-2">
          Version
          <span className="font-mono text-[12px] text-content/45">
            {snapshot.currentVersion}
          </span>
        </span>
      }
      description={status}
    >
      <div className="flex items-center gap-2">
        <SecondaryButton
          onClick={() => onOpenWhatsNew(snapshot.currentVersion)}
          disabled={snapshot.currentVersion === "…"}
        >
          What's new
        </SecondaryButton>
        <SecondaryButton onClick={() => void onClick()} disabled={busy}>
          {busy ? (
            <Loader className="size-3.5 animate-spin" aria-hidden />
          ) : hasUpdate ? (
            <ArrowDownCircle className="size-3.5 text-accent" aria-hidden />
          ) : (
            <RefreshCw className="size-3.5" strokeWidth={1.75} aria-hidden />
          )}
          {snapshot.developmentBuild
            ? "Development info"
            : IS_PERSONAL_BUILD
              ? "Update information"
              : hasUpdate
                ? "Restart to update"
                : "Check for updates"}
        </SecondaryButton>
      </div>
    </Row>
  );
}

type AppearanceSettings = ReturnType<typeof useAppearanceSettings>;

function useAppearanceSettings() {
  const { profileId, theme } = useActiveWorkspaceTheme();
  const colorScheme = useColorScheme();
  const colors = resolvedWorkspaceColors(theme, colorScheme);
  const themePreference = theme.preference;
  const { opacity, blur, bodyGlass, matchPanels } = theme;
  const [chatBackgroundPath, setChatBackgroundPath] = useState(
    loadChatBackgroundPath,
  );
  const [chatBackgroundOpacity, setChatBackgroundOpacity] = useState(
    loadChatBackgroundOpacity,
  );
  const [chatBackgroundScope, setChatBackgroundScope] =
    useState<ChatBackgroundScope>(loadChatBackgroundScope);
  const [chatBackgroundBusy, setChatBackgroundBusy] = useState(false);
  const [chatBackgroundError, setChatBackgroundError] = useState<string | null>(
    null,
  );
  const [uiScale, setUiScale] = useState(loadUiScale);

  useEffect(() => subscribeUiScale(() => setUiScale(loadUiScale())), []);

  const onThemePreference = useCallback(
    (next: ThemePreference) => {
      saveWorkspaceTheme(profileId, { preference: next });
    },
    [profileId],
  );

  const onOpacity = useCallback(
    (percent: number) => {
      saveWorkspaceTheme(profileId, { opacity: percent / 100 });
    },
    [profileId],
  );

  const onBlur = useCallback(
    (radius: number) => {
      saveWorkspaceTheme(profileId, { blur: radius });
    },
    [profileId],
  );

  const onColor = useCallback(
    (target: WorkspaceColorTarget, color: string) => {
      saveWorkspaceColor(profileId, colorScheme, target, color);
    },
    [profileId, colorScheme],
  );

  /** Repaints this window only; the drag saves once when released. */
  const onPreviewColor = useCallback(
    (target: WorkspaceColorTarget, color: string) => {
      applyThemeColors({
        ...theme.colors,
        [colorScheme]: { ...theme.colors?.[colorScheme], [target]: color },
      });
    },
    [theme.colors, colorScheme],
  );

  const onBodyGlass = useCallback(
    (next: boolean) => {
      saveWorkspaceTheme(profileId, { bodyGlass: next });
    },
    [profileId],
  );

  const onMatchPanels = useCallback(
    (next: boolean) => saveWorkspaceTheme(profileId, { matchPanels: next }),
    [profileId],
  );

  const onChooseChatBackground = useCallback(async () => {
    setChatBackgroundBusy(true);
    setChatBackgroundError(null);
    try {
      const path = await pickAndSaveChatBackground();
      if (!path) return;
      saveChatBackgroundPath(path);
      applyChatBackground(path);
      setChatBackgroundPath(path);
    } catch (error) {
      setChatBackgroundError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setChatBackgroundBusy(false);
    }
  }, []);

  const onClearChatBackground = useCallback(async () => {
    setChatBackgroundBusy(true);
    setChatBackgroundError(null);
    try {
      await removeChatBackground();
      saveChatBackgroundPath(null);
      applyChatBackground(null);
      setChatBackgroundPath(null);
    } catch (error) {
      setChatBackgroundError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setChatBackgroundBusy(false);
    }
  }, []);

  const onChatBackgroundOpacity = useCallback((percent: number) => {
    const next = applyChatBackgroundOpacity(percent / 100);
    saveChatBackgroundOpacity(next);
    setChatBackgroundOpacity(next);
  }, []);

  const onChatBackgroundScope = useCallback((next: ChatBackgroundScope) => {
    applyChatBackgroundScope(next);
    saveChatBackgroundScope(next);
    setChatBackgroundScope(next);
  }, []);

  const onUiScale = useCallback((percent: number) => {
    const next = saveUiScale(percent / 100);
    setUiScale(next);
    void applyUiScale(next);
  }, []);

  const restoreDefaults = useCallback(() => {
    resetWorkspaceTheme(profileId);
    onChatBackgroundOpacity(Math.round(CHAT_BACKGROUND_OPACITY_DEFAULT * 100));
    onChatBackgroundScope(CHAT_BACKGROUND_SCOPE_DEFAULT);
    if (chatBackgroundPath) void onClearChatBackground();
    onUiScale(Math.round(UI_SCALE_DEFAULT * 100));
  }, [
    chatBackgroundPath,
    onChatBackgroundOpacity,
    onChatBackgroundScope,
    onClearChatBackground,
    onUiScale,
    profileId,
  ]);

  return {
    profileId,
    themePreference,
    colorScheme,
    colors,
    opacity,
    blur,
    bodyGlass,
    matchPanels,
    chatBackgroundPath,
    chatBackgroundOpacity,
    chatBackgroundScope,
    chatBackgroundBusy,
    chatBackgroundError,
    uiScale,
    onThemePreference,
    onOpacity,
    onBlur,
    onColor,
    onPreviewColor,
    onBodyGlass,
    onMatchPanels,
    onChooseChatBackground,
    onClearChatBackground,
    onChatBackgroundOpacity,
    onChatBackgroundScope,
    onUiScale,
    restoreDefaults,
  };
}

const COLOR_TARGETS = [
  { value: "background", label: "Background" },
  { value: "accent", label: "Accent" },
  { value: "highlight", label: "Highlight" },
] as const satisfies readonly {
  value: WorkspaceColorTarget;
  label: string;
}[];

function AppearancePage({ appearance }: { appearance: AppearanceSettings }) {
  const [colorTarget, setColorTarget] =
    useState<WorkspaceColorTarget>("background");
  const percent = Math.round(appearance.opacity * 100);
  const glassDisabled = appearance.colorScheme === "light";
  return (
    <>
      <SettingsGroup
        title="Theme &amp; color"
        description="Set the mood for this workspace."
        scope="Workspace"
      >
        <Row
          label="Theme"
          description="Follow your system, or choose a light or dark appearance."
        >
          <Segmented
            label="Theme"
            value={appearance.themePreference}
            options={[
              { value: "system", label: "System" },
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
            ]}
            onChange={appearance.onThemePreference}
          />
        </Row>
        <div id="setting-workspace-colors" tabIndex={-1}>
          <SettingsColorPicker
            targets={COLOR_TARGETS}
            target={colorTarget}
            onTarget={setColorTarget}
            colors={appearance.colors}
            onChange={appearance.onColor}
            onPreview={appearance.onPreviewColor}
            note={`Editing ${appearance.colorScheme} colors for this workspace. Dark and light are saved separately.`}
          />
        </div>
      </SettingsGroup>
      <SettingsGroup
        title="Window &amp; sidebars"
        description="Balance focus, transparency, and a consistent workspace."
        scope="Workspace"
      >
        <Row
          label="Match sidebars to workspace"
          description="Use the same background and transparency across the workspace and sidebars."
        >
          <Toggle
            label="Match sidebars to workspace"
            on={appearance.matchPanels}
            onChange={appearance.onMatchPanels}
          />
        </Row>
        {HAS_NATIVE_GLASS && (
          <Row
            label="Background opacity"
            description={
              glassDisabled
                ? "Light mode always uses an opaque window. Your dark-mode value is preserved."
                : "Background opacity for this workspace. Lower values show more of the desktop; text remains solid."
            }
          >
            <Slider
              label="Background opacity"
              value={percent}
              display={`${percent}%`}
              min={Math.round(SIDEBAR_OPACITY_MIN * 100)}
              max={Math.round(SIDEBAR_OPACITY_MAX * 100)}
              onChange={appearance.onOpacity}
              disabled={glassDisabled}
            />
          </Row>
        )}
        {HAS_NATIVE_GLASS && (
          <Row
            label="Blur radius"
            description={
              glassDisabled
                ? "Background blur is unavailable while light mode uses an opaque window."
                : appearance.opacity >= 1
                  ? "Lower background opacity to see desktop blur. At 100% opacity, the window covers it."
                  : "Desktop blur for this workspace. Zero turns blur off; higher values cost more to composite."
            }
          >
            <Slider
              label="Blur radius"
              value={appearance.blur}
              display={appearance.blur === 0 ? "Off" : String(appearance.blur)}
              min={SIDEBAR_BLUR_MIN}
              max={SIDEBAR_BLUR_MAX}
              onChange={appearance.onBlur}
              disabled={glassDisabled}
            />
          </Row>
        )}
        {HAS_NATIVE_GLASS && (
          <Row
            label="Include workspace"
            description={
              glassDisabled
                ? "Main pane glass is unavailable while light mode uses an opaque window."
                : "Also show the desktop behind sessions and editors in this workspace."
            }
          >
            <Toggle
              label="Include workspace"
              on={appearance.bodyGlass}
              onChange={appearance.onBodyGlass}
              disabled={glassDisabled}
            />
          </Row>
        )}
      </SettingsGroup>
      <SettingsGroup
        title="Chat &amp; display"
        description="Personal touches and comfortable reading."
        scope="Device"
      >
        <ChatBackgroundCard appearance={appearance} />
        <Row
          label="Interface scale"
          description="Resize the whole interface. Use Cmd +/− and Cmd 0 on Mac, or Ctrl on Windows and Linux."
        >
          {/* A menu, not a live slider: rescaling the page while dragging
              moves the control out from under the pointer (MonoCode b4f5befb). */}
          <Select
            label="Interface scale"
            value={String(Math.round(appearance.uiScale * 100))}
            options={UI_SCALE_PERCENTS.map((percent) => ({
              value: String(percent),
              label: `${percent}%`,
            }))}
            onChange={(value) => appearance.onUiScale(Number(value))}
          />
        </Row>
      </SettingsGroup>
      <SettingsGroup
        title="Reuse this appearance"
        description="A one-time copy; each workspace can still be customized later."
      >
        <Row
          label="Same appearance across workspaces"
          description="Copy these colors, transparency, blur, and sidebar styles to your other workspaces."
        >
          <ApplyWorkspaceThemeButton profileId={appearance.profileId} />
        </Row>
      </SettingsGroup>
      <div className="settings-reset">
        <p>
          Reset this workspace’s theme and this device’s chat background and
          interface scale.
        </p>
        <SecondaryButton onClick={appearance.restoreDefaults}>
          <RotateCcw className="size-3.5" aria-hidden />
          Restore defaults
        </SecondaryButton>
      </div>
    </>
  );
}

function ChatBackgroundCard({
  appearance,
}: {
  appearance: AppearanceSettings;
}) {
  const src = chatBackgroundSrc(appearance.chatBackgroundPath);
  const hasImage = Boolean(appearance.chatBackgroundPath && src);
  const visibility = Math.round(appearance.chatBackgroundOpacity * 100);
  const busy = appearance.chatBackgroundBusy;

  return (
    <div
      id="setting-chat-background"
      className="settings-background-card"
      tabIndex={-1}
    >
      <div className="settings-background-heading">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-content">
            Chat background
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-content/65">
            An image behind your chat panes. It stays on this device.
          </p>
        </div>
        {hasImage ? (
          <div className="flex shrink-0 items-center gap-2">
            <SecondaryButton
              onClick={() => void appearance.onChooseChatBackground()}
              disabled={busy}
            >
              {busy ? (
                <Loader className="size-3.5 animate-spin" aria-hidden />
              ) : null}
              Change
            </SecondaryButton>
            <SecondaryButton
              onClick={() => void appearance.onClearChatBackground()}
              disabled={busy}
              danger
            >
              Remove
            </SecondaryButton>
          </div>
        ) : null}
      </div>

      <div className="settings-background-preview">
        {hasImage ? (
          <div className="relative h-36">
            <img
              src={src ?? undefined}
              alt=""
              draggable={false}
              className="size-full object-cover"
              style={{ opacity: appearance.chatBackgroundOpacity }}
            />
            <span className="pointer-events-none absolute bottom-2 left-2 text-[11px] text-content/40">
              Preview at {visibility}%
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void appearance.onChooseChatBackground()}
            disabled={busy}
            className="settings-background-empty"
          >
            {busy ? (
              <Loader className="size-5 animate-spin" aria-hidden />
            ) : (
              <ImagePlus className="size-5" aria-hidden />
            )}
            <span>
              <strong>Choose an image</strong>
              <small>Personalize your chat background</small>
            </span>
          </button>
        )}
        {hasImage ? (
          <div className="border-t border-content/8">
            <div className="flex items-center justify-between gap-4 px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-[12px] text-content">Show on</div>
                <p className="text-[11px] text-content/40">
                  Empty sessions only, or every conversation.
                </p>
              </div>
              <Segmented
                label="Show background on"
                value={appearance.chatBackgroundScope}
                options={[
                  { value: "empty", label: "Empty only" },
                  { value: "all", label: "All sessions" },
                ]}
                onChange={appearance.onChatBackgroundScope}
              />
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-content/5 px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-[12px] text-content">Visibility</div>
                <p className="text-[11px] text-content/40">
                  Keep it subtle so long conversations stay readable.
                </p>
              </div>
              <Slider
                label="Background visibility"
                value={visibility}
                display={`${visibility}%`}
                min={Math.round(CHAT_BACKGROUND_OPACITY_MIN * 100)}
                max={Math.round(CHAT_BACKGROUND_OPACITY_MAX * 100)}
                onChange={appearance.onChatBackgroundOpacity}
              />
            </div>
          </div>
        ) : null}
      </div>
      {appearance.chatBackgroundError ? (
        <p className="mt-2 text-[12px] text-red-400">
          {appearance.chatBackgroundError}
        </p>
      ) : null}
    </div>
  );
}

function KeybindingsPage() {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => filterKeybindings(KEYBINDINGS, query), [query]);
  return (
    <section
      id="setting-keybindings"
      className="settings-shortcuts"
      tabIndex={-1}
      aria-label="Keyboard shortcuts"
    >
      <div className="settings-shortcuts-toolbar">
        <span className="settings-section-note" role="status">
          {rows.length} {rows.length === 1 ? "shortcut" : "shortcuts"}
        </span>
        <label className="settings-search-field">
          <Search className="size-4" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a command or key…"
            aria-label="Filter keybindings"
            spellCheck={false}
            autoComplete="off"
          />
        </label>
      </div>
      <div className="settings-shortcuts-table">
        <table>
          <thead>
            <tr>
              <th scope="col">Command</th>
              <th scope="col">Shortcut</th>
              <th scope="col">Available in</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.command}-${row.keys}`}>
                <td>{row.command}</td>
                <td>
                  <kbd>{row.keys}</kbd>
                </td>
                <td>{formatKeybindingContext(row.when)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length ? (
          <p className="settings-empty" role="status">
            No matching shortcuts. Try a command name or a key.
          </p>
        ) : null}
      </div>
      <p className="settings-section-note">
        These shortcuts are built into Aven and can’t be customized yet.
      </p>
    </section>
  );
}

function ProvidersPage() {
  const autoUpdateTools = useSyncExternalStore(
    subscribeProviderToolAutoUpdates,
    loadProviderToolAutoUpdates,
    loadProviderToolAutoUpdates,
  );
  useSyncExternalStore(subscribeModels, getModelSnapshot, getModelSnapshot);
  useSyncExternalStore(
    subscribeHarnessAvailability,
    getHarnessAvailabilitySnapshot,
    getHarnessAvailabilitySnapshot,
  );
  useSyncExternalStore(
    subscribePickerVisibility,
    getPickerVisibilitySnapshot,
    getPickerVisibilitySnapshot,
  );
  const [, refreshChoice] = useState(0);
  const choice = defaultSessionChoice();
  const enabled = HARNESSES.filter(isPickerProviderVisible);
  const usable = enabled.filter(
    (id) => !hasProbedHarnessAvailability() || isHarnessAvailable(id),
  );

  useEffect(() => {
    void probeHarnessAvailability();
  }, []);

  const onModelChange = (harness: HarnessId, model: string) => {
    saveDefaultModel(harness, model);
    if (choice.harness === harness) saveLastModelChoice(harness, model);
    refreshChoice((value) => value + 1);
  };

  const onDefault = (harness: HarnessId, model: string) => {
    saveLastModelChoice(harness, model);
    refreshChoice((value) => value + 1);
  };

  const onProviderVisible = (harness: HarnessId, visible: boolean) => {
    if (!visible && choice.harness === harness) {
      const replacement =
        usable.find((id) => id !== harness) ??
        enabled.find((id) => id !== harness);
      if (!replacement) return;
      saveLastModelChoice(replacement, preferredModelId(replacement));
    }
    savePickerProviderVisible(harness, visible);
  };

  const primaryProviders = HARNESSES.filter(
    (id) =>
      !hasProbedHarnessAvailability() ||
      isHarnessAvailable(id) ||
      choice.harness === id,
  );
  const otherProviders = HARNESSES.filter(
    (id) => !primaryProviders.includes(id),
  );
  const renderProvider = (harness: HarnessId) => (
    <ProviderRow
      key={harness}
      harness={harness}
      selectedModel={preferredModelId(harness)}
      isDefault={choice.harness === harness}
      canDisable={
        enabled.length > 1 && !(usable.length === 1 && usable[0] === harness)
      }
      onDefault={onDefault}
      onModelChange={onModelChange}
      onProviderVisible={onProviderVisible}
    />
  );

  return (
    <>
      <SettingsGroup
        title="Model discovery"
        description="Stay current without changing the models selected for your tasks."
        scope="Device"
      >
        <Row
          label="Keep provider tools up to date"
          description="Check supported Codex and Claude installations daily so newly released models appear automatically. Model lists also refresh while Aven is open. Your selected models stay the same."
        >
          <Toggle
            label="Keep provider tools up to date"
            on={autoUpdateTools}
            onChange={saveProviderToolAutoUpdates}
          />
        </Row>
      </SettingsGroup>
      <div id="setting-providers" className="settings-providers" tabIndex={-1}>
        <Heading title="Providers & models" />
        <p className="settings-section-note">
          Choose what appears in the model picker. Hiding a provider keeps its
          existing tasks intact.
        </p>
        {primaryProviders.map(renderProvider)}
        {otherProviders.length > 0 ? (
          <details className="settings-other-providers">
            <summary>
              Other providers <span>{otherProviders.length}</span>
            </summary>
            <p className="settings-section-note">
              Additional tools you can install and connect.
            </p>
            {otherProviders.map(renderProvider)}
          </details>
        ) : null}
      </div>
    </>
  );
}

function ProviderRow({
  harness,
  selectedModel,
  isDefault,
  canDisable,
  onDefault,
  onModelChange,
  onProviderVisible,
}: {
  harness: HarnessId;
  selectedModel: string;
  isDefault: boolean;
  canDisable: boolean;
  onDefault: (harness: HarnessId, model: string) => void;
  onModelChange: (harness: HarnessId, model: string) => void;
  onProviderVisible: (harness: HarnessId, visible: boolean) => void;
}) {
  const models = modelsFor(harness);
  const shownModels = pickerModelsFor(harness);
  const available = isHarnessAvailable(harness);
  const inPicker = isPickerProviderVisible(harness);
  const current =
    shownModels.find((model) => model.id === selectedModel) ?? shownModels[0];
  const shownIds = new Set(shownModels.map((model) => model.id));
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [refreshState, setRefreshState] = useState<
    "idle" | "pending" | "success" | "failed"
  >("idle");
  const [refreshError, setRefreshError] = useState("");
  const refreshPending = useRef(false);
  const refreshModels = async () => {
    if (refreshPending.current) return;
    refreshPending.current = true;
    setRefreshState("pending");
    setRefreshError("");
    try {
      await refreshHarnessCatalogs([harness], { force: true });
      setRefreshState("success");
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : String(error));
      setRefreshState("failed");
    } finally {
      refreshPending.current = false;
    }
  };
  const filtered = expanded
    ? models.filter((model) =>
        `${model.name} ${model.nativeId ?? model.id}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      )
    : [];

  useEffect(() => {
    if (!available || models.length > 0) return;
    void refreshHarnessCatalogs([harness]);
  }, [available, harness, models.length]);

  return (
    <section
      className="settings-provider-card"
      data-available={available}
      aria-label={`${HARNESS_TITLE[harness]} choices`}
    >
      <div className="settings-provider-heading">
        <span className="settings-provider-mark" aria-hidden>
          <HarnessIcon harness={harness} className="size-5 shrink-0" />
        </span>
        <div className="min-w-0 flex-1">
          <span className="text-[14px] font-semibold tracking-[-0.01em]">
            {HARNESS_TITLE[harness]}
          </span>
          {isDefault ? (
            <span className="settings-provider-badge">Default</span>
          ) : null}
          <p className="mt-0.5 text-[12px] leading-relaxed text-content/60">
            {available
              ? `${shownModels.length} of ${models.length} models shown`
              : harnessUnavailableHint(harness)}
          </p>
        </div>
        <div
          className="flex shrink-0 items-center gap-2"
          title={
            inPicker && !canDisable
              ? "Keep one installed provider visible"
              : undefined
          }
        >
          <span className="text-[12px] text-content/55">Show in picker</span>
          <Toggle
            label={`Show ${HARNESS_TITLE[harness]} in the model picker`}
            on={inPicker}
            disabled={inPicker && !canDisable}
            onChange={(visible) => onProviderVisible(harness, visible)}
          />
        </div>
      </div>
      {available || (inPicker && current) ? (
        <div className="settings-provider-actions">
          {inPicker && current ? (
            <>
              <Select
                label={`${HARNESS_TITLE[harness]} default model`}
                value={current.id}
                onChange={(next) => onModelChange(harness, next)}
                options={shownModels.map((item) => ({
                  value: item.id,
                  label: item.name,
                }))}
              />
              <SecondaryButton
                onClick={() => onDefault(harness, current.id)}
                disabled={isDefault || !available}
              >
                {isDefault ? "Default provider" : "Use by default"}
              </SecondaryButton>
            </>
          ) : null}
          {available ? (
            <SecondaryButton
              label={`Refresh ${HARNESS_TITLE[harness]} models`}
              onClick={() => void refreshModels()}
              disabled={refreshState === "pending"}
            >
              <RefreshCw
                className={`size-3 ${refreshState === "pending" ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              {refreshState === "pending" ? "Refreshing…" : "Refresh models"}
            </SecondaryButton>
          ) : null}
        </div>
      ) : null}
      {refreshState !== "idle" ? (
        <p
          role={refreshState === "failed" ? "alert" : "status"}
          className={`mt-2 pl-12 text-[12px] ${refreshState === "failed" ? "text-red-400" : "text-content/55"}`}
        >
          {refreshState === "pending"
            ? "Checking for available models…"
            : refreshState === "success"
              ? "Models refreshed."
              : `Couldn’t refresh models. ${refreshError}`}
        </p>
      ) : null}
      {models.length > 0 ? (
        <details
          className="mt-2 text-[12px]"
          onToggle={(event) => {
            setExpanded(event.currentTarget.open);
            if (event.currentTarget.open && available)
              void refreshHarnessCatalogs([harness]);
          }}
        >
          <summary className="w-fit cursor-pointer select-none text-content/60 hover:text-content">
            Models · {shownModels.length} shown
          </summary>
          {expanded ? (
            <div className="mt-2 overflow-hidden rounded-[10px] border border-content/10 bg-(--aven-field-bg)">
              <div className="flex items-center gap-2 border-b border-content/10 px-2 py-1.5">
                <Search className="size-3.5 shrink-0 text-content/45" />
                <input
                  aria-label={`Filter ${HARNESS_TITLE[harness]} models`}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter models"
                  className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-content/40 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/60"
                />
                <SecondaryButton
                  onClick={() => showAllPickerModels(harness)}
                  disabled={shownModels.length === models.length}
                >
                  Show all
                </SecondaryButton>
              </div>
              <div className="max-h-60 overflow-y-auto overscroll-contain">
                {filtered.map((model) => {
                  const on = shownIds.has(model.id);
                  const lastModel = on && shownModels.length <= 1;
                  return (
                    <div
                      key={model.id}
                      className="flex items-center gap-3 border-b border-content/5 px-2 py-2 last:border-b-0"
                    >
                      <span
                        className="min-w-0 flex-1 truncate"
                        title={model.nativeId ?? model.id}
                      >
                        {model.name}
                      </span>
                      {lastModel ? (
                        <span className="text-[10px] text-content/40">
                          Keep one
                        </span>
                      ) : null}
                      <Toggle
                        label={`Show ${model.name} in ${HARNESS_TITLE[harness]}`}
                        on={on}
                        disabled={lastModel}
                        onChange={(visible) =>
                          savePickerModelVisible(model.id, visible)
                        }
                      />
                    </div>
                  );
                })}
                {filtered.length === 0 ? (
                  <p className="px-2 py-3 text-content/45">
                    No matching models
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </details>
      ) : null}
    </section>
  );
}

function useArchivedProjects(): ArchivedProject[] {
  const [items, setItems] = useState(loadArchivedProjects);
  useEffect(
    () => subscribeArchivedProjects(() => setItems(loadArchivedProjects())),
    [],
  );
  return items;
}

function archivedProjectLabel(path: string): string {
  return resolveTabGroupLabel(
    projectKey(path),
    loadTabGroupLabels(),
    projectName(path),
  );
}

function ArchivePage({
  cwd,
  sessions,
  onOpenSession,
  onArchiveSession,
  onDeleteSession,
  onRestoreProject,
  onDeleteProject,
}: {
  cwd: string;
  sessions: SessionSummary[];
  onOpenSession: (sessionId: string) => void;
  onArchiveSession: (sessionId: string, archived: boolean) => void;
  onDeleteSession: (sessionId: string) => void;
  onRestoreProject?: (path: string) => void;
  onDeleteProject?: (path: string) => void;
}) {
  const [filters, setFilters] = useState(loadSessionSidebarFilters);
  const [deleting, setDeleting] = useState<ArchivedProject | null>(null);
  const archivedProjects = useArchivedProjects();
  const archived = useMemo(
    () =>
      sessions
        .filter((session) => session.archived)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions],
  );

  const onShowArchived = (showArchived: boolean) => {
    const next = { ...filters, showArchived };
    saveSessionSidebarFilters(next);
    setFilters(next);
  };

  return (
    <>
      <SettingsGroup title="Archived projects" id="setting-archived-projects">
        {archivedProjects.length === 0 ? (
          <p className="py-4 text-[12px] text-content/50">
            Archive a project from the rail to keep its chats without listing it
            in the sidebar.
          </p>
        ) : (
          archivedProjects.map((project) => (
            <div
              key={project.path}
              className="flex min-h-14 items-center gap-3 border-b border-content/8 py-2.5 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px]">
                  {archivedProjectLabel(project.path)}
                </div>
                <div className="truncate text-[11px] text-content/40">
                  {prettyCwd(project.path)}
                </div>
              </div>
              {onRestoreProject ? (
                <SecondaryButton onClick={() => onRestoreProject(project.path)}>
                  Restore
                </SecondaryButton>
              ) : null}
              {onDeleteProject ? (
                <SecondaryButton danger onClick={() => setDeleting(project)}>
                  Delete
                </SecondaryButton>
              ) : null}
            </div>
          ))
        )}
      </SettingsGroup>

      <SettingsGroup title="Sidebar">
        <Row
          label="Show archived in the sidebar"
          description="Keep archived conversations listed alongside the active ones."
        >
          <Toggle
            label="Show archived in the sidebar"
            on={filters.showArchived}
            onChange={onShowArchived}
          />
        </Row>
      </SettingsGroup>

      <SettingsGroup
        title={
          looksLikeProject(cwd)
            ? `Archived in ${projectName(cwd)}`
            : "Archived conversations"
        }
        id="setting-archived-conversations"
      >
        {!looksLikeProject(cwd) ? (
          <p className="py-4 text-[12px] text-content/50">
            Open a project to see its archived conversations.
          </p>
        ) : archived.length === 0 ? (
          <p className="py-4 text-[12px] text-content/50">
            No archived conversations in this project.
          </p>
        ) : (
          archived.map((session) => (
            <div
              key={session.id}
              className="flex min-h-12 items-center gap-3 border-b border-content/8 py-2.5 last:border-b-0"
            >
              <HarnessIcon
                harness={session.harness}
                className="size-3.5 shrink-0"
              />
              <button
                type="button"
                onClick={() => onOpenSession(session.id)}
                className="min-w-0 flex-1 truncate text-left text-[13px] hover:text-content"
              >
                {sessionDisplayTitle(session.title, session.harness)}
              </button>
              <span className="shrink-0 text-[11px] text-content/35 tabular-nums">
                {formatDate(session.updatedAt)}
              </span>
              <SecondaryButton
                onClick={() => onArchiveSession(session.id, false)}
              >
                Unarchive
              </SecondaryButton>
              <SecondaryButton
                danger
                onClick={() => onDeleteSession(session.id)}
              >
                Delete
              </SecondaryButton>
            </div>
          ))
        )}
      </SettingsGroup>

      {deleting ? (
        <RemoveProjectDialog
          name={archivedProjectLabel(deleting.path)}
          path={deleting.path}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            onDeleteProject?.(deleting.path);
            setDeleting(null);
          }}
        />
      ) : null}
    </>
  );
}

function formatDate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

/** macOS keeps the decision after the first prompt; only System Settings can flip it. */
function NotificationsBlocked() {
  return (
    <span className="flex items-center gap-2 text-[12px] text-content/45">
      Permission needed
      {IS_MAC ? (
        <button
          type="button"
          onClick={() => {
            void openNotificationSettings().catch(() => {});
          }}
          className="rounded-md border border-content/10 px-2 py-1 text-content/70 hover:bg-content/10 hover:text-content"
        >
          Open System Settings
        </button>
      ) : null}
    </span>
  );
}

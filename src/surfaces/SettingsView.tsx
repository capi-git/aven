import {
  ArrowDownCircle,
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
import { SETTINGS } from "../lib/settingDefinitions";
import { SettingsNav } from "../chrome/SettingsRail";
import { subscribeSettingsAnchor } from "../lib/settingsSearch";
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
import { saveAutosave } from "../lib/settings";
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
import { RemoveProjectDialog } from "../chrome/RemoveProjectDialog";
import { WindowControls } from "../chrome/WindowControls";
import { useSetting } from "../hooks/useSetting";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { useColorScheme } from "../hooks/useColorScheme";
import {
  applyStatusBarOpacity,
  saveStatusBarOpacity,
  STATUS_BAR_OPACITY_DEFAULT,
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
  loadTranscriptLayout,
  loadTranscriptAnchor,
  saveChatBackgroundOpacity,
  saveChatBackgroundPath,
  saveChatBackgroundScope,
  saveTranscriptLayout,
  saveTranscriptAnchor,
  TRANSCRIPT_ANCHOR_CHANGE_EVENT,
  type ThemePreference,
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
  hasLiveCatalog,
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
import {
  displayAppData,
  prettyCwd,
  projectKey,
  projectName,
} from "../lib/paths";
import { saveAgentKeepAwake } from "../lib/agentKeepAwake";
import { useAgentKeepAwakeSetting } from "../hooks/useAgentKeepAwake";
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
import { loadTabGroupLabels, resolveTabGroupLabel } from "../lib/tabGroups";
import {
  filterKeybindings,
  formatKeybindingContext,
  KEYBINDINGS,
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
  saveBrowserMemorySaver,
  saveBrowserLowMemory,
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
  saveWorkspaceTheme,
  useActiveWorkspaceTheme,
} from "../lib/workspaceThemes";
import {
  saveWorkspaceAccentPreset,
  saveWorkspaceCustomAccent,
  selectedAccentPreset,
  withCustomAccent,
  type AccentPreset,
} from "../lib/accentColors";
import {
  GLASS_LEVEL_MAX,
  GLASS_LEVEL_MIN,
  glassLevelFromOpacity,
  glassLevelLabel,
  glassSettingsForLevel,
} from "../lib/glassLevel";
import {
  cancelUpdateWait,
  installPendingUpdate,
  runUpdateFlow,
  getUpdaterSnapshot,
  subscribeUpdater,
} from "../lib/updater";
import { SkillsSettings } from "./SkillsSettings";
import { AccentColorSetting } from "./AccentColorSetting";
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
  /** Leave Settings and run the tour over the workspace. */
  onTakeTour?: () => void;
};

export function SettingsView({
  section: requestedSection,
  onSelectSection,
  workspaceName,
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
  onTakeTour,
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

  // A new section starts at its top. Settings opens there already; writing
  // scrollTop anyway made WebKit lay out the whole window (~20 ms) on open.
  const shownSection = useRef(section);
  useEffect(() => {
    if (shownSection.current === section) return;
    shownSection.current = section;
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
            {section === "appearance" ? null : (
              <div className="settings-scope-line">
                <span className="settings-scope-dot" aria-hidden />
                <span>On this device</span>
                <span className="settings-scope-hint">
                  {section === "skills"
                    ? "Project instructions · device tools"
                    : section === "connections"
                      ? "Provider connections for this project · device services"
                      : "Your preferences are saved automatically"}
                </span>
              </div>
            )}
            {isPreferencesSection(section) ? (
              <PreferencesPage
                page={section}
                onOpenWhatsNew={onOpenWhatsNew}
                onTakeTour={onTakeTour}
              />
            ) : null}
            {section === "appearance" ? (
              <AppearancePage
                appearance={appearance}
                workspaceName={workspaceName}
              />
            ) : null}
            {section === "keybindings" ? <KeybindingsPage /> : null}
            {section === "git" ? <GitPage /> : null}
            {section === "providers" ? <ProvidersPage /> : null}
            {section === "provider-setup" ? (
              <div id={SETTINGS.providerSetup.id} tabIndex={-1}>
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
      description="Applies to every agent in every project from your next message. Asking for something different in a chat still wins."
      scope="Device"
    >
      <Row label={SETTINGS.gitFinish.label} description={selected?.description}>
        <Select
          label={SETTINGS.gitFinish.label}
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
  onTakeTour,
}: {
  page: PreferencesSection;
  onOpenWhatsNew: (version: string) => void;
  onTakeTour?: () => void;
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
  const browserMemorySaver = useSetting(SETTINGS.browserMemorySaver);
  const browserLowMemory = useSetting(SETTINGS.browserLowMemory);
  const devPreviewAutoOpen = useSetting(SETTINGS.devPreviewAutoOpen);
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
      title="Sidebar &amp; extras"
      description="Choose what appears around your work."
      scope="Device"
    >
      <Row {...SETTINGS.notesEnabled.row}>
        <Toggle
          label={SETTINGS.notesEnabled.label}
          on={notesEnabled}
          onChange={onNotesEnabled}
        />
      </Row>
      <Row {...SETTINGS.liveAgentsEnabled.row}>
        <Toggle
          label={SETTINGS.liveAgentsEnabled.label}
          on={liveAgentsEnabled}
          onChange={onLiveAgentsEnabled}
        />
      </Row>
      <Row {...SETTINGS.composerRunner.row}>
        <Toggle
          label={SETTINGS.composerRunner.label}
          on={composerRunner}
          onChange={onComposerRunner}
        />
      </Row>
      <Row {...SETTINGS.gridArcadeEnabled.row}>
        <Toggle
          label={SETTINGS.gridArcadeEnabled.label}
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
      <Row {...SETTINGS.notifications.row}>
        {notificationsEnabled && notificationPermission === "denied" ? (
          <NotificationsBlocked />
        ) : null}
        {notificationsEnabled && notificationPermission === "unsupported" ? (
          <span className="text-ui-label text-content/45">
            Not available on this platform
          </span>
        ) : null}
        <Toggle
          label={SETTINGS.notifications.label}
          on={notificationsEnabled}
          onChange={onNotificationsEnabled}
        />
      </Row>
      <Row {...SETTINGS.quietMode.row}>
        <Toggle
          label={SETTINGS.quietMode.label}
          on={notificationPreferences.quiet}
          onChange={(value) => onNotificationPreference("quiet", value)}
        />
      </Row>
      <Row {...SETTINGS.sounds.row}>
        <Toggle
          label={SETTINGS.sounds.label}
          on={soundsEnabled}
          onChange={onSoundsEnabled}
        />
      </Row>
      <Row {...SETTINGS.activityAlerts.row}>
        <div className="settings-alert-options">
          {(
            [
              ["needsInput", "Needs you"],
              ["failures", "Failures"],
              ["finished", "Finished / stopped"],
              ["sound", "Sound"],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              className="flex items-center gap-2 text-ui-caption text-content/65"
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
          <Row
            id={SETTINGS.tour.id}
            label={SETTINGS.tour.label}
            description={SETTINGS.tour.row.description}
          >
            <SecondaryButton
              onClick={() => onTakeTour?.()}
              disabled={!onTakeTour}
            >
              Take the tour again
            </SecondaryButton>
          </Row>
        </SettingsGroup>
      </>
    );

  if (page === "browser")
    return (
      <>
        <SettingsGroup
          title="Dev previews"
          description="When a dev server starts in a terminal or an agent's command, Aven offers its page beside the chat."
          scope="Device"
        >
          <Row {...SETTINGS.devPreviewAutoOpen.row}>
            <Toggle
              label={SETTINGS.devPreviewAutoOpen.label}
              on={devPreviewAutoOpen}
              onChange={SETTINGS.devPreviewAutoOpen.save}
            />
          </Row>
        </SettingsGroup>
        <SettingsGroup
          title="Memory"
          description="Keep browser tabs ready while managing memory."
          scope="Device"
        >
          <Row {...SETTINGS.browserMemorySaver.row}>
            <Toggle
              label={SETTINGS.browserMemorySaver.label}
              on={browserMemorySaver}
              onChange={saveBrowserMemorySaver}
            />
          </Row>
          <Row
            label={SETTINGS.browserLowMemory.label}
            description={
              browserEngineRestart
                ? SETTINGS.browserLowMemory.restartDescription
                : SETTINGS.browserLowMemory.row.description
            }
          >
            <Toggle
              label={SETTINGS.browserLowMemory.label}
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
        title="Chats"
        description="How new chats start and handle your follow-up messages."
        scope="Device"
      >
        <Row {...SETTINGS.defaultTaskAccess.row}>
          <AccessPicker
            value={defaultAccess}
            onChange={saveDefaultRuntimeMode}
          />
        </Row>
        <Row {...SETTINGS.followUpBehavior.row}>
          <Segmented
            label={SETTINGS.followUpBehavior.label}
            value={followUpBehavior}
            options={[
              { value: "queue", label: "Wait their turn" },
              { value: "steer", label: "Send right away" },
            ]}
            onChange={onFollowUpBehavior}
          />
        </Row>
      </SettingsGroup>
      <SettingsGroup
        title="Reading &amp; review"
        description="Read and review in the way that works for you."
        scope="Device"
      >
        <Row {...SETTINGS.transcriptLayout.row}>
          <Segmented
            label={SETTINGS.transcriptLayout.label}
            value={transcriptLayout}
            options={[
              { value: "full", label: "Full width" },
              { value: "chat", label: "Chat" },
            ]}
            onChange={onTranscriptLayout}
          />
        </Row>
        <Row {...SETTINGS.transcriptAnchor.row}>
          <Toggle
            label={SETTINGS.transcriptAnchor.label}
            on={transcriptAnchor}
            onChange={onTranscriptAnchor}
          />
        </Row>
        <Row {...SETTINGS.diffViewer.row}>
          <Segmented
            label={SETTINGS.diffViewer.label}
            value={diffViewer}
            options={[
              { value: "editor", label: "Editor" },
              { value: "unified", label: "Unified" },
            ]}
            onChange={onDiffViewer}
          />
        </Row>
        <AutosaveRow />
        <AgentKeepAwakeRow />
      </SettingsGroup>
      <SettingsGroup
        title="Claude Code"
        description="Settings that only affect Claude Code."
        scope="Device"
      >
        <Row {...SETTINGS.claudeHooks.row}>
          <Toggle
            label={SETTINGS.claudeHooks.label}
            on={claudeHooks}
            onChange={onClaudeHooks}
          />
        </Row>
      </SettingsGroup>
    </>
  );
}

function AgentKeepAwakeRow() {
  const on = useAgentKeepAwakeSetting();
  return (
    <Row {...SETTINGS.agentKeepAwake.row}>
      <Toggle
        label={SETTINGS.agentKeepAwake.label}
        on={on}
        onChange={saveAgentKeepAwake}
      />
    </Row>
  );
}

function AutosaveRow() {
  const autosave = useSetting(SETTINGS.autosave);
  return (
    <Row {...SETTINGS.autosave.row}>
      <Toggle
        label={SETTINGS.autosave.label}
        on={autosave}
        onChange={(next) => void saveAutosave(next)}
      />
    </Row>
  );
}

function ConnectionsPage({ cwd }: { cwd: string }) {
  return (
    <SettingsGroup
      title={SETTINGS.agentConnections.label}
      id={SETTINGS.agentConnections.id}
      description={SETTINGS.agentConnections.row.description}
      scope="Project"
    >
      <ProviderConnections cwd={cwd} />
    </SettingsGroup>
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
        ? snapshot.waitingFor
          ? `Version ${snapshot.availableVersion} is ready. Aven will restart when ${snapshot.waitingFor}.`
          : (snapshot.error ??
            `Version ${snapshot.availableVersion} is downloaded and ready. Aven saves your work when it restarts and asks only if something is still running.`)
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
      id={SETTINGS.version.id}
      label={
        <span className="flex items-baseline gap-2">
          {SETTINGS.version.label}
          <span className="font-mono text-ui-label text-content/45">
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
        {snapshot.waitingFor ? (
          <SecondaryButton onClick={() => void cancelUpdateWait()}>
            Cancel restart
          </SecondaryButton>
        ) : null}
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
                ? snapshot.waitingFor
                  ? "Restart now"
                  : "Restart to update"
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
  const accent = resolvedWorkspaceColors(theme, colorScheme).accent;
  const accentPreset = selectedAccentPreset(theme, colorScheme);
  const themePreference = theme.preference;
  // Read from the saved opacity; blur, "Include workspace" and the status bar
  // keep their saved values until the slider moves.
  const glassLevel = glassLevelFromOpacity(theme.opacity);
  const [chatBackgroundPath, setChatBackgroundPath] = useState(
    loadChatBackgroundPath,
  );
  const [chatBackgroundOpacity, setChatBackgroundOpacity] = useState(
    loadChatBackgroundOpacity,
  );
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

  const onGlass = useCallback(
    (level: number) => {
      const { opacity, blur, bodyGlass, statusBarOpacity } =
        glassSettingsForLevel(level);
      saveWorkspaceTheme(profileId, { opacity, blur, bodyGlass });
      saveStatusBarOpacity(applyStatusBarOpacity(statusBarOpacity));
    },
    [profileId],
  );

  const onAccentPreset = useCallback(
    (preset: AccentPreset) => saveWorkspaceAccentPreset(profileId, preset),
    [profileId],
  );

  const onCustomAccent = useCallback(
    (color: string) => saveWorkspaceCustomAccent(profileId, color),
    [profileId],
  );

  /** Repaints this window only; the drag saves once when released. */
  const onPreviewAccent = useCallback(
    (color: string) => applyThemeColors(withCustomAccent(theme.colors, color)),
    [theme.colors],
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

  const onUiScale = useCallback((percent: number) => {
    const next = saveUiScale(percent / 100);
    setUiScale(next);
    void applyUiScale(next);
  }, []);

  const restoreDefaults = useCallback(() => {
    resetWorkspaceTheme(profileId);
    onChatBackgroundOpacity(Math.round(CHAT_BACKGROUND_OPACITY_DEFAULT * 100));
    // "Show on" is no longer offered; a reset returns it to every session.
    saveChatBackgroundScope(
      applyChatBackgroundScope(CHAT_BACKGROUND_SCOPE_DEFAULT),
    );
    if (chatBackgroundPath) void onClearChatBackground();
    onUiScale(Math.round(UI_SCALE_DEFAULT * 100));
    saveStatusBarOpacity(applyStatusBarOpacity(STATUS_BAR_OPACITY_DEFAULT));
  }, [
    chatBackgroundPath,
    onChatBackgroundOpacity,
    onClearChatBackground,
    onUiScale,
    profileId,
  ]);

  return {
    profileId,
    themePreference,
    colorScheme,
    accent,
    accentPreset,
    glassLevel,
    chatBackgroundPath,
    chatBackgroundOpacity,
    chatBackgroundBusy,
    chatBackgroundError,
    uiScale,
    onThemePreference,
    onGlass,
    onAccentPreset,
    onCustomAccent,
    onPreviewAccent,
    onChooseChatBackground,
    onClearChatBackground,
    onChatBackgroundOpacity,
    onUiScale,
    restoreDefaults,
  };
}

function AppearancePage({
  appearance,
  workspaceName,
}: {
  appearance: AppearanceSettings;
  workspaceName?: string;
}) {
  const glassDisabled = appearance.colorScheme === "light";
  return (
    <>
      <SettingsGroup
        title="Theme &amp; colour"
        description={
          workspaceName
            ? `Set the mood for your ${workspaceName} workspace.`
            : "Set the mood for this workspace."
        }
      >
        <Row {...SETTINGS.theme.row}>
          <Segmented
            label={SETTINGS.theme.label}
            value={appearance.themePreference}
            options={[
              { value: "system", label: "System" },
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
            ]}
            onChange={appearance.onThemePreference}
          />
        </Row>
        <AccentColorSetting
          scheme={appearance.colorScheme}
          accent={appearance.accent}
          selected={appearance.accentPreset}
          scopeKey={`${appearance.profileId}:${appearance.colorScheme}`}
          onPreset={appearance.onAccentPreset}
          onCustom={appearance.onCustomAccent}
          onPreviewCustom={appearance.onPreviewAccent}
        />
      </SettingsGroup>
      <SettingsGroup
        title="Window"
        description="Comfortable reading and how much of the desktop shows."
      >
        <Row {...SETTINGS.uiScale.row}>
          {/* A menu, not a live slider: rescaling the page while dragging
              moves the control out from under the pointer (MonoCode b4f5befb). */}
          <Select
            label={SETTINGS.uiScale.label}
            value={String(Math.round(appearance.uiScale * 100))}
            options={UI_SCALE_PERCENTS.map((percent) => ({
              value: String(percent),
              label: `${percent}%`,
            }))}
            onChange={(value) => appearance.onUiScale(Number(value))}
          />
        </Row>
        {HAS_NATIVE_GLASS && (
          <Row
            {...SETTINGS.glass.row}
            description={
              glassDisabled
                ? SETTINGS.glass.disabledDescription
                : SETTINGS.glass.row.description
            }
          >
            <Slider
              label={SETTINGS.glass.label}
              value={appearance.glassLevel}
              display={glassLevelLabel(appearance.glassLevel)}
              min={GLASS_LEVEL_MIN}
              max={GLASS_LEVEL_MAX}
              onChange={appearance.onGlass}
              disabled={glassDisabled}
            />
          </Row>
        )}
        <ReduceMotionRow />
      </SettingsGroup>
      <SettingsGroup
        title="Chat background"
        description="Personalize your chats."
      >
        <ChatBackgroundCard appearance={appearance} />
      </SettingsGroup>
      <SettingsGroup
        title="Workspaces"
        description="Each workspace keeps its own look."
      >
        <Row {...SETTINGS.useForAllWorkspaces.row}>
          <ApplyWorkspaceThemeButton
            profileId={appearance.profileId}
            label="Copy to all"
          />
        </Row>
      </SettingsGroup>
      <div className="settings-reset">
        <p>
          Reset this workspace’s theme, accent colour and glass, and this
          device’s chat background and interface scale.
        </p>
        <SecondaryButton onClick={appearance.restoreDefaults}>
          <RotateCcw className="size-3.5" aria-hidden />
          Restore defaults
        </SecondaryButton>
      </div>
    </>
  );
}

/** A device preference, like the system's; Restore defaults leaves it. */
function ReduceMotionRow() {
  const reduceMotion = useSetting(SETTINGS.reduceMotion);
  return (
    <Row {...SETTINGS.reduceMotion.row}>
      <Toggle
        label={SETTINGS.reduceMotion.label}
        on={reduceMotion}
        onChange={SETTINGS.reduceMotion.save}
      />
    </Row>
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
      id={SETTINGS.chatBackground.id}
      className="settings-background-card"
      tabIndex={-1}
    >
      <div className="settings-background-heading">
        <div className="min-w-0 flex-1">
          <div className="text-ui-body font-medium text-content">
            {SETTINGS.chatBackground.label}
          </div>
          <p className="mt-1 text-ui-label leading-relaxed text-content/65">
            {SETTINGS.chatBackground.row.description}
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
            <span className="pointer-events-none absolute bottom-2 left-2 text-ui-caption text-content/40">
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
                <div className="text-ui-label text-content">Visibility</div>
                <p className="text-ui-caption text-content/40">
                  Keep it subtle so long chats stay readable.
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
        <p className="mt-2 text-ui-label text-red-400">
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
      id={SETTINGS.keybindings.id}
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
      <div
        id={SETTINGS.providers.id}
        className="settings-providers"
        tabIndex={-1}
      >
        <Heading title="Providers & models" />
        <p className="settings-section-note">
          Choose what appears in the model picker. Hiding a provider keeps its
          existing chats intact.
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
      <SettingsGroup
        title="Model discovery"
        description="Stay current without changing the models selected for your chats."
        scope="Device"
      >
        <Row {...SETTINGS.providerToolAutoUpdates.row}>
          <Toggle
            label={SETTINGS.providerToolAutoUpdates.label}
            on={autoUpdateTools}
            onChange={saveProviderToolAutoUpdates}
          />
        </Row>
      </SettingsGroup>
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
    // Pi and similar providers always have a built-in fallback model, so a
    // non-empty list does not mean the live catalog has loaded.
    if (!available || hasLiveCatalog(harness)) return;
    void refreshHarnessCatalogs([harness]);
  }, [available, harness]);

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
          <span className="text-ui-reading font-semibold tracking-[-0.01em]">
            {HARNESS_TITLE[harness]}
          </span>
          {isDefault ? (
            <span className="settings-provider-badge">Default</span>
          ) : null}
          <p className="mt-0.5 text-ui-label leading-relaxed text-content/60">
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
          <span className="text-ui-label text-content/55">Show in picker</span>
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
          className={`mt-2 pl-12 text-ui-label ${refreshState === "failed" ? "text-red-400" : "text-content/55"}`}
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
          className="mt-2 text-ui-label"
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
                  className="min-w-0 flex-1 bg-transparent text-ui-label outline-none placeholder:text-content/40 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/60"
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
                        <span className="text-ui-micro text-content/40">
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
      <SettingsGroup
        title={SETTINGS.archivedProjects.label}
        id={SETTINGS.archivedProjects.id}
      >
        {archivedProjects.length === 0 ? (
          <p className="py-4 text-ui-label text-content/50">
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
                <div className="truncate text-ui-body">
                  {archivedProjectLabel(project.path)}
                </div>
                <div className="truncate text-ui-caption text-content/40">
                  {displayAppData(prettyCwd(project.path))}
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
        <Row {...SETTINGS.showArchived.row}>
          <Toggle
            label={SETTINGS.showArchived.label}
            on={filters.showArchived}
            onChange={onShowArchived}
          />
        </Row>
      </SettingsGroup>

      <SettingsGroup
        title={
          looksLikeProject(cwd)
            ? `Archived in ${projectName(cwd)}`
            : SETTINGS.archivedConversations.label
        }
        id={SETTINGS.archivedConversations.id}
      >
        {!looksLikeProject(cwd) ? (
          <p className="py-4 text-ui-label text-content/50">
            Open a project to see its archived chats.
          </p>
        ) : archived.length === 0 ? (
          <p className="py-4 text-ui-label text-content/50">
            No archived chats in this project.
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
                className="min-w-0 flex-1 truncate text-left text-ui-body hover:text-content"
              >
                {sessionDisplayTitle(session.title, session.harness)}
              </button>
              <span className="shrink-0 text-ui-caption text-content/35 tabular-nums">
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
    <span className="flex items-center gap-2 text-ui-label text-content/45">
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

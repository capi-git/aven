import {
  ArrowDownCircle,
  Check,
  ImagePlus,
  Loader,
  RefreshCw,
  RotateCcw,
  Search,
} from "../chrome/icons";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
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
  type RuntimeMode,
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
  THEME_HUE_MAX,
  THEME_HUE_MIN,
  THEME_SATURATION_MAX,
  THEME_SATURATION_MIN,
  type ThemePreference,
  type ChatBackgroundScope,
  type TranscriptLayout,
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
  UI_SCALE_MAX,
  UI_SCALE_MIN,
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
  settingsSectionDescription,
  settingsSectionLabel,
  type DiffViewer,
  type FollowUpBehavior,
  type SettingsSectionId,
} from "../lib/settings";
import { loadSoundsEnabled, playCue, saveSoundsEnabled } from "../lib/sounds";
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
  applyWorkspaceThemePreset,
  resolvedWorkspaceColors,
  resetWorkspaceTheme,
  saveWorkspaceColor,
  saveWorkspaceTheme,
  type WorkspaceColorTarget,
  useActiveWorkspaceTheme,
  WORKSPACE_THEME_PRESETS,
} from "../lib/workspaceThemes";
import {
  installPendingUpdate,
  readAppVersion,
  runUpdateFlow,
  type UpdaterSnapshot,
} from "../lib/updater";

type Props = {
  section: SettingsSectionId;
  cwd: string;
  sessions: SessionSummary[];
  besideRail?: boolean;
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
  section,
  cwd,
  sessions,
  besideRail = false,
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
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const appearance = useAppearanceSettings();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <div
      role="region"
      aria-label="Settings"
      data-app-settings
      className="flex min-h-0 min-w-0 flex-1 flex-col text-content"
    >
      <div
        className="flex h-10 shrink-0 select-none items-center border-b border-content/10"
        data-tauri-drag-region="deep"
      >
        {IS_MAC && !besideRail ? <div className="w-[78px] shrink-0" /> : null}
        <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />
        <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-[13px]">
          <span className="shrink-0 text-content/45">Settings</span>
          <span aria-hidden className="shrink-0 text-content/25">
            /
          </span>
          <span className="min-w-0 truncate text-content">
            {settingsSectionLabel(section)}
          </span>
        </div>
        {section === "appearance" ? (
          <button
            type="button"
            data-tauri-drag-region="false"
            onClick={appearance.restoreDefaults}
            className="mr-2 flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-content/50 hover:bg-content/10 hover:text-content"
          >
            <RotateCcw className="size-3.5" strokeWidth={1.75} />
            Restore defaults
          </button>
        ) : null}
        {IS_MAC ? null : <WindowControls />}
      </div>

      <div
        ref={lockOverscroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-none"
      >
        <div className="mx-auto w-full max-w-5xl px-8 py-8">
          <PageHeader
            title={settingsSectionLabel(section)}
            description={settingsSectionDescription(section)}
          />
          {section === "general" ? (
            <GeneralPage onOpenWhatsNew={onOpenWhatsNew} />
          ) : null}
          {section === "appearance" ? (
            <AppearancePage appearance={appearance} />
          ) : null}
          {section === "keybindings" ? <KeybindingsPage /> : null}
          {section === "providers" ? <ProvidersPage /> : null}
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
  );
}

function GeneralPage({
  onOpenWhatsNew,
}: {
  onOpenWhatsNew: (version: string) => void;
}) {
  const [defaultAccess, setDefaultAccess] = useState(loadDefaultRuntimeMode);
  const onDefaultAccess = (mode: RuntimeMode) => {
    saveDefaultRuntimeMode(mode);
    setDefaultAccess(mode);
  };
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
  const [liveAgentsEnabled, setLiveAgentsEnabled] = useState(
    loadLiveAgentsEnabled,
  );
  const [soundsEnabled, setSoundsEnabled] = useState(loadSoundsEnabled);
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    loadNotificationsEnabled,
  );
  const [notificationPreferences, setNotificationPreferences] = useState(loadNotificationPreferences);
  useEffect(() => {
    const refresh = () => setNotificationPreferences(loadNotificationPreferences());
    window.addEventListener(NOTIFICATION_PREFERENCES_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(NOTIFICATION_PREFERENCES_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  const onNotificationPreference = (key: keyof NotificationPreferences, value: boolean) => {
    saveNotificationPreferences({ [key]: value });
    setNotificationPreferences(loadNotificationPreferences());
  };
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermission>(cachedNotificationPermission);
  const [claudeHooks, setClaudeHooks] = useState(loadClaudeHooks);

  // The user may flip the switch in System Settings and come back: re-read
  // the OS state whenever the window regains focus while the toggle is on.
  useEffect(() => {
    if (!notificationsEnabled) return;
    const refresh = () => {
      void probeNotificationPermission().then(setNotificationPermission);
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [notificationsEnabled]);

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

  return (
    <>
      <Row
        label="Default task access"
        description="New tasks remember this choice. Full access runs commands and edits without routine approval prompts. Existing tasks keep their own access setting."
      >
        <AccessPicker value={defaultAccess} onChange={onDefaultAccess} />
      </Row>
      <Row
        label="Transcript layout"
        description="Full width keeps user prompts as a spanning card. Chat aligns them to the right with a max width, like a messaging app."
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
        label="Diff view"
        description="Editor keeps working-tree changes in the file. Unified stacks every changed file in one review, with sticky headers and collapsed unchanged lines."
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
        label="Anchor prompts to top"
        description="When you send, the new prompt sits at the top of the transcript and the reply grows into the space below. Turn this off to keep the classic layout, with the latest message resting on the composer."
      >
        <Toggle
          label="Anchor prompts to top"
          on={transcriptAnchor}
          onChange={onTranscriptAnchor}
        />
      </Row>
      <Row
        label="Composer mascot"
        description="When a turn is running, the project mascot runs along the composer, bonks the scroll-to-latest button the first time, then jumps it, and sometimes grabs a coin."
      >
        <Toggle
          label="Composer mascot"
          on={composerRunner}
          onChange={onComposerRunner}
        />
      </Row>
      <Row
        label="Empty session games"
        description="Pac-man and snake idle on the empty-session grid. Hover the band to take control of whichever is on screen. Turn this off to keep the pane still."
      >
        <Toggle
          label="Empty session games"
          on={gridArcadeEnabled}
          onChange={onGridArcadeEnabled}
        />
      </Row>
      <Row
        label="Notes"
        description="A global markdown notebook on the project rail. Save a finished turn from the transcript, then mention it later with @note or add it to chat. Turn this off to hide Notes from the UI."
      >
        <Toggle label="Notes" on={notesEnabled} onChange={onNotesEnabled} />
      </Row>
      <Row
        label="Working agents"
        description="When two or more chats are in flight, a card on the project rail lists them so you can jump across projects. Finished turns stay until you open that session. Turn this off to hide the card."
      >
        <Toggle
          label="Working agents"
          on={liveAgentsEnabled}
          onChange={onLiveAgentsEnabled}
        />
      </Row>
      <Row
        label="Sounds"
        description="Short cues when a turn finishes, a new inbox item appears on the project rail, or an update is available. Switches and Copy on a finished turn also play."
      >
        <Toggle label="Sounds" on={soundsEnabled} onChange={onSoundsEnabled} />
      </Row>
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
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {([
            ["needsInput", "Needs input"],
            ["failures", "Failures"],
            ["finished", "Finished / stopped"],
            ["sound", "Sound"],
          ] as const).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-[11px] text-content/65">
              {label}
              <Toggle label={`Activity: ${label}`} on={notificationPreferences[key]} onChange={(value) => onNotificationPreference(key, value)} />
            </label>
          ))}
        </div>
      </Row>
      <Row
        label="Quiet mode"
        description="Keep recording Activity without task banners or task sounds. Your other sound settings stay unchanged."
      >
        <Toggle label="Quiet mode" on={notificationPreferences.quiet} onChange={(value) => onNotificationPreference("quiet", value)} />
      </Row>
      <Row
        label="Claude Code hooks"
        description="Run the hooks configured in your settings.json files — PreToolUse command rewrites, blocks, notifications, and the rest — just as the Claude Code CLI would. Turn this off if a hook is misbehaving and you need the session back. Takes effect on the next turn."
      >
        <Toggle
          label="Claude Code hooks"
          on={claudeHooks}
          onChange={onClaudeHooks}
        />
      </Row>

      <Heading title="Linear" />
      <LinearSettings />

      <Heading title="About" />
      <UpdateRow onOpenWhatsNew={onOpenWhatsNew} />
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
  const [snapshot, setSnapshot] = useState<UpdaterSnapshot>({
    phase: "idle",
    currentVersion: "…",
  });

  useEffect(() => {
    let cancelled = false;
    void readAppVersion().then((currentVersion) => {
      if (cancelled) return;
      setSnapshot((current) => ({ ...current, currentVersion }));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const busy =
    snapshot.phase === "checking" || snapshot.phase === "downloading";
  const hasUpdate = snapshot.phase === "available";

  const onClick = async () => {
    if (busy) return;
    if (hasUpdate) {
      await installPendingUpdate(setSnapshot);
      return;
    }
    await runUpdateFlow(true, setSnapshot);
  };

  const status = IS_PERSONAL_BUILD
    ? PERSONAL_UPDATE_DESCRIPTION
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
              : "Aven updates itself from the release feed.";

  return (
    <Row
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
          {IS_PERSONAL_BUILD
            ? "Update information"
            : hasUpdate
              ? "Download"
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
  const themeHue = theme.hue;
  const themeSaturation = theme.saturation;
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

  const onTint = useCallback(
    (hue: number, saturation: number) => {
      saveWorkspaceTheme(profileId, { hue, saturation });
    },
    [profileId],
  );

  const onColor = useCallback(
    (target: WorkspaceColorTarget, color: string) => {
      saveWorkspaceColor(profileId, colorScheme, target, color);
    },
    [profileId, colorScheme],
  );

  const onPreset = useCallback(
    (preset: (typeof WORKSPACE_THEME_PRESETS)[number]) => {
      applyWorkspaceThemePreset(
        profileId,
        preset,
        preset.name === "Black" ? "dark" : colorScheme,
      );
      if (preset.name === "Black") {
        saveWorkspaceTheme(profileId, {
          preference: "dark",
          opacity: 1,
          blur: 0,
          bodyGlass: true,
        });
      }
    },
    [profileId, colorScheme],
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
    themeHue,
    themeSaturation,
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
    onTint,
    onColor,
    onPreset,
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

function WorkspaceColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
}) {
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);
  const commitHex = () => {
    const digits = hex.trim().replace(/^#/, "");
    if (/^[\da-f]{6}$/i.test(digits)) onChange(`#${digits.toLowerCase()}`);
    else setHex(value);
  };
  return (
    <div className="flex flex-col gap-1 text-[11px] text-content/60">
      <span>{label}</span>
      <span className="flex h-8 items-center gap-1.5 rounded-md border border-content/15 px-1.5 focus-within:border-content/40">
        <input
          type="color"
          aria-label={`${label} color`}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          className="size-5 cursor-pointer border-0 bg-transparent p-0"
        />
        <input
          type="text"
          aria-label={`${label} hex`}
          value={hex}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          className="w-16 bg-transparent font-mono text-[11px] text-content outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/60"
          onChange={(event) => setHex(event.currentTarget.value)}
          onBlur={commitHex}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitHex();
            }
          }}
        />
      </span>
    </div>
  );
}

function AppearancePage({ appearance }: { appearance: AppearanceSettings }) {
  const percent = Math.round(appearance.opacity * 100);
  const glassDisabled = appearance.colorScheme === "light";

  return (
    <>
      <Row
        label="Workspace palette"
        description="Choose a starting palette for this workspace. Dark and light colors are saved separately."
      >
        <div
          className="grid grid-cols-4 gap-1.5"
          role="group"
          aria-label="Workspace palette"
        >
          {WORKSPACE_THEME_PRESETS.map((palette) => {
            const colors =
              palette.colors[
                palette.name === "Black" ? "dark" : appearance.colorScheme
              ];
            return (
              <button
                key={palette.name}
                type="button"
                aria-pressed={
                  (palette.name !== "Black" ||
                    appearance.colorScheme === "dark") &&
                  appearance.colors.background === colors.background &&
                  appearance.colors.accent === colors.accent &&
                  appearance.colors.highlight === colors.highlight
                }
                onClick={() => appearance.onPreset(palette)}
                className="flex items-center gap-1.5 rounded-lg border border-content/10 px-2 py-1.5 text-xs text-content/70 hover:bg-content/5 aria-pressed:border-content/40 aria-pressed:text-content"
              >
                <span
                  className="size-3 shrink-0 rounded-full border border-content/20"
                  style={{
                    background: `linear-gradient(135deg, ${colors.background} 55%, ${colors.accent} 55% 80%, ${colors.highlight} 80%)`,
                  }}
                />
                {palette.name}
              </button>
            );
          })}
        </div>
      </Row>
      <Row
        label="Same appearance across workspaces"
        description="Copy this workspace’s colors, transparency, blur, and sidebar styling to the others. You can still customize each one later."
      >
        <ApplyWorkspaceThemeButton profileId={appearance.profileId} />
      </Row>
      <Row
        label="Theme"
        description="System follows the OS appearance. Switch between Dark and Light to customize each palette."
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
      <Row
        label={
          appearance.colorScheme === "dark" ? "Dark colors" : "Light colors"
        }
        description="Background sets the surfaces, accent colors the controls, and highlight marks selections."
      >
        <div className="flex flex-wrap justify-end gap-3">
          {(
            [
              ["background", "Background"],
              ["accent", "Accent"],
              ["highlight", "Highlight"],
            ] as const
          ).map(([target, label]) => (
            <WorkspaceColorField
              key={target}
              label={label}
              value={appearance.colors[target]}
              onChange={(color) => appearance.onColor(target, color)}
            />
          ))}
        </div>
      </Row>
      <Row
        label="Match sidebars to workspace"
        description="Use the workspace background and transparency for both sidebars, including floating sidebars. Turn off to keep their separate surfaces."
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
      <Row
        label="Hue"
        description="Base tint. Changing it replaces custom colors for the current appearance."
      >
        <Slider
          label="Hue"
          value={appearance.themeHue}
          display={`${appearance.themeHue}°`}
          min={THEME_HUE_MIN}
          max={THEME_HUE_MAX}
          onChange={(value) =>
            appearance.onTint(value, appearance.themeSaturation)
          }
        />
      </Row>
      <Row
        label="Saturation"
        description="Tint strength. Changing it replaces custom colors for the current appearance; zero keeps it neutral."
      >
        <Slider
          label="Saturation"
          value={appearance.themeSaturation}
          display={`${appearance.themeSaturation}%`}
          min={THEME_SATURATION_MIN}
          max={THEME_SATURATION_MAX}
          onChange={(value) => appearance.onTint(appearance.themeHue, value)}
        />
      </Row>
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
      <ChatBackgroundCard appearance={appearance} />
      <Row
        label="Interface scale"
        description="Zoom the whole interface. You can also use Ctrl+=, Ctrl+-, and Ctrl+0 (Cmd on macOS)."
      >
        <Slider
          label="Interface scale"
          value={Math.round(appearance.uiScale * 100)}
          display={`${Math.round(appearance.uiScale * 100)}%`}
          min={Math.round(UI_SCALE_MIN * 100)}
          max={Math.round(UI_SCALE_MAX * 100)}
          step={10}
          onChange={appearance.onUiScale}
        />
      </Row>
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
    <div className="border-b border-content/5 py-4 last:border-b-0">
      <div className="flex items-start gap-6">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-content">
            Chat background
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-content/45">
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

      <div className="mt-3 overflow-hidden rounded-xl border border-content/10">
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
            className="flex h-36 w-full flex-col items-center justify-center gap-2 text-content/40 hover:bg-content/5 hover:text-content/70 disabled:cursor-default disabled:opacity-40"
          >
            {busy ? (
              <Loader className="size-5 animate-spin" aria-hidden />
            ) : (
              <ImagePlus className="size-5" aria-hidden />
            )}
            <span className="text-[12px]">Choose an image</span>
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
    <>
      <div className="flex items-center justify-end gap-3 pb-3">
        <span className="shrink-0 text-[12px] text-content/40 tabular-nums">
          {rows.length} {rows.length === 1 ? "binding" : "bindings"}
        </span>
        <label className="flex h-7 w-52 shrink-0 items-center gap-2 rounded-md border border-content/10 px-2 text-content/45 focus-within:border-content/20">
          <Search className="size-3.5 shrink-0" strokeWidth={1.75} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter"
            aria-label="Filter keybindings"
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-content outline-none placeholder:text-content/35 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/60"
          />
        </label>
      </div>

      <div className="overflow-hidden rounded-lg border border-content/10">
        <div className="flex items-center border-b border-content/10 bg-content/5 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-content/40">
          <span className="min-w-0 flex-1">Command</span>
          <span className="w-40 shrink-0">Keybinding</span>
          <span className="w-28 shrink-0">When</span>
        </div>
        {rows.length === 0 ? (
          <p className="px-3 py-3 text-[12px] text-content/45">
            No matching bindings
          </p>
        ) : (
          rows.map((row) => (
            <div
              key={`${row.command}-${row.keys}`}
              className="flex items-center border-b border-content/5 px-3 py-2 text-[12px] last:border-b-0"
            >
              <span className="min-w-0 flex-1 truncate">{row.command}</span>
              <span className="w-40 shrink-0 font-mono text-[12px] text-content/80">
                {row.keys}
              </span>
              <span className="w-28 shrink-0 font-mono text-[11px] text-content/40">
                {row.when}
              </span>
            </div>
          ))
        )}
      </div>

      <p className="pt-3 text-[12px] text-content/40">
        Bindings come from the app menu and the workspace key handler; they
        aren’t customizable yet.
      </p>
    </>
  );
}

function ProvidersPage() {
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

  return (
    <>
      <p className="pb-2 text-[12px] leading-relaxed text-content/45">
        Choose the providers and models shown in new sessions, favorites,
        handoff, and second opinion. Hiding a choice keeps your existing
        sessions intact. Expand Models to hide individual choices. Keep at least
        one installed provider visible.
      </p>
      {HARNESSES.map((harness) => (
        <ProviderRow
          key={harness}
          harness={harness}
          selectedModel={preferredModelId(harness)}
          isDefault={choice.harness === harness}
          canDisable={
            enabled.length > 1 &&
            !(usable.length === 1 && usable[0] === harness)
          }
          onDefault={onDefault}
          onModelChange={onModelChange}
          onProviderVisible={onProviderVisible}
        />
      ))}
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
      className="border-b border-content/5 py-3 last:border-b-0"
      aria-label={`${HARNESS_TITLE[harness]} choices`}
    >
      <div className="flex items-center gap-3">
        <HarnessIcon harness={harness} className="size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <span className="text-[13px] font-medium">
            {HARNESS_TITLE[harness]}
          </span>
          {isDefault ? (
            <span className="ml-2 rounded-full bg-content/10 px-1.5 py-0.5 text-[10px] font-medium text-content/60">
              Default
            </span>
          ) : null}
          <p className="mt-0.5 text-[11px] text-content/45">
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
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-7">
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
          className={`mt-2 pl-7 text-[12px] ${refreshState === "failed" ? "text-red-400" : "text-content/55"}`}
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
          className="mt-2 pl-7 text-[12px]"
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
            <div className="mt-2 rounded-md border border-content/10">
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
      <Heading title="Archived projects" first />
      {archivedProjects.length === 0 ? (
        <p className="py-3 text-[12px] text-content/45">
          Archive a project from the rail to keep its chats without listing it
          in the sidebar.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-content/10">
          {archivedProjects.map((project) => (
            <div
              key={project.path}
              className="flex items-center gap-3 border-b border-content/5 px-3 py-2 last:border-b-0"
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
          ))}
        </div>
      )}

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

      <Heading
        title={
          looksLikeProject(cwd)
            ? `Archived in ${projectName(cwd)}`
            : "Archived conversations"
        }
      />

      {!looksLikeProject(cwd) ? (
        <p className="py-3 text-[12px] text-content/45">
          Open a project to see its archived conversations.
        </p>
      ) : archived.length === 0 ? (
        <p className="py-3 text-[12px] text-content/45">
          No archived conversations in this project.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-content/10">
          {archived.map((session) => (
            <div
              key={session.id}
              className="flex items-center gap-3 border-b border-content/5 px-3 py-2 last:border-b-0"
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
          ))}
        </div>
      )}

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

function PageHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header className="pb-4">
      <h1 className="text-[20px] font-semibold leading-tight text-content">
        {title}
      </h1>
      {description ? (
        <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-content/45">
          {description}
        </p>
      ) : null}
    </header>
  );
}

function Heading({ title, first = false }: { title: string; first?: boolean }) {
  return (
    <h2
      className={`pb-1 text-[15px] font-semibold text-content ${
        first ? "" : "pt-8"
      }`}
    >
      {title}
    </h2>
  );
}

function Row({
  label,
  description,
  children,
}: {
  label: ReactNode;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-6 border-b border-content/5 py-4 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-content">{label}</div>
        {description ? (
          <p className="mt-1 text-[12px] leading-relaxed text-content/45">
            {description}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {children}
      </div>
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-grid shrink-0 gap-0.5 rounded-md border border-content/10 p-0.5 text-[12px]"
      style={{
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
      }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={`min-w-0 whitespace-nowrap rounded-[5px] px-2.5 py-1 ${
            value === option.value
              ? "bg-content/10 text-content"
              : "text-content/50 hover:text-content"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Slider({
  label,
  value,
  display,
  min,
  max,
  step = 1,
  onChange,
  disabled = false,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={`flex w-56 items-center gap-3 ${disabled ? "opacity-40" : ""}`}
    >
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-label={label}
        disabled={disabled}
        className="sidebar-opacity-slider min-w-0 flex-1 disabled:cursor-not-allowed"
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="w-10 shrink-0 text-right text-[12px] text-content tabular-nums">
        {display}
      </span>
    </div>
  );
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

function Toggle({
  label,
  on,
  onChange,
  disabled = false,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={on}
      disabled={disabled}
      onClick={() => {
        onChange(!on);
        playCue("switch");
      }}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        on ? "bg-accent" : "bg-content/20"
      }`}
    >
      <span
        className={`absolute top-0.5 size-4 rounded-full bg-white transition-[left] ${
          on ? "left-4.5" : "left-0.5"
        }`}
      />
    </button>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="max-w-52 rounded-md border border-content/10 bg-content/5 px-2 py-1 text-[12px] text-content outline-none hover:border-content/20 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/60"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function SecondaryButton({
  onClick,
  label,
  disabled = false,
  danger = false,
  children,
}: {
  onClick: () => void;
  label?: string;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`flex shrink-0 items-center gap-1.5 rounded-md border border-content/10 px-2.5 py-1 text-[12px] ${
        danger
          ? "text-red-400 hover:border-red-400/40 hover:bg-red-400/10"
          : "text-content/70 hover:bg-content/10 hover:text-content"
      } disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent`}
    >
      {children}
    </button>
  );
}

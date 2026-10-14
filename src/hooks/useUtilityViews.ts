import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  loadNotesEnabled,
  loadSettingsSection,
  saveSettingsSection,
  subscribeNotesEnabled,
  type SettingsSectionId,
} from "../lib/settings";
import {
  captureSettingsReturnView,
  resolveSettingsReturnView,
  type SettingsReturnView,
} from "../lib/settingsReturnView";
import { useReturnFocus } from "./useReturnFocus";

/**
 * The full-screen utilities that replace the workspace (Settings, Search,
 * Inbox, Automations and Notes), the workspace Home, and the file picker.
 * At most one utility is open. Opening one from the workspace remembers the
 * focused control, and leaving the last one restores it.
 */
export function useUtilityViews() {
  const notesEnabled = useSyncExternalStore(
    subscribeNotesEnabled,
    loadNotesEnabled,
    () => true,
  );
  const [homeViewOpen, setHomeViewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] =
    useState<SettingsSectionId>(loadSettingsSection);
  const [searchViewOpen, setSearchViewOpen] = useState(false);
  const [searchViewFocusToken, setSearchViewFocusToken] = useState(0);
  const [inboxViewOpen, setInboxViewOpen] = useState(false);
  const [notesViewOpen, setNotesViewOpen] = useState(false);
  const [automationsViewOpen, setAutomationsViewOpen] = useState(false);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const { captureReturnFocus, restoreReturnFocus, clearReturnFocus } =
    useReturnFocus();

  const searchViewOpenRef = useRef(searchViewOpen);
  searchViewOpenRef.current = searchViewOpen;
  const inboxViewOpenRef = useRef(inboxViewOpen);
  inboxViewOpenRef.current = inboxViewOpen;
  const automationsViewOpenRef = useRef(automationsViewOpen);
  automationsViewOpenRef.current = automationsViewOpen;
  const notesViewOpenRef = useRef(notesViewOpen);
  notesViewOpenRef.current = notesViewOpen;
  const settingsOpenRef = useRef(settingsOpen);
  settingsOpenRef.current = settingsOpen;
  const settingsReturnViewRef = useRef<SettingsReturnView>(null);
  const filePickerOpenRef = useRef(filePickerOpen);
  filePickerOpenRef.current = filePickerOpen;

  useEffect(() => {
    if (!notesEnabled) setNotesViewOpen(false);
  }, [notesEnabled]);

  /** Close Settings, Search, Inbox, Automations and Notes. */
  const closeUtilityViews = useCallback(() => {
    setSettingsOpen(false);
    setSearchViewOpen(false);
    setInboxViewOpen(false);
    setAutomationsViewOpen(false);
    setNotesViewOpen(false);
  }, []);

  const captureUtilityFocus = useCallback(() => {
    if (
      !settingsOpenRef.current &&
      !searchViewOpenRef.current &&
      !inboxViewOpenRef.current &&
      !automationsViewOpenRef.current &&
      !notesViewOpenRef.current
    )
      clearReturnFocus();
    captureReturnFocus();
  }, [captureReturnFocus, clearReturnFocus]);

  const onOpenSearch = useCallback(() => {
    captureUtilityFocus();
    setFilePickerOpen(false);
    setSettingsOpen(false);
    setInboxViewOpen(false);
    setAutomationsViewOpen(false);
    setNotesViewOpen(false);
    setSearchViewOpen(true);
    setSearchViewFocusToken((token) => token + 1);
  }, [captureUtilityFocus]);

  const onLeaveSearch = useCallback(() => {
    setSearchViewOpen(false);
    restoreReturnFocus();
  }, [restoreReturnFocus]);

  const onOpenInbox = useCallback(() => {
    captureUtilityFocus();
    setFilePickerOpen(false);
    setSettingsOpen(false);
    setSearchViewOpen(false);
    setNotesViewOpen(false);
    setAutomationsViewOpen(false);
    setInboxViewOpen(true);
  }, [captureUtilityFocus]);

  const onOpenAutomations = useCallback(() => {
    captureUtilityFocus();
    setFilePickerOpen(false);
    setSettingsOpen(false);
    setSearchViewOpen(false);
    setNotesViewOpen(false);
    setInboxViewOpen(false);
    setAutomationsViewOpen(true);
  }, [captureUtilityFocus]);

  const onLeaveAutomations = useCallback(() => {
    setAutomationsViewOpen(false);
    restoreReturnFocus();
  }, [restoreReturnFocus]);

  const onLeaveInbox = useCallback(() => {
    setInboxViewOpen(false);
    restoreReturnFocus();
  }, [restoreReturnFocus]);

  const onOpenNotes = useCallback(() => {
    if (!loadNotesEnabled()) return;
    captureUtilityFocus();
    setFilePickerOpen(false);
    setSettingsOpen(false);
    setSearchViewOpen(false);
    setInboxViewOpen(false);
    setAutomationsViewOpen(false);
    setNotesViewOpen(true);
  }, [captureUtilityFocus]);

  const onLeaveNotes = useCallback(() => {
    setNotesViewOpen(false);
    restoreReturnFocus();
  }, [restoreReturnFocus]);

  const openSettings = useCallback(
    (section?: SettingsSectionId) => {
      if (!settingsOpenRef.current)
        settingsReturnViewRef.current = captureSettingsReturnView({
          search: searchViewOpenRef.current,
          inbox: inboxViewOpenRef.current,
          automations: automationsViewOpenRef.current,
          notes: notesViewOpenRef.current,
        });
      captureUtilityFocus();
      setFilePickerOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setAutomationsViewOpen(false);
      setNotesViewOpen(false);
      if (section) {
        setSettingsSection(section);
        saveSettingsSection(section);
      }
      setSettingsOpen(true);
    },
    [captureUtilityFocus],
  );

  const onOpenSettings = useCallback(() => openSettings(), [openSettings]);

  const onOpenHome = useCallback(() => {
    clearReturnFocus();
    closeUtilityViews();
    setFilePickerOpen(false);
    setHomeViewOpen(true);
  }, [clearReturnFocus, closeUtilityViews]);

  const onCloseSettings = useCallback(() => {
    const returnView = resolveSettingsReturnView(
      settingsReturnViewRef.current,
      loadNotesEnabled(),
    );
    settingsReturnViewRef.current = null;
    setSettingsOpen(false);
    // Return to the utility Settings replaced. It keeps the workspace opener,
    // so focus goes back there only once that utility is left too.
    if (returnView) {
      setSearchViewOpen(returnView === "search");
      setInboxViewOpen(returnView === "inbox");
      setAutomationsViewOpen(returnView === "automations");
      setNotesViewOpen(returnView === "notes");
      return;
    }
    restoreReturnFocus();
  }, [restoreReturnFocus]);

  const onSelectSettingsSection = useCallback((section: SettingsSectionId) => {
    setSettingsSection(section);
    saveSettingsSection(section);
  }, []);

  return {
    notesEnabled,
    homeViewOpen,
    setHomeViewOpen,
    settingsOpen,
    setSettingsOpen,
    settingsSection,
    setSettingsSection,
    searchViewOpen,
    setSearchViewOpen,
    searchViewFocusToken,
    inboxViewOpen,
    setInboxViewOpen,
    notesViewOpen,
    setNotesViewOpen,
    automationsViewOpen,
    setAutomationsViewOpen,
    filePickerOpen,
    setFilePickerOpen,
    searchViewOpenRef,
    inboxViewOpenRef,
    automationsViewOpenRef,
    notesViewOpenRef,
    settingsOpenRef,
    filePickerOpenRef,
    captureReturnFocus,
    restoreReturnFocus,
    clearReturnFocus,
    closeUtilityViews,
    onOpenSearch,
    onLeaveSearch,
    onOpenInbox,
    onLeaveInbox,
    onOpenAutomations,
    onLeaveAutomations,
    onOpenNotes,
    onLeaveNotes,
    openSettings,
    onOpenSettings,
    onCloseSettings,
    onSelectSettingsSection,
    onOpenHome,
  };
}

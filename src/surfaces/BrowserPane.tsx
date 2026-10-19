import { SLOW_PAGE_MS, slowPageNotice } from "../lib/browserSlowLoad";
import { errorText as errorMessage, logError } from "../lib/errors";
import {
  browserIsTransferred,
  isDetachedWorkspace,
} from "../lib/workspaceTransfers";
import { browserFavicon } from "../lib/browserIcons";
import {
  registerAgentBrowserPage,
  registerAgentBrowserWake,
  isAgentBrowserPageProtected,
} from "../lib/agentBrowser";
import {
  browserUpdatePaused,
  registerBrowserUpdatePage,
  subscribeBrowserUpdate,
} from "../lib/browserUpdateState";
import { registerBrowserMemoryPage } from "../lib/browserMemory";
import { loadBrowserMemorySaver } from "../lib/settings";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { flushSync } from "react-dom";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Pen,
  Pencil,
  Maximize2,
  Mic,
  MoreHorizontal,
  Minus,
  Plus,
  Search,
  RefreshCw,
  Video,
  X,
} from "../chrome/icons";
import { ExplorerMenu, type ExplorerMenuItem } from "../chrome/ExplorerMenu";
import {
  BROWSER_NOTICE_ACTION_LABELS,
  EXTERNAL_BROWSER_NAME,
  browserBounds,
  browserDownloadProgress,
  browserEditAttachment,
  browserSearchSuggestion,
  nativeBrowser,
  openBrowserExternally,
  resolveBrowserAddress,
  type BrowserAction,
  type BrowserDownload,
  type BrowserFindResult,
  type BrowserNoticeAction,
  type BrowserState,
} from "../lib/browser";
import { useBrowserDropIndicator } from "../hooks/useBrowserDropIndicator";
import { useBrowserMarkup } from "../hooks/useBrowserMarkup";
import { useDevServerStart } from "../hooks/useDevServerStart";
import { beginBrowserHandoff, endBrowserHandoff } from "../lib/browserHandoff";
import {
  createBrowserPresentation,
  type BrowserSnapshot,
  type BrowserPresentation,
} from "../lib/browserPresentation";
import { BrowserMarkup } from "./BrowserMarkup";
import "./BrowserPane.css";
import type { Attachment } from "../lib/session";
import { useProjectAppearance } from "../hooks/useProjectAppearance";
import { ProjectMark } from "../chrome/ProjectMark";
import { IS_MAC } from "../lib/platform";

export type BrowserPaneProps = {
  id: string;
  attachedNativeId?: string;
  onNativeReady?: (id: string) => void;
  initialUrl?: string;
  visible?: boolean;
  agentRequested?: boolean;
  onClose?: () => void;
  onAddToChat?: (text: string, attachments?: Attachment[]) => void;
  onUrlChange?: (url: string) => void;
  onTitleChange?: (title: string) => void;
  onFaviconChange?: (favicon: string) => void;
  onFocus?: () => void;
  /** Open a page's new-tab link beside this one. Without it the link opens here. */
  onOpenTab?: (url: string, background: boolean) => void;
  expanded?: boolean;
  onToggleExpand?: () => void;
  /** The project this browser belongs to; its mark sits beside the address. */
  project?: string;
};

const BROWSER_ACTIONS_WIDTH = 224;
const NO_CAPTURE = { microphone: false, camera: false };

/** The owning project's mark, named in its tooltip. Projectless pages show none. */
function BrowserProjectMark({ project }: { project?: string }) {
  const appearance = useProjectAppearance(project);
  if (!appearance) return null;
  return (
    <span
      className="browser-project-mark"
      role="img"
      aria-label={`Project ${appearance.label}`}
      title={appearance.label}
    >
      <ProjectMark appearance={appearance} />
    </span>
  );
}

function browserMenuPosition(button: HTMLButtonElement) {
  const rect = button.getBoundingClientRect();
  return {
    x: Math.max(8, rect.right - BROWSER_ACTIONS_WIDTH),
    y: rect.bottom + 4,
  };
}

function startsWithUrl(value?: string): string {
  if (!value) return "";
  try {
    return resolveBrowserAddress(value);
  } catch {
    return "";
  }
}

/** A project id change gets a fresh native view without inheriting another URL. */
export function BrowserPane(props: BrowserPaneProps) {
  return <BrowserPaneSession key={props.id} {...props} />;
}

function BrowserPaneSession({
  id,
  initialUrl,
  visible = true,
  agentRequested = false,
  onClose,
  onAddToChat,
  onUrlChange,
  onTitleChange,
  onFaviconChange,
  onFocus,
  onOpenTab,
  attachedNativeId,
  onNativeReady,
  expanded = false,
  onToggleExpand,
  project,
}: BrowserPaneProps) {
  const [url, setUrl] = useState(() => startsWithUrl(initialUrl));
  const [address, setAddress] = useState(initialUrl ?? "");
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState<number | null>(null);
  // Read when the slow-load timer fires, without restarting it.
  const loadProgressRef = useRef(loadProgress);
  loadProgressRef.current = loadProgress;
  const [zoomFactor, setZoomFactor] = useState<number | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState("");
  const [findResult, setFindResult] = useState<BrowserFindResult | null>(null);
  const [finding, setFinding] = useState(false);
  const [editing, setEditing] = useState(false);
  const editingActive = useRef(false);
  const editVisible = useRef(visible);
  const editRequest = useRef(0);
  const editStopRequest = useRef<number | null>(null);
  const editToken = useRef("");
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const [downloads, setDownloads] = useState<BrowserDownload[]>([]);
  const [downloadsLoading, setDownloadsLoading] = useState(false);
  const [downloadsError, setDownloadsError] = useState<string | null>(null);
  editVisible.current = visible;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The button Chromium offers with its current notice. It applies only while
  // that same notice is the one on screen.
  const [noticeAction, setNoticeAction] = useState<{
    notice: string;
    action: BrowserNoticeAction;
  } | null>(null);
  const [capture, setCapture] = useState(NO_CAPTURE);
  const [toolsMenu, setToolsMenu] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [nativeMenus, setNativeMenus] = useState(false);
  // Read by the layout pass, which must not wait for a React render.
  const nativeHoles = useRef(false);
  const [holeMenus, setHoleMenus] = useState(false);
  const [nativeDropIndicator, setNativeDropIndicator] = useState(false);
  const [snapshot, setSnapshot] = useState<BrowserSnapshot | null>(null);
  const [readyId, setReadyId] = useState<string | null>(null);
  const [sleeping, setSleeping] = useState(false);
  const sleepOperation = useRef<Promise<boolean> | null>(null);
  const wakeRequested = useRef(false);
  const mounted = useRef(true);
  const retireForSleep = useRef<(nativeId: string) => void>(() => {});
  const [pendingToolbar, setPendingToolbar] = useState<{
    action: "find" | "address";
  } | null>(null);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const [history, setHistory] = useState({ back: false, forward: false });
  const host = useRef<HTMLDivElement>(null);
  const addressInput = useRef<HTMLInputElement>(null);
  const toolsButton = useRef<HTMLButtonElement>(null);
  const findInput = useRef<HTMLInputElement>(null);
  const findTimer = useRef<number | null>(null);
  const findGeneration = useRef(0);
  const urlRef = useRef(url);
  const snapshotZoom = useRef({ factor: zoomFactor, menu: toolsMenu });
  snapshotZoom.current = { factor: zoomFactor, menu: toolsMenu };
  const updatePaused = useSyncExternalStore(
    subscribeBrowserUpdate,
    browserUpdatePaused,
    browserUpdatePaused,
  );
  const creationPaused = useRef(false);
  const nativePageId = useRef<string | null>(null);
  const nativeGeneration = useRef(0);
  const retiredNativeId = useRef<string | null>(null);
  useBrowserDropIndicator(
    host,
    readyId,
    nativeDropIndicator && visible && !error,
  );
  const [nativeAttachment, setNativeAttachment] = useState({
    surfaceId: id,
    observedId: attachedNativeId,
    requestedId: attachedNativeId,
  });
  if (
    nativeAttachment.surfaceId !== id ||
    nativeAttachment.observedId !== attachedNativeId
  ) {
    // Detached workspaces record onNativeReady in attachedNativeId. That is
    // acknowledgment of this live page, not a request to close and reattach it.
    const acknowledgment =
      nativeAttachment.surfaceId === id &&
      attachedNativeId === nativePageId.current;
    setNativeAttachment({
      surfaceId: id,
      observedId: attachedNativeId,
      requestedId: acknowledgment
        ? nativeAttachment.requestedId
        : attachedNativeId,
    });
  }
  const requestedAttachmentId = nativeAttachment.requestedId;
  const navigationSequence = useRef(0);
  const pendingNavigation = useRef<{ sequence: number; url: string } | null>(
    null,
  );
  const notifiedUrl = useRef("");
  const callbacks = useRef({
    onNativeReady,
    onUrlChange,
    onTitleChange,
    onFaviconChange,
    onAddToChat,
    onFocus,
    onOpenTab,
  });
  callbacks.current = {
    onNativeReady,
    onUrlChange,
    onTitleChange,
    onFaviconChange,
    onAddToChat,
    onFocus,
    onOpenTab,
  };
  const toolbarFocusGeneration = useRef(0);
  const toolbarFocusTarget = useRef<HTMLInputElement | null>(null);
  const browserPageHasNativeFocus = useRef(false);
  const toolbarPresentation = useRef({ visible });
  toolbarPresentation.current = { visible };
  const focusShellForToolbar = useCallback((input: HTMLInputElement | null) => {
    if (!input || !isTauri() || !toolbarPresentation.current.visible) return;
    const generation = ++toolbarFocusGeneration.current;
    toolbarFocusTarget.current = input;
    // Chromium and the app's WKWebView are sibling native views. A DOM focus
    // or pointer click alone can leave keyboard input with Chromium. Let the
    // pointer's default caret/selection behavior finish before restoring it.
    void getCurrentWebview()
      .setFocus()
      .then(() => {
        if (
          generation !== toolbarFocusGeneration.current ||
          !toolbarPresentation.current.visible ||
          !input.isConnected
        )
          return;
        browserPageHasNativeFocus.current = false;
        if (document.activeElement !== input) return;
        const { selectionStart, selectionEnd, selectionDirection } = input;
        input.focus({ preventScroll: true });
        if (selectionStart != null && selectionEnd != null)
          input.setSelectionRange(
            selectionStart,
            selectionEnd,
            selectionDirection ?? undefined,
          );
      })
      .catch((reason) => {
        if (generation === toolbarFocusGeneration.current)
          setNotice(`Could not focus browser toolbar: ${errorMessage(reason)}`);
      });
  }, []);
  useLayoutEffect(() => {
    const cancel = () => {
      ++toolbarFocusGeneration.current;
      toolbarFocusTarget.current = null;
    };
    const pointer = (event: PointerEvent) => {
      if (event.target !== toolbarFocusTarget.current) cancel();
    };
    const blur = (event: FocusEvent) => {
      if (event.target === toolbarFocusTarget.current) cancel();
    };
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("focusout", blur, true);
    window.addEventListener("blur", cancel);
    return () => {
      cancel();
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("focusout", blur, true);
      window.removeEventListener("blur", cancel);
    };
  }, [visible]);
  useEffect(() => {
    setEditing(false);
    if (!readyId || !onAddToChat) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void nativeBrowser
      .listenEditing((event) => {
        if (
          disposed ||
          event.id !== readyId ||
          event.token !== editToken.current
        )
          return;
        if (event.selection) {
          // Only a committed selection can add a draft. Duplicate completion
          // events must not cancel the first attachment while it is saving.
          if (event.active || !editingActive.current) return;
          const request = ++editRequest.current;
          editingActive.current = false;
          setEditing(false);
          if (!event.screenshot) {
            setNotice(
              event.error ??
                "Could not capture the selected element. Please select it again.",
            );
            return;
          }
          void browserEditAttachment(event.screenshot).then(
            (attachment) => {
              if (
                disposed ||
                request !== editRequest.current ||
                !editVisible.current
              )
                return;
              callbacks.current.onAddToChat?.(event.comment ?? "", [
                attachment,
              ]);
            },
            (reason) => {
              if (!disposed && request === editRequest.current)
                setNotice(
                  `Could not attach the selected element: ${errorMessage(reason)}`,
                );
            },
          );
        } else if (!event.active) {
          ++editRequest.current;
          editingActive.current = false;
          setEditing(false);
        } else if (
          event.error &&
          editVisible.current &&
          nativePageId.current === readyId
        ) {
          // The native picker is still active when Chromium rejects its stop.
          // Keep Done available so the user can retry without starting a new run.
          editingActive.current = true;
          setEditing(true);
        }
        if (event.error) setNotice(event.error);
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((reason) => {
        if (!disposed)
          setNotice(`Page editing unavailable: ${errorMessage(reason)}`);
      });
    return () => {
      disposed = true;
      unlisten?.();
      if (editingActive.current) {
        ++editRequest.current;
        editingActive.current = false;
        void nativeBrowser
          .edit(readyId, false, editToken.current)
          .catch(() => {});
      }
    };
  }, [readyId, Boolean(onAddToChat)]);
  useEffect(() => {
    if (visible || !readyId || !editingActive.current) return;
    editingActive.current = false;
    ++editRequest.current;
    setEditing(false);
    void nativeBrowser.edit(readyId, false, editToken.current).catch(() => {});
  }, [visible, readyId]);
  const stopPageEditing = useCallback(() => {
    if (!readyId || !editingActive.current || editStopRequest.current !== null)
      return;
    const token = editToken.current;
    const request = ++editRequest.current;
    editStopRequest.current = request;
    editingActive.current = false;
    setEditing(false);
    void nativeBrowser
      .edit(readyId, false, token)
      .catch((reason) => {
        if (
          request !== editRequest.current ||
          token !== editToken.current ||
          nativePageId.current !== readyId ||
          !editVisible.current
        )
          return;
        editingActive.current = true;
        setEditing(true);
        setNotice(`Could not stop commenting: ${errorMessage(reason)}`);
      })
      .finally(() => {
        if (editStopRequest.current === request) editStopRequest.current = null;
      });
  }, [readyId]);
  useEffect(() => {
    if (!editing || !readyId || !visible) return;
    const cancel = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        !editingActive.current ||
        editStopRequest.current !== null ||
        nativePageId.current !== readyId
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      stopPageEditing();
    };
    // Starting from the toolbar leaves macOS focus in the WK shell. Chromium's
    // Escape handler cannot receive that key until the page itself has focus.
    window.addEventListener("keydown", cancel, true);
    return () => window.removeEventListener("keydown", cancel, true);
  }, [editing, readyId, visible, stopPageEditing]);
  const presentation = useRef({ visible, error });
  presentation.current = { visible, error };
  useEffect(() => {
    setToolsMenu(null);
  }, [readyId, visible]);
  const presentationController = useRef<BrowserPresentation | null>(null);
  // Mark up needs a still picture of the page, which only macOS captures.
  const markupAvailable = IS_MAC && !!onAddToChat;
  const markup = useBrowserMarkup({
    pageId: readyId,
    presentation: presentationController,
    visible,
    error,
    url,
    snapshotSrc: snapshot?.src ?? null,
    onNotice: setNotice,
    onAddToChat,
  });
  const markupImage = markup.state?.phase === "active" ? markup.state : null;
  const hasUrl = !!url;
  const focusNewAddress = useRef(!hasUrl);
  const sleepProtection =
    loading ||
    !!error ||
    editing ||
    !!attachedNativeId ||
    isDetachedWorkspace() ||
    !!toolsMenu ||
    findOpen ||
    address !== url;
  const memoryState = useRef({ visible, protected: sleepProtection });
  memoryState.current = { visible, protected: sleepProtection };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const wakePage = useCallback(async () => {
    if (browserUpdatePaused()) return;
    wakeRequested.current = true;
    await sleepOperation.current?.catch(() => false);
    if (mounted.current && !browserUpdatePaused()) setSleeping(false);
  }, []);
  useEffect(
    () =>
      hasUrl && !error ? registerAgentBrowserWake(id, wakePage) : undefined,
    [id, hasUrl, error, wakePage],
  );
  useEffect(() => {
    if (updatePaused) return;
    if (creationPaused.current) {
      creationPaused.current = false;
      setRetryGeneration((generation) => generation + 1);
    }
    if (visible || attachedNativeId) void wakePage();
  }, [visible, attachedNativeId, wakePage, updatePaused, sleeping]);
  const memoryRegistration = useRef<ReturnType<
    typeof registerBrowserMemoryPage
  > | null>(null);
  useEffect(() => {
    if (!readyId) return;
    const registration = registerBrowserMemoryPage(id, {
      ...memoryState.current,
      sleep: async () => {
        if (
          !mounted.current ||
          browserUpdatePaused() ||
          !loadBrowserMemorySaver() ||
          memoryState.current.visible ||
          memoryState.current.protected ||
          isAgentBrowserPageProtected(id) ||
          nativePageId.current !== readyId ||
          browserIsTransferred(readyId) ||
          pendingNavigation.current ||
          sleepOperation.current
        )
          return false;
        const generation = nativeGeneration.current;
        wakeRequested.current = false;
        const operation = (async () => {
          // This native operation rechecks safety and uses a non-forced close.
          // Never substitute the normal tab-close path for a failed probe.
          const result = await nativeBrowser.sleep(readyId);
          if (!result.slept || !mounted.current) return false;
          // A transfer/retry can install a new native page while this close
          // settles. The old completion has no authority over that page.
          if (nativeGeneration.current !== generation) return true;
          retireForSleep.current(readyId);
          const reopen =
            !browserUpdatePaused() &&
            (wakeRequested.current ||
              memoryState.current.visible ||
              !loadBrowserMemorySaver());
          setSleeping(!reopen);
          // Also restart when hide/show was batched while native close completed.
          setRetryGeneration((generation) => generation + 1);
          return true;
        })().catch(() => false);
        sleepOperation.current = operation;
        try {
          return await operation;
        } finally {
          if (sleepOperation.current === operation)
            sleepOperation.current = null;
        }
      },
    });
    memoryRegistration.current = registration;
    return () => {
      registration.dispose();
      if (memoryRegistration.current === registration)
        memoryRegistration.current = null;
    };
  }, [id, readyId]);
  useEffect(() => {
    memoryRegistration.current?.update(memoryState.current);
  }, [visible, sleepProtection, readyId]);

  const performNavigation = async (
    nativeId: string,
    navigation: { sequence: number; url: string },
  ) => {
    try {
      await nativeBrowser.navigate(nativeId, navigation.url);
    } catch (reason) {
      if (
        nativePageId.current === nativeId &&
        navigationSequence.current === navigation.sequence
      ) {
        setNotice(errorMessage(reason));
        setLoading(false);
      }
    } finally {
      if (pendingNavigation.current === navigation)
        pendingNavigation.current = null;
    }
  };

  useLayoutEffect(() => {
    if (!visible || !focusNewAddress.current) return;
    focusNewAddress.current = false;
    addressInput.current?.focus({ preventScroll: true });
    addressInput.current?.select();
    focusShellForToolbar(addressInput.current);
  }, [visible, focusShellForToolbar]);

  useEffect(() => {
    setToolsMenu(null);
  }, [readyId]);

  useEffect(() => {
    presentationController.current?.updateZoom();
  }, [toolsMenu, zoomFactor]);

  useEffect(() => {
    if (!toolsMenu) return;
    const close = () => setToolsMenu(null);
    const closeIfMoved = () => {
      const button = toolsButton.current;
      const position = button ? browserMenuPosition(button) : null;
      if (!position || position.x !== toolsMenu.x || position.y !== toolsMenu.y)
        close();
    };
    // Dismiss on pane movement as well as window resize, so a menu cannot
    // remain open while its browser transfers into a neighboring pane/window.
    window.addEventListener("resize", close);
    window.addEventListener("supermono:workspace-layout", closeIfMoved);
    window.addEventListener("supermono:browser-layout-reset", close);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("supermono:workspace-layout", closeIfMoved);
      window.removeEventListener("supermono:browser-layout-reset", close);
    };
  }, [toolsMenu]);

  useEffect(() => {
    if (!visible) {
      setToolsMenu(null);
      setDownloadsOpen(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!hasUrl || !isTauri() || sleeping) return;
    if (browserUpdatePaused()) {
      creationPaused.current = true;
      return;
    }
    ++nativeGeneration.current;
    // An effect generation owns its own id: React StrictMode cleanup cannot
    // destroy a view created by the subsequent effect generation.
    const nativeId = requestedAttachmentId ?? crypto.randomUUID();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let created = false;
    let terminated = false;
    let unregisterAgentPage: (() => void) | undefined;
    browserPageHasNativeFocus.current = false;
    let nativeTitle = "";
    let nativeFavicon = "";
    const retireSleepingPage = (pageId: string) => {
      if (disposed || pageId !== nativeId) return;
      terminated = true;
      retiredNativeId.current = nativeId;
      if (nativePageId.current === nativeId) nativePageId.current = null;
      unregisterAgentPage?.();
      unregisterAgentPage = undefined;
      setReadyId(null);
      setLoading(false);
      setLoadProgress(null);
      setSnapshot(null);
      setNativeMenus(false);
      nativeHoles.current = false;
      setHoleMenus(false);
      setNativeDropIndicator(false);
      setError(null);
      setNotice(null);
      setSleeping(true);
    };
    retireForSleep.current = retireSleepingPage;
    nativePageId.current = null;
    setReadyId(null);
    setNativeMenus(false);
    nativeHoles.current = false;
    setHoleMenus(false);
    setNativeDropIndicator(false);
    setLoading(true);
    setNotice(null);
    const receive = (state: BrowserState) => {
      if (disposed || terminated || state.id !== nativeId) return;
      if (state.closed && state.sleeping) {
        retireSleepingPage(nativeId);
        return;
      }
      if (state.closed) {
        terminated = true;
        retiredNativeId.current = nativeId;
        if (nativePageId.current === nativeId) nativePageId.current = null;
        unregisterAgentPage?.();
        unregisterAgentPage = undefined;
        setReadyId(null);
        setLoading(false);
        setSnapshot(null);
        setNativeMenus(false);
        nativeHoles.current = false;
        setHoleMenus(false);
        setNativeDropIndicator(false);
        setToolsMenu(null);
        setFindOpen(false);
        setDownloadsOpen(false);
        setEditing(false);
        editingActive.current = false;
        setHistory({ back: false, forward: false });
        setLoadProgress(null);
        setError(
          state.error || "This browser page closed. Retry to reopen it.",
        );
        setNotice(null);
        setCapture(NO_CAPTURE);
        return;
      }
      if (
        state.focused &&
        !browserPageHasNativeFocus.current &&
        presentation.current.visible
      )
        callbacks.current.onFocus?.();
      if (state.focused && !browserPageHasNativeFocus.current) {
        ++toolbarFocusGeneration.current;
        toolbarFocusTarget.current = null;
      }
      browserPageHasNativeFocus.current = !!state.focused;
      setNativeMenus(state.nativeMenus === true);
      const holes = state.nativeHoles === true;
      setHoleMenus(holes);
      if (nativeHoles.current !== holes) {
        nativeHoles.current = holes;
        presentationController.current?.update();
      }
      setNativeDropIndicator(state.nativeDropIndicator === true);
      if (state.title !== nativeTitle) {
        nativeTitle = state.title;
        callbacks.current.onTitleChange?.(state.title);
      }
      const favicon = browserFavicon(state.favicon) ?? "";
      if (favicon !== nativeFavicon) {
        nativeFavicon = favicon;
        callbacks.current.onFaviconChange?.(favicon);
      }
      setTitle(state.title);
      setLoading(state.loading);
      setLoadProgress(
        typeof state.loadProgress === "number" &&
          Number.isFinite(state.loadProgress)
          ? Math.min(1, Math.max(0, state.loadProgress))
          : null,
      );
      if (
        typeof state.zoomFactor === "number" &&
        Number.isFinite(state.zoomFactor) &&
        state.zoomFactor > 0
      )
        setZoomFactor(state.zoomFactor);
      if (state.findResult !== undefined) {
        setFindResult(state.findResult);
        setFinding(false);
      }
      setHistory((previous) =>
        previous.back === state.canGoBack &&
        previous.forward === state.canGoForward
          ? previous
          : { back: state.canGoBack, forward: state.canGoForward },
      );
      setError(state.error);
      setNotice(state.notice ?? null);
      const nextAction =
        state.notice &&
        state.noticeAction &&
        Object.hasOwn(BROWSER_NOTICE_ACTION_LABELS, state.noticeAction)
          ? { notice: state.notice, action: state.noticeAction }
          : null;
      setNoticeAction((previous) =>
        previous?.notice === nextAction?.notice &&
        previous?.action === nextAction?.action
          ? previous
          : nextAction,
      );
      const microphone = state.microphoneInUse === true;
      const camera = state.cameraInUse === true;
      setCapture((previous) =>
        previous.microphone === microphone && previous.camera === camera
          ? previous
          : { microphone, camera },
      );
      const initialPlaceholder =
        !created &&
        (state.url === "about:blank" || state.url === "about:srcdoc");
      if (state.url && !initialPlaceholder) {
        urlRef.current = state.url;
        setUrl(state.url);
        if (
          !pendingNavigation.current &&
          document.activeElement !== addressInput.current
        )
          setAddress(state.url);
        if (notifiedUrl.current !== state.url) {
          notifiedUrl.current = state.url;
          callbacks.current.onUrlChange?.(state.url);
        }
      }
    };
    const unregisterUpdatePage = registerBrowserUpdatePage(nativeId, receive);
    const open = async () => {
      unlisten = await nativeBrowser.listen(receive);
      if (disposed) {
        unlisten();
        return;
      }
      const bounds = host.current ? browserBounds(host.current) : null;
      // The native child starts hidden; layout publishes its exact bounds
      // before showing it, so no full-window white flash is exposed.
      const initialBounds = bounds ?? {
        x: 0,
        y: 0,
        width: agentRequested ? 1024 : 1,
        height: agentRequested ? 768 : 1,
        scale: window.devicePixelRatio || 1,
      };
      const initialNavigation = pendingNavigation.current;
      const createUrl = initialNavigation?.url ?? urlRef.current;
      if (requestedAttachmentId) {
        receive(await nativeBrowser.attach(nativeId));
        // Detached windows initialize while hidden. Publish a hidden placement
        // without waiting for visibility or requestAnimationFrame; otherwise
        // native transfer readiness and showing the window wait on each other.
        await nativeBrowser.layout(nativeId, initialBounds, false);
      } else await nativeBrowser.create(nativeId, createUrl, initialBounds);
      created = true;
      if (terminated) return;
      if (disposed) {
        // A new page is not transferred until its owner receives onNativeReady.
        // Detached shells retain adopted pages, but must still release an
        // unpublished creation that finishes after its tab has closed.
        if (!requestedAttachmentId || !browserIsTransferred(nativeId))
          await nativeBrowser.close(nativeId);
        return;
      }
      nativePageId.current = nativeId;
      retiredNativeId.current = null;
      unregisterAgentPage = registerAgentBrowserPage(id, nativeId);
      setReadyId(nativeId);
      callbacks.current.onNativeReady?.(nativeId);
      // Native redirects update the committed page URL, not the user's next
      // navigation intent. Only a newer explicit submission needs forwarding.
      if (initialNavigation && pendingNavigation.current === initialNavigation)
        pendingNavigation.current = null;
      const pending = pendingNavigation.current;
      if (pending) await performNavigation(nativeId, pending);
    };
    void open().catch((reason) => {
      if (!disposed) {
        setError(errorMessage(reason));
        setLoading(false);
      }
      unlisten?.();
      if (created && !terminated && !browserIsTransferred(nativeId))
        void nativeBrowser
          .close(nativeId)
          .catch((error) => logError("Close browser", error));
    });
    return () => {
      disposed = true;
      unregisterUpdatePage();
      if (retireForSleep.current === retireSleepingPage)
        retireForSleep.current = () => {};
      if (nativePageId.current === nativeId) nativePageId.current = null;
      if (!browserIsTransferred(nativeId)) unregisterAgentPage?.();
      unlisten?.();
      if (created && !terminated && !browserIsTransferred(nativeId))
        void nativeBrowser
          .close(nativeId)
          .catch((error) => logError("Close browser", error));
    };
  }, [hasUrl, id, retryGeneration, requestedAttachmentId, sleeping]);

  useEffect(() => {
    if (!readyId || !host.current) return;
    const controller = createBrowserPresentation({
      surfaceId: id,
      pageId: readyId,
      element: host.current,
      readState: () => ({
        visible: presentation.current.visible,
        paused: !!presentation.current.error,
        nativeId: nativePageId.current,
        holesSupported: nativeHoles.current,
        url: urlRef.current,
        navigation: navigationSequence.current,
        zoom: snapshotZoom.current,
      }),
      onSnapshot: (captured) => {
        if (captured) flushSync(() => setSnapshot(captured));
        else setSnapshot(null);
      },
      onNotice: setNotice,
    });
    presentationController.current = controller;
    return () => {
      controller.dispose();
      presentationController.current = null;
    };
  }, [readyId]);

  useLayoutEffect(() => {
    // Overlay captures are temporary backing images, not workspace previews.
    // Release their decoded pixels/base64 once the pane no longer presents them.
    if (!visible || error) setSnapshot(null);
    // Register before any outgoing page decides to hide in this commit. An
    // empty new tab, or one still asleep, has no native page about to show:
    // holding the outgoing surface would leave it showing through this pane
    // for the full handoff deadline.
    if (visible && !error && hasUrl && !sleeping && isTauri())
      beginBrowserHandoff(id);
    else endBrowserHandoff(id);
    presentationController.current?.update();
  }, [visible, error, hasUrl, sleeping, expanded, id]);

  useEffect(() => {
    if (!loading || !isTauri()) return;
    const timeout = window.setTimeout(() => {
      // A page already showing that keeps streaming video, live data or
      // trackers never finishes loading; that isn't worth a warning.
      const notice = slowPageNotice(urlRef.current, loadProgressRef.current);
      if (notice) setNotice(notice);
    }, SLOW_PAGE_MS);
    return () => clearTimeout(timeout);
  }, [loading, url]);

  const navigate = (value: string) => {
    try {
      const target = resolveBrowserAddress(value);
      markup.leave();
      setAddress(target);
      setNotice(null);
      setError(null);
      setLoading(isTauri());
      const navigation = {
        sequence: ++navigationSequence.current,
        url: target,
      };
      pendingNavigation.current = navigation;
      const nativeId = nativePageId.current;
      if (nativeId) {
        // Native state commits the URL; failed or obsolete submissions cannot
        // replace the loaded page or cancel a newer navigation.
        void performNavigation(nativeId, navigation);
      } else {
        urlRef.current = target;
        setUrl(target);
        if (error) {
          // A detached tab may still advertise the old native ID. Only a
          // structured close event retires it; never reattach to that page.
          const retired = retiredNativeId.current;
          if (retired)
            setNativeAttachment((previous) =>
              previous.requestedId === retired
                ? { ...previous, requestedId: undefined }
                : previous,
            );
          setRetryGeneration((generation) => generation + 1);
        }
      }
    } catch (reason) {
      setNotice(errorMessage(reason));
    }
  };

  // A local preview whose server is not running (after a restart, say) can
  // start the project's dev script and reloads once the server answers.
  const devServer = useDevServerStart({
    project,
    url: address || url,
    error,
    loading,
    reload: () => navigate(address || url),
  });

  const action = (kind: BrowserAction) => {
    if (!readyId) return;
    if (kind === "back" || kind === "forward" || kind === "reload")
      markup.leave();
    setNotice(null);
    void nativeBrowser
      .action(readyId, kind)
      .catch((reason) =>
        setNotice(`Browser action unavailable: ${errorMessage(reason)}`),
      );
  };

  const offeredNoticeAction =
    readyId && notice && noticeAction?.notice === notice
      ? noticeAction.action
      : null;
  // The notice stays up: opening System Settings is only the first step.
  const runNoticeAction = () => {
    if (!readyId || !offeredNoticeAction) return;
    void nativeBrowser
      .action(readyId, "notice-action")
      .catch((reason) =>
        setNotice(`Browser action unavailable: ${errorMessage(reason)}`),
      );
  };
  const dismissNotice = () => {
    // Chromium keeps an action notice until told, so it would come back with
    // the page's next update. Closing it is best effort.
    if (readyId && offeredNoticeAction)
      void nativeBrowser.action(readyId, "notice-dismiss").catch(() => {});
    setNotice(null);
  };
  const captureLabel =
    capture.microphone && capture.camera
      ? "This page is using your camera and microphone"
      : capture.camera
        ? "This page is using your camera"
        : capture.microphone
          ? "This page is using your microphone"
          : null;

  const cancelFindTimer = () => {
    if (findTimer.current != null) window.clearTimeout(findTimer.current);
    findTimer.current = null;
  };
  const find = (forward = true, findNext = false) => {
    cancelFindTimer();
    if (!readyId || !findText) return;
    const generation = ++findGeneration.current;
    setFinding(true);
    void nativeBrowser
      .find(readyId, findText, forward, findNext)
      .catch((reason) => {
        if (generation !== findGeneration.current) return;
        setFinding(false);
        setNotice(`Find in page unavailable: ${errorMessage(reason)}`);
      });
  };
  const closeFind = () => {
    cancelFindTimer();
    ++findGeneration.current;
    setFindOpen(false);
    setFinding(false);
    setFindResult(null);
    action("stop-find");
  };
  const openFind = () => {
    if (!readyId) return;
    setToolsMenu(null);
    setFindOpen(true);
    findInput.current?.focus();
    findInput.current?.select();
    focusShellForToolbar(findInput.current);
  };
  useLayoutEffect(() => {
    if (findOpen && visible) {
      findInput.current?.focus({ preventScroll: true });
      findInput.current?.select();
      // Native toolbar shortcuts already own the window-to-shell handoff.
      if (!pendingToolbar) focusShellForToolbar(findInput.current);
    }
  }, [findOpen]);
  useLayoutEffect(() => {
    presentationController.current?.update();
  }, [findOpen, downloadsOpen]);

  useEffect(() => {
    if (!readyId || !findOpen || !visible) return;
    const generation = ++findGeneration.current;
    setFindResult(null);
    if (!findText) {
      setFinding(false);
      void nativeBrowser
        .action(readyId, "stop-find")
        .catch((reason) =>
          setNotice(`Find in page unavailable: ${errorMessage(reason)}`),
        );
      return;
    }
    setFinding(true);
    findTimer.current = window.setTimeout(() => {
      findTimer.current = null;
      void nativeBrowser
        .find(readyId, findText, true, false)
        .catch((reason) => {
          if (generation !== findGeneration.current) return;
          setFinding(false);
          setNotice(`Find in page unavailable: ${errorMessage(reason)}`);
        });
    }, 180);
    return () => {
      cancelFindTimer();
      ++findGeneration.current;
    };
  }, [readyId, findOpen, findText, visible]);

  useEffect(() => {
    if (!readyId) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void nativeBrowser
      .listenToolbar((command) => {
        if (disposed || command.id !== readyId) return;
        // A workspace-window return may dock this page before the owning
        // workspace becomes visible. Preserve its shortcut until that handshake finishes.
        setPendingToolbar({ action: command.action });
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [readyId]);

  useEffect(() => {
    if (!readyId) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void nativeBrowser
      .listenOpenTab((request) => {
        if (disposed || request.id !== readyId) return;
        const openTab = callbacks.current.onOpenTab;
        if (openTab) {
          openTab(request.url, request.background);
          return;
        }
        void nativeBrowser.navigate(readyId, request.url).catch((reason) => {
          if (!disposed)
            setNotice(`Could not open the link: ${errorMessage(reason)}`);
        });
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [readyId]);

  useEffect(() => {
    if (!pendingToolbar || !readyId || !visible) return;
    let disposed = false;
    const command = pendingToolbar;
    setToolsMenu(null);
    if (command.action === "find") setFindOpen(true);
    const focus = async () => {
      const owner = getCurrentWindow();
      await owner.unminimize();
      if (disposed) return;
      await owner.show();
      if (disposed) return;
      await owner.setFocus();
      if (disposed) return;
      // Native Chromium and the WK shell are sibling NSViews. DOM focus alone
      // cannot transfer macOS first responder between them.
      await getCurrentWebview().setFocus();
      if (disposed) return;
      browserPageHasNativeFocus.current = false;
      const input =
        command.action === "find" ? findInput.current : addressInput.current;
      input?.focus({ preventScroll: true });
      input?.select();
      setPendingToolbar((current) => (current === command ? null : current));
    };
    void focus().catch((reason) => {
      if (disposed) return;
      setNotice(`Could not focus browser toolbar: ${errorMessage(reason)}`);
      setPendingToolbar((current) => (current === command ? null : current));
    });
    return () => {
      disposed = true;
    };
  }, [pendingToolbar, readyId, visible]);

  useEffect(() => {
    if (!readyId || !downloadsOpen || !visible) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let events = 0;
    setDownloadsLoading(true);
    setDownloadsError(null);
    void (async () => {
      unlisten = await nativeBrowser.listenDownloads((event) => {
        if (disposed || event.id !== readyId) return;
        events++;
        setDownloads(event.downloads);
        setDownloadsLoading(false);
        setDownloadsError(null);
      });
      if (disposed) {
        unlisten();
        return;
      }
      const before = events;
      const current = await nativeBrowser.downloads(readyId);
      if (!disposed && before === events) setDownloads(current);
    })()
      .catch((reason) => {
        if (!disposed)
          setDownloadsError(`Downloads unavailable: ${errorMessage(reason)}`);
      })
      .finally(() => {
        if (!disposed) setDownloadsLoading(false);
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [readyId, downloadsOpen, visible]);

  const downloadAction = (
    downloadId: string,
    action: "open" | "reveal" | "cancel",
  ) => {
    if (!readyId) return;
    void nativeBrowser
      .downloadAction(readyId, downloadId, action)
      .catch((reason) =>
        setDownloadsError(
          `Could not ${action} this download: ${errorMessage(reason)}`,
        ),
      );
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    navigate(address);
    addressInput.current?.blur();
  };
  const openExternal = () => {
    if (!url) return;
    void openBrowserExternally(url).catch((reason) =>
      setNotice(errorMessage(reason)),
    );
  };
  const addToChat = () =>
    callbacks.current.onAddToChat?.(`${title ? `${title}\n` : ""}${url}`);
  const setPageEditing = (active: boolean) => {
    if (!readyId) return;
    if (!active) {
      stopPageEditing();
      return;
    }
    const request = ++editRequest.current;
    editToken.current = crypto.randomUUID();
    editStopRequest.current = null;
    editingActive.current = active;
    setEditing(active);
    setToolsMenu(null);
    void nativeBrowser
      .edit(readyId, active, editToken.current)
      .catch((reason) => {
        if (request !== editRequest.current) return;
        editingActive.current = false;
        setEditing(false);
        setNotice(`Could not select a page element: ${errorMessage(reason)}`);
      });
  };
  const pickToolAction = (choice: string) => {
    if (!presentation.current.visible) return;
    setToolsMenu(null);
    if (
      choice === "zoom-in" ||
      choice === "zoom-out" ||
      choice === "zoom-reset"
    )
      action(choice);
    if (choice === "chat") addToChat();
    if (choice === "markup") markup.start();
    if (choice === "external") openExternal();
    if (choice === "find") openFind();
    if (choice === "downloads") setDownloadsOpen((open) => !open);
    if (choice === "devtools" && readyId)
      void nativeBrowser
        .action(readyId, "devtools")
        .catch((reason) =>
          setNotice(`Developer tools unavailable: ${errorMessage(reason)}`),
        );
  };
  // With page cut-outs, the in-app menu appears over the live page on its
  // first frame; the separate native panel is only needed without them.
  const nativeToolsMenu = nativeMenus && !holeMenus && !!readyId;
  const openTools = (button: HTMLButtonElement) => {
    setToolsMenu(toolsMenu ? null : browserMenuPosition(button));
  };
  const utilityItems: ExplorerMenuItem[] = [
    ...(nativeToolsMenu
      ? [
          {
            kind: "item" as const,
            id: "zoom-out",
            label: "Zoom out",
            shortcut: "⌘−",
          },
          {
            kind: "item" as const,
            id: "zoom-reset",
            label: `Reset zoom (${Math.round((zoomFactor ?? 1) * 100)}%)`,
            shortcut: "⌘0",
          },
          {
            kind: "item" as const,
            id: "zoom-in",
            label: "Zoom in",
            shortcut: "⌘+",
          },
          { kind: "sep" as const },
        ]
      : []),
    {
      kind: "item",
      id: "find",
      label: "Find in page",
      shortcut: "⌘F",
      disabled: !readyId,
    },
    { kind: "item", id: "downloads", label: "Downloads", disabled: !readyId },
    {
      kind: "item",
      id: "devtools",
      label: "Developer tools",
      disabled: !readyId,
    },
    { kind: "sep" },
    ...(onAddToChat
      ? [
          {
            kind: "item" as const,
            id: "chat",
            label: "Add URL to chat",
            disabled: !url,
          },
        ]
      : []),
    ...(markupAvailable
      ? [
          {
            kind: "item" as const,
            id: "markup",
            label: "Mark up page",
            disabled: !readyId || !url || editing || !!markup.state,
          },
        ]
      : []),
    {
      kind: "item",
      id: "external",
      label: `Open in ${EXTERNAL_BROWSER_NAME}`,
      disabled: !url,
    },
  ];

  return (
    <section
      className="browser-pane"
      aria-label="Browser preview"
      data-browser-pane={id}
      data-tour="browser-pane"
      // No page yet: the pane shows the workspace background like other panes.
      data-blank={(!url && !error && !sleeping) || undefined}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && !event.altKey) {
          if (event.key.toLowerCase() === "f" && readyId) {
            event.preventDefault();
            event.stopPropagation();
            openFind();
          } else if (readyId && ["+", "=", "-", "0"].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            action(
              event.key === "0"
                ? "zoom-reset"
                : event.key === "-"
                  ? "zoom-out"
                  : "zoom-in",
            );
          } else if (event.key.toLowerCase() === "l") {
            event.preventDefault();
            event.stopPropagation();
            addressInput.current?.focus();
            addressInput.current?.select();
            focusShellForToolbar(addressInput.current);
          }
        }
      }}
    >
      <form className="browser-toolbar" onSubmit={submit}>
        <div className="browser-navigation">
          <button
            type="button"
            className="browser-icon-button"
            aria-label="Go back"
            title="Go back"
            disabled={!readyId || !history.back}
            onClick={() => action("back")}
          >
            <ChevronLeft size={15} />
          </button>
          <button
            type="button"
            className="browser-icon-button"
            aria-label="Go forward"
            title="Go forward"
            disabled={!readyId || !history.forward}
            onClick={() => action("forward")}
          >
            <ChevronRight size={15} />
          </button>
          <button
            type="button"
            className="browser-icon-button"
            aria-label={loading && !error ? "Stop loading" : "Reload preview"}
            title={loading && !error ? "Stop loading" : "Reload preview"}
            disabled={!url || (loading && !readyId)}
            onClick={() =>
              loading && !error
                ? action("stop")
                : error
                  ? navigate(url)
                  : action("reload")
            }
          >
            {loading && !error ? <X size={14} /> : <RefreshCw size={14} />}
          </button>
        </div>
        <BrowserProjectMark project={project} />
        <input
          ref={addressInput}
          className="browser-address"
          aria-label="Preview address"
          placeholder="Search or enter a web address"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            if (browserPageHasNativeFocus.current) {
              // WK can retain the address as its DOM activeElement while CEF
              // owns native focus, so another click won't fire onFocus again.
              event.preventDefault();
              event.currentTarget.focus({ preventScroll: true });
              event.currentTarget.select();
            }
            focusShellForToolbar(event.currentTarget);
          }}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
        />
        {captureLabel ? (
          <span
            className="browser-capture"
            role="img"
            aria-label={captureLabel}
            title={captureLabel}
          >
            {capture.camera ? <Video size={14} /> : null}
            {capture.microphone ? <Mic size={14} /> : null}
          </span>
        ) : null}
        {onAddToChat ? (
          <button
            type="button"
            className={`browser-icon-button${editing ? " browser-edit-done" : ""}`}
            aria-label={editing ? "Stop commenting" : "Comment on page"}
            title={
              editing
                ? "Stop commenting (Esc)"
                : "Click part of the page and leave a comment for the agent"
            }
            aria-pressed={editing}
            disabled={!readyId || !url || markup.active}
            onClick={() => setPageEditing(!editing)}
          >
            {editing ? (
              <>
                <X size={13} />
                <span>Done</span>
              </>
            ) : (
              <Pencil size={14} />
            )}
          </button>
        ) : null}
        {markupAvailable ? (
          <button
            type="button"
            className="browser-icon-button"
            aria-label="Mark up page"
            title="Mark up page"
            aria-pressed={markup.active}
            disabled={!readyId || !url || editing || markup.busy}
            onClick={() => (markup.active ? markup.leave() : markup.start())}
          >
            <Pen size={14} />
          </button>
        ) : null}
        <button
          type="button"
          className="browser-icon-button browser-utility"
          aria-label={`Open preview in ${EXTERNAL_BROWSER_NAME}`}
          title={`Open in ${EXTERNAL_BROWSER_NAME}`}
          disabled={!url}
          onClick={openExternal}
        >
          <ExternalLink size={14} />
        </button>
        <button
          ref={toolsButton}
          type="button"
          className="browser-icon-button browser-toolbar-more"
          aria-label="More browser actions"
          title="More browser actions"
          aria-haspopup="menu"
          aria-expanded={Boolean(toolsMenu)}
          onClick={(event) => openTools(event.currentTarget)}
        >
          <MoreHorizontal size={14} />
        </button>
        {onToggleExpand ? (
          <button
            type="button"
            className="browser-icon-button"
            aria-label={expanded ? "Restore split" : "Expand preview"}
            aria-pressed={expanded}
            title={expanded ? "Restore split" : "Expand preview"}
            onClick={onToggleExpand}
          >
            <Maximize2 size={14} />
          </button>
        ) : null}
        {onClose ? (
          <button
            type="button"
            className="browser-icon-button"
            aria-label="Close browser preview"
            title="Close preview"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        ) : null}
        {loading && !error ? (
          <span
            className={`browser-load-indicator${loadProgress == null ? " is-indeterminate" : ""}`}
            role="progressbar"
            aria-label="Loading preview"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={
              loadProgress == null ? undefined : Math.round(loadProgress * 100)
            }
            style={
              loadProgress == null
                ? undefined
                : { width: `${loadProgress * 100}%` }
            }
          >
            <span className="browser-loading-label">Loading preview…</span>
          </span>
        ) : null}
      </form>
      {editing && (
        <div className="browser-edit-hint" role="status">
          <Pencil size={13} />
          <span>
            Click part of the page, then add a comment. Press Esc to stop.
          </span>
        </div>
      )}
      {toolsMenu ? (
        <ExplorerMenu
          x={toolsMenu.x}
          y={toolsMenu.y}
          anchor={toolsButton}
          align="end"
          gap={4}
          width={BROWSER_ACTIONS_WIDTH}
          native={nativeToolsMenu}
          onError={() =>
            setNotice("Could not open browser actions. Please try again.")
          }
          className="browser-actions-menu"
          header={
            nativeToolsMenu ? undefined : (
              <div
                className="browser-menu-heading"
                onKeyDown={(event) => event.stopPropagation()}
              >
                <span className="browser-engine-label">Zoom</span>
                <div
                  className="browser-zoom-controls"
                  role="group"
                  aria-label="Page zoom"
                >
                  <button
                    type="button"
                    aria-label="Zoom out"
                    disabled={!readyId}
                    onClick={() => action("zoom-out")}
                  >
                    <Minus size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label="Reset page zoom"
                    title="Reset page zoom"
                    disabled={!readyId}
                    onClick={() => action("zoom-reset")}
                  >
                    {`${Math.round((zoomFactor ?? 1) * 100)}%`}
                  </button>
                  <button
                    type="button"
                    aria-label="Zoom in"
                    disabled={!readyId}
                    onClick={() => action("zoom-in")}
                  >
                    <Plus size={13} />
                  </button>
                </div>
              </div>
            )
          }
          ariaLabel="Browser actions"
          items={utilityItems}
          onPick={pickToolAction}
          onClose={() => setToolsMenu(null)}
        />
      ) : null}
      {findOpen ? (
        <div
          className="browser-find-bar"
          role="search"
          aria-label="Find in page"
        >
          <Search size={13} aria-hidden="true" />
          <input
            ref={findInput}
            onPointerDown={(event) => {
              if (event.button === 0) focusShellForToolbar(event.currentTarget);
            }}
            aria-label="Find text in page"
            placeholder="Find in page"
            value={findText}
            onChange={(event) => setFindText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                find(!event.shiftKey, true);
              }
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closeFind();
              }
            }}
          />
          <span className="browser-find-count" aria-live="polite">
            {!findText
              ? ""
              : findResult?.query === findText
                ? findResult.totalMatches === 0
                  ? "No matches"
                  : `${findResult.activeMatch} of ${findResult.totalMatches}`
                : finding
                  ? "Searching…"
                  : "—"}
          </span>
          <button
            type="button"
            className="browser-icon-button"
            aria-label="Previous match"
            disabled={!findText || !readyId}
            onClick={() => find(false, true)}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            className="browser-icon-button"
            aria-label="Next match"
            disabled={!findText || !readyId}
            onClick={() => find(true, true)}
          >
            <ChevronRight size={14} />
          </button>
          <button
            type="button"
            className="browser-icon-button"
            aria-label="Close find in page"
            onClick={closeFind}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}
      {downloadsOpen ? (
        <div className="browser-downloads" aria-label="Browser downloads">
          <div className="browser-downloads-heading">
            <strong>Downloads</strong>
            <button
              type="button"
              className="browser-icon-button"
              aria-label="Close downloads"
              onClick={() => setDownloadsOpen(false)}
            >
              <X size={14} />
            </button>
          </div>
          {downloadsError ? <p role="status">{downloadsError}</p> : null}
          {downloadsLoading ? (
            <p role="status">Loading downloads…</p>
          ) : !downloads.length && !downloadsError ? (
            <p>No downloads for this browser tab.</p>
          ) : null}
          <ul>
            {downloads.map((download) => (
              <li key={download.id}>
                <div className="browser-download-details">
                  <strong title={download.filename}>{download.filename}</strong>
                  <span>
                    {download.state === "in-progress"
                      ? browserDownloadProgress(download)
                      : download.state === "completed"
                        ? "Completed"
                        : download.state === "cancelled"
                          ? "Cancelled"
                          : download.error || "Download failed"}
                  </span>
                </div>
                {download.state === "in-progress" ? (
                  <button
                    type="button"
                    onClick={() => downloadAction(download.id, "cancel")}
                  >
                    Cancel
                  </button>
                ) : download.state === "completed" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => downloadAction(download.id, "open")}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadAction(download.id, "reveal")}
                    >
                      Show in Finder
                    </button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {notice ? (
        <div className="browser-notice" role="status">
          <span>{notice}</span>
          {offeredNoticeAction ? (
            <button
              type="button"
              className="browser-notice-action"
              onClick={runNoticeAction}
            >
              {BROWSER_NOTICE_ACTION_LABELS[offeredNoticeAction]}
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Dismiss preview notice"
            onClick={dismissNotice}
          >
            <X size={12} />
          </button>
        </div>
      ) : null}
      <div ref={host} className="browser-native-host">
        {markupImage && snapshot?.src === markupImage.image.src && !error ? (
          <BrowserMarkup
            image={markupImage.image}
            ready={markupImage.ready}
            leaving={markupImage.leaving}
            onSend={markup.send}
            onClose={markup.leave}
          />
        ) : snapshot && !error ? (
          <img
            className="browser-page-snapshot"
            src={snapshot.src}
            style={{
              width: snapshot.width,
              height: snapshot.height,
              left: snapshot.left,
              top: snapshot.top,
            }}
            alt=""
            aria-hidden="true"
            draggable={false}
          />
        ) : null}
        {sleeping ? (
          <div className="browser-empty" role="status">
            <strong>{visible ? "Restoring tab…" : "Tab sleeping"}</strong>
            <p>
              Memory saver released this inactive page. It reloads when
              reopened.
            </p>
          </div>
        ) : error ? (
          <div className="browser-empty" role="status">
            <span className="browser-empty-mark">↗</span>
            <strong>Preview unavailable</strong>
            <p>{error}</p>
            {devServer.starting ? (
              <p data-dev-server-starting>
                Starting the dev server with “{devServer.starting.run}”. This
                tab reloads when it answers.
              </p>
            ) : devServer.hint ? (
              <p data-dev-server-hint>{devServer.hint}</p>
            ) : null}
            {browserSearchSuggestion(address || url) ? (
              <p>
                This looks like a search term. Enter a full address such as
                google.com, or search for it below.
              </p>
            ) : null}
            <div className="browser-empty-actions">
              {devServer.canStart ? (
                <button
                  type="button"
                  data-dev-server-start
                  title="Run the project's dev script in its terminal, then reload this tab when the server answers"
                  onClick={devServer.start}
                >
                  Start dev server
                </button>
              ) : null}
              <button type="button" onClick={() => navigate(address || url)}>
                Retry
              </button>
              {browserSearchSuggestion(address || url) ? (
                <button
                  type="button"
                  onClick={() =>
                    navigate(browserSearchSuggestion(address || url)!)
                  }
                >
                  Search for {browserSearchSuggestion(address || url)}
                </button>
              ) : null}
              {url ? (
                <button type="button" onClick={openExternal}>
                  Open in {EXTERNAL_BROWSER_NAME}
                </button>
              ) : null}
            </div>
          </div>
        ) : !isTauri() && url ? (
          <div className="browser-empty">
            <span className="browser-empty-mark">↗</span>
            <strong>Open the desktop app to preview</strong>
            <p>The embedded browser is available in Aven for Mac.</p>
            <a href={url} target="_blank" rel="noreferrer">
              Open this address
            </a>
          </div>
        ) : !url ? (
          <div className="browser-empty">
            <span className="browser-empty-mark">↗</span>
            <strong>Your work, in view.</strong>
            <p>
              Search the web, open a website, or preview a local development
              server beside your conversation.
            </p>
            <button
              type="button"
              onClick={() => {
                addressInput.current?.focus({ preventScroll: true });
                addressInput.current?.select();
                focusShellForToolbar(addressInput.current);
              }}
            >
              Enter an address
            </button>
          </div>
        ) : (
          <div className="browser-empty" aria-hidden="true">
            <span className="browser-empty-mark">↗</span>
            <p>
              {loading ? "Opening preview…" : "Preview is behind this panel"}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

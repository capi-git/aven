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
import { registerBrowserMemoryPage } from "../lib/browserMemory";
import { loadBrowserMemorySaver } from "../lib/settings";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
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
  Pencil,
  Maximize2,
  MoreHorizontal,
  Minus,
  Plus,
  Search,
  RefreshCw,
  X,
} from "../chrome/icons";
import { ExplorerMenu, type ExplorerMenuItem } from "../chrome/ExplorerMenu";
import {
  browserBounds,
  browserDownloadProgress,
  browserEditAttachment,
  browserSearchSuggestion,
  nativeBrowser,
  openBrowserExternally,
  resolveBrowserAddress,
  type BrowserBounds,
  type BrowserAction,
  type BrowserDownload,
  type BrowserFindResult,
  type BrowserState,
} from "../lib/browser";
import { useBrowserDropIndicator } from "../hooks/useBrowserDropIndicator";
import "./BrowserPane.css";
import type { Attachment } from "../lib/session";

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
  pictureInPictureRequest?: number;
  onPictureInPictureChange?: (floating: boolean) => void;
  onPictureInPictureResult?: (
    request: number,
    label: string | null,
    error?: string,
  ) => void;
  expanded?: boolean;
  onToggleExpand?: () => void;
};

const OVERLAYS =
  '[aria-modal="true"], [role="dialog"], [role="menu"], [role="listbox"], [data-popover-side], [data-native-browser-occluded="true"]';
const LAYOUT_FALLBACK_MS = 100;
const OVERLAY_SNAPSHOT_DEADLINE_MS = 80;
const SNAPSHOT_PAINT_DEADLINE_MS = 16;
const ZOOM_SNAPSHOT_DELAY_MS = 60;
const BROWSER_ACTIONS_WIDTH = 224;

type BrowserSnapshot = {
  src: string;
  width: number;
  height: number;
  scale: number;
  left: number;
  top: number;
};
type SnapshotRequest = {
  capture: () => Promise<BrowserSnapshot>;
  relevant: () => boolean;
  resolve: (snapshot: BrowserSnapshot | null) => void;
};
const snapshotRequests = new Map<
  string,
  { running: boolean; queued: SnapshotRequest | null }
>();

/** Keep expensive native captures bounded even when a renderer is replaced. */
function requestBrowserSnapshot(
  id: string,
  capture: SnapshotRequest["capture"],
  relevant: SnapshotRequest["relevant"],
): Promise<BrowserSnapshot | null> {
  let slot = snapshotRequests.get(id);
  if (!slot) {
    slot = { running: false, queued: null };
    snapshotRequests.set(id, slot);
  }
  const state = slot;
  return new Promise((resolve) => {
    const request = { capture, relevant, resolve };
    const finish = () => {
      state.running = false;
      const next = state.queued;
      state.queued = null;
      if (next) run(next);
      else if (snapshotRequests.get(id) === state) snapshotRequests.delete(id);
    };
    const run = (next: SnapshotRequest) => {
      state.running = true;
      try {
        if (!next.relevant()) {
          next.resolve(null);
          finish();
          return;
        }
        void next
          .capture()
          .then(next.resolve, () => next.resolve(null))
          .finally(finish);
      } catch {
        next.resolve(null);
        finish();
      }
    };
    if (state.running) {
      state.queued?.resolve(null);
      state.queued = request;
    } else run(request);
  });
}

function snapshotViewport(bounds: BrowserBounds) {
  const left = Math.round(bounds.x * bounds.scale) / bounds.scale;
  const top = Math.round(bounds.y * bounds.scale) / bounds.scale;
  const right =
    Math.round((bounds.x + bounds.width) * bounds.scale) / bounds.scale;
  const bottom =
    Math.round((bounds.y + bounds.height) * bounds.scale) / bounds.scale;
  return {
    width: right - left,
    height: bottom - top,
    scale: bounds.scale,
    left: left - bounds.x,
    top: top - bounds.y,
  };
}

function sameSnapshotViewport(
  a: Omit<BrowserSnapshot, "src">,
  b: Omit<BrowserSnapshot, "src">,
) {
  return (
    a.scale === b.scale &&
    Math.abs(a.width - b.width) < 0.00001 &&
    Math.abs(a.height - b.height) < 0.00001 &&
    Math.abs(a.left - b.left) < 0.00001 &&
    Math.abs(a.top - b.top) < 0.00001
  );
}

function browserMenuPosition(button: HTMLButtonElement) {
  const rect = button.getBoundingClientRect();
  return {
    x: Math.max(8, rect.right - BROWSER_ACTIONS_WIDTH),
    y: rect.bottom + 4,
  };
}

function clipHoverSidebars(bounds: BrowserBounds): BrowserBounds {
  let clipLeft = 0;
  let clipRight = 0;
  for (const element of document.querySelectorAll<HTMLElement>(
    '[data-native-browser-occluded="true"][data-native-browser-edge]',
  )) {
    const style = getComputedStyle(element);
    if (
      style.visibility === "hidden" ||
      element.closest('[hidden], [inert], [aria-hidden="true"]')
    )
      continue;
    // The active marker is authoritative even at opacity zero on the first
    // reveal frame; waiting for the fade would paint Chromium over the panel.
    // Reserve the final edge during the short reveal animation. The page
    // stays in place instead of reflowing or being captured as a still image.
    const shift =
      style.transform && style.transform !== "none"
        ? new DOMMatrixReadOnly(style.transform).m41
        : 0;
    for (const rect of element.getClientRects()) {
      if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        rect.bottom <= bounds.y ||
        rect.top >= bounds.y + bounds.height
      )
        continue;
      if (
        element.dataset.nativeBrowserEdge === "left" &&
        rect.left < bounds.x + bounds.width &&
        rect.right > bounds.x
      )
        clipLeft = Math.max(
          clipLeft,
          rect.right - Math.min(0, shift) - bounds.x,
        );
      if (
        element.dataset.nativeBrowserEdge === "right" &&
        rect.right > bounds.x &&
        rect.left < bounds.x + bounds.width
      )
        clipRight = Math.max(
          clipRight,
          bounds.x + bounds.width - rect.left + Math.max(0, shift),
        );
    }
  }
  clipLeft = Math.min(bounds.width, Math.max(0, clipLeft));
  clipRight = Math.min(bounds.width - clipLeft, Math.max(0, clipRight));
  return clipLeft || clipRight ? { ...bounds, clipLeft, clipRight } : bounds;
}

function hasVisibleBrowserArea(bounds: BrowserBounds): boolean {
  return bounds.width - (bounds.clipLeft ?? 0) - (bounds.clipRight ?? 0) >= 1;
}

function hasOccludingOverlay(bounds: BrowserBounds): boolean {
  return [...document.querySelectorAll<HTMLElement>(OVERLAYS)].some(
    (element) => {
      if (element.dataset.nativeBrowserEdge) return false;
      const style = getComputedStyle(element);
      if (style.visibility === "hidden" || style.opacity === "0") return false;
      const rects = [...element.getClientRects()].filter(
        (rect) => rect.width > 0 && rect.height > 0,
      );
      // Real modal dialogs block the entire workspace. Nonmodal surfaces only
      // occlude the child where they overlap; a dismiss catcher is not a panel.
      if (element.getAttribute("aria-modal") === "true")
        return rects.length > 0;
      return rects.some(
        (rect) =>
          rect.left < bounds.x + bounds.width - (bounds.clipRight ?? 0) &&
          rect.right > bounds.x + (bounds.clipLeft ?? 0) &&
          rect.top < bounds.y + bounds.height &&
          rect.bottom > bounds.y,
      );
    },
  );
}

function startsWithUrl(value?: string): string {
  if (!value) return "";
  try {
    return resolveBrowserAddress(value);
  } catch {
    return "";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  pictureInPictureRequest = 0,
  onPictureInPictureChange,
  onPictureInPictureResult,
  attachedNativeId,
  onNativeReady,
  expanded = false,
  onToggleExpand,
}: BrowserPaneProps) {
  const [url, setUrl] = useState(() => startsWithUrl(initialUrl));
  const [address, setAddress] = useState(initialUrl ?? "");
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState<number | null>(null);
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
  const [floating, setFloating] = useState(false);
  editVisible.current = visible && !floating;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [toolsMenu, setToolsMenu] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [nativeMenus, setNativeMenus] = useState(false);
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
  const previousSnapshotZoom = useRef(zoomFactor);
  const refreshZoomSnapshot = useRef<(refresh: boolean) => void>(() => {});
  const nativePageId = useRef<string | null>(null);
  const nativeGeneration = useRef(0);
  const retiredNativeId = useRef<string | null>(null);
  useBrowserDropIndicator(
    host,
    readyId,
    nativeDropIndicator && visible && !floating && !error,
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
    onPictureInPictureChange,
    onPictureInPictureResult,
  });
  callbacks.current = {
    onNativeReady,
    onUrlChange,
    onTitleChange,
    onFaviconChange,
    onAddToChat,
    onFocus,
    onPictureInPictureChange,
    onPictureInPictureResult,
  };
  const toolbarFocusGeneration = useRef(0);
  const toolbarFocusTarget = useRef<HTMLInputElement | null>(null);
  const browserPageHasNativeFocus = useRef(false);
  const toolbarPresentation = useRef({ visible, floating });
  toolbarPresentation.current = { visible, floating };
  const focusShellForToolbar = useCallback((input: HTMLInputElement | null) => {
    if (
      !input ||
      !isTauri() ||
      !toolbarPresentation.current.visible ||
      toolbarPresentation.current.floating
    )
      return;
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
          toolbarPresentation.current.floating ||
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
  }, [visible, floating]);
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
    if ((visible && !floating) || !readyId || !editingActive.current) return;
    editingActive.current = false;
    ++editRequest.current;
    setEditing(false);
    void nativeBrowser.edit(readyId, false, editToken.current).catch(() => {});
  }, [visible, floating, readyId]);
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
        setNotice(`Could not exit edit mode: ${errorMessage(reason)}`);
      })
      .finally(() => {
        if (editStopRequest.current === request) editStopRequest.current = null;
      });
  }, [readyId]);
  useEffect(() => {
    if (!editing || !readyId || !visible || floating) return;
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
  }, [editing, readyId, visible, floating, stopPageEditing]);
  const presentation = useRef({ visible, error, floating });
  presentation.current = { visible, error, floating };
  useEffect(() => {
    setToolsMenu(null);
  }, [readyId, visible, floating]);
  const requestedPictureInPicture = useRef(0);
  const scheduleLayout = useRef<() => void>(() => {});
  const hasUrl = !!url;
  const focusNewAddress = useRef(!hasUrl);
  const sleepProtection =
    floating ||
    loading ||
    !!error ||
    editing ||
    !!attachedNativeId ||
    isDetachedWorkspace() ||
    !!toolsMenu ||
    findOpen ||
    address !== url ||
    (pictureInPictureRequest > 0 &&
      pictureInPictureRequest !== requestedPictureInPicture.current);
  const memoryState = useRef({ visible, protected: sleepProtection });
  memoryState.current = { visible, protected: sleepProtection };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const wakePage = useCallback(async () => {
    wakeRequested.current = true;
    await sleepOperation.current?.catch(() => false);
    if (mounted.current) setSleeping(false);
  }, []);
  useEffect(
    () => (hasUrl && !error ? registerAgentBrowserWake(id, wakePage) : undefined),
    [id, hasUrl, error, wakePage],
  );
  useEffect(() => {
    if (visible || pictureInPictureRequest || attachedNativeId) void wakePage();
  }, [visible, pictureInPictureRequest, attachedNativeId, wakePage]);
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
            wakeRequested.current ||
            memoryState.current.visible ||
            !loadBrowserMemorySaver();
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
  }, [readyId, floating]);

  useEffect(() => {
    const changed = previousSnapshotZoom.current !== zoomFactor;
    previousSnapshotZoom.current = zoomFactor;
    if (!toolsMenu) refreshZoomSnapshot.current(false);
    else if (changed) refreshZoomSnapshot.current(true);
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
    let nativeFloating = false;
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
      setNativeDropIndicator(false);
      setError(null);
      setNotice(null);
      setSleeping(true);
    };
    retireForSleep.current = retireSleepingPage;
    nativePageId.current = null;
    setReadyId(null);
    setNativeMenus(false);
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
        setNativeDropIndicator(false);
        setToolsMenu(null);
        setFindOpen(false);
        setDownloadsOpen(false);
        setEditing(false);
        editingActive.current = false;
        setHistory({ back: false, forward: false });
        setLoadProgress(null);
        setFloating(false);
        if (nativeFloating) callbacks.current.onPictureInPictureChange?.(false);
        setError(
          state.error || "This browser page closed. Retry to reopen it.",
        );
        setNotice(null);
        return;
      }
      if (
        state.focused &&
        !browserPageHasNativeFocus.current &&
        presentation.current.visible &&
        !state.floating
      )
        callbacks.current.onFocus?.();
      if (state.focused && !browserPageHasNativeFocus.current) {
        ++toolbarFocusGeneration.current;
        toolbarFocusTarget.current = null;
      }
      browserPageHasNativeFocus.current = !!state.focused;
      const nextFloating = !!state.floating;
      setFloating(nextFloating);
      setNativeMenus(state.nativeMenus === true);
      setNativeDropIndicator(state.nativeDropIndicator === true);
      if (nextFloating) setSnapshot(null);
      if (nativeFloating && !nextFloating)
        callbacks.current.onPictureInPictureChange?.(false);
      nativeFloating = nextFloating;
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
        void nativeBrowser.close(nativeId).catch(() => {});
    });
    return () => {
      disposed = true;
      if (retireForSleep.current === retireSleepingPage)
        retireForSleep.current = () => {};
      if (nativePageId.current === nativeId) nativePageId.current = null;
      if (!browserIsTransferred(nativeId)) unregisterAgentPage?.();
      unlisten?.();
      if (created && !terminated && !browserIsTransferred(nativeId))
        void nativeBrowser.close(nativeId).catch(() => {});
    };
  }, [hasUrl, id, retryGeneration, requestedAttachmentId, sleeping]);

  useEffect(() => {
    if (!readyId || !host.current) return;
    let disposed = false;
    let frame: number | null = null;
    let fallback: number | null = null;
    let paintFrame: number | null = null;
    let paintFallback: number | null = null;
    let finishPaint: (() => void) | null = null;
    let finishCapture: (() => void) | null = null;
    let captureGeneration = 0;
    let zoomRefreshTimer: number | null = null;
    let zoomRefreshActive = false;
    let inFlight = false;
    let pending = false;
    let pendingImmediate = false;
    let placementInvalidated = false;
    let lastLayout = "";
    let lastGeometry = "";
    let lastBounds: BrowserBounds | null = null;
    let lastNativeBounds: BrowserBounds | null = null;
    // WK may report itself occluded by the native Chromium child. Presentation
    // belongs to the selected workspace pane; macOS hides minimized windows.
    const isPaused = () =>
      !presentation.current.visible ||
      presentation.current.floating ||
      !!presentation.current.error;
    const cancelQueued = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      if (fallback !== null) window.clearTimeout(fallback);
      frame = null;
      fallback = null;
    };
    const waitForSnapshotPaint = () =>
      new Promise<void>((resolve) => {
        const finish = () => {
          if (paintFrame !== null) cancelAnimationFrame(paintFrame);
          if (paintFallback !== null) window.clearTimeout(paintFallback);
          paintFrame = null;
          paintFallback = null;
          finishPaint = null;
          resolve();
        };
        finishPaint = finish;
        paintFrame = requestAnimationFrame(finish);
        paintFallback = window.setTimeout(finish, SNAPSHOT_PAINT_DEADLINE_MS);
      });
    const cancelOverlayCapture = () => {
      ++captureGeneration;
      if (zoomRefreshTimer !== null) window.clearTimeout(zoomRefreshTimer);
      zoomRefreshTimer = null;
      zoomRefreshActive = false;
      finishCapture?.();
      finishPaint?.();
    };
    const captureForOverlay = (zoomRefresh = false) =>
      new Promise<void>((resolve) => {
        const generation = ++captureGeneration;
        const capturedUrl = urlRef.current;
        const navigation = navigationSequence.current;
        const capturedZoom = snapshotZoom.current;
        const stillRelevant = () => {
          if (
            disposed ||
            generation !== captureGeneration ||
            nativePageId.current !== readyId ||
            urlRef.current !== capturedUrl ||
            navigationSequence.current !== navigation ||
            snapshotZoom.current.factor !== capturedZoom.factor ||
            (zoomRefresh && snapshotZoom.current.menu !== capturedZoom.menu)
          )
            return false;
          const bounds = currentBounds();
          return (
            !!bounds &&
            hasVisibleBrowserArea(bounds) &&
            hasOccludingOverlay(bounds)
          );
        };
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(deadline);
          finishCapture = null;
          resolve();
        };
        const deadline = window.setTimeout(
          finish,
          OVERLAY_SNAPSHOT_DEADLINE_MS,
        );
        finishCapture = finish;
        // A slow capture must not block the menu. It can still fill the backing
        // after the deadline, provided this exact page and overlay remain open.
        void requestBrowserSnapshot(
          readyId,
          () => {
            // The queued request may begin after a resize. Record the latest
            // committed native viewport at the moment capture actually starts.
            const viewport = snapshotViewport(lastNativeBounds ?? lastBounds!);
            return nativeBrowser
              .snapshot(readyId)
              .then((src) => ({ src, ...viewport }));
          },
          stillRelevant,
        )
          .then(async (captured) => {
            if (!captured || !stillRelevant()) return;
            const matchesViewport = () => {
              const bounds = currentBounds();
              return (
                !!bounds &&
                sameSnapshotViewport(captured, snapshotViewport(bounds))
              );
            };
            if (!matchesViewport()) return;
            const image = new Image();
            image.src = captured.src;
            await image.decode();
            if (!stillRelevant() || !matchesViewport()) return;
            // Once decoded, allow the short paint handoff to finish instead of
            // letting the capture deadline hide Chromium between these steps.
            if (!settled) window.clearTimeout(deadline);
            // Decode first: committing an <img> and waiting one frame does not
            // guarantee its pixels are ready before Chromium is hidden.
            flushSync(() => setSnapshot(captured));
            await waitForSnapshotPaint();
          })
          .catch(() => {
            // Keep the overlay usable even if capture or decoding fails.
          })
          .finally(finish);
      });
    const currentBounds = () => {
      const bounds =
        !isPaused() && host.current ? browserBounds(host.current) : null;
      return bounds ? clipHoverSidebars(bounds) : null;
    };
    refreshZoomSnapshot.current = (refresh) => {
      if (!refresh) {
        if (zoomRefreshActive) cancelOverlayCapture();
        return;
      }
      cancelOverlayCapture();
      zoomRefreshActive = true;
      // Native-confirmed changes only. Briefly coalesce repeated +/- presses;
      // retain the existing decoded backing until the latest zoom is ready.
      zoomRefreshTimer = window.setTimeout(() => {
        zoomRefreshTimer = null;
        const bounds = currentBounds();
        if (
          !disposed &&
          snapshotZoom.current.menu &&
          bounds &&
          hasVisibleBrowserArea(bounds) &&
          hasOccludingOverlay(bounds)
        )
          void captureForOverlay(true);
      }, ZOOM_SNAPSHOT_DELAY_MS);
    };
    const update = async () => {
      cancelQueued();
      if (disposed) return;
      if (inFlight) {
        pending = true;
        return;
      }
      if (placementInvalidated) {
        lastLayout = "";
        placementInvalidated = false;
      }
      if (lastLayout === "hidden" && isPaused()) return;
      let bounds = currentBounds();
      if (bounds) lastBounds = bounds;
      // Native children are created hidden. A never-shown pane needs no work
      // until it has measurable geometry in the visible workspace.
      if (!lastBounds) {
        lastLayout = "hidden";
        return;
      }
      let show =
        !!bounds &&
        hasVisibleBrowserArea(bounds) &&
        !hasOccludingOverlay(bounds);
      let nextLayout = show ? JSON.stringify([lastBounds, true]) : "hidden";
      if (
        nextLayout === lastLayout &&
        (!bounds || JSON.stringify(lastBounds) === lastGeometry)
      )
        return;
      inFlight = true;
      try {
        if (
          !show &&
          bounds &&
          hasVisibleBrowserArea(bounds) &&
          lastLayout &&
          lastLayout !== "hidden"
        ) {
          // The native child must move behind HTML overlays. Take one still
          // image for that transition, never during resize or workspace hide.
          try {
            await captureForOverlay();
          } catch {
            // A failed snapshot cannot destroy the valid native page. The
            // obscured fallback keeps the overlay accessible until it closes.
          }
          if (disposed) return;
          // Menus may close or the pane may hide while capture/paint is pending.
          bounds = currentBounds();
          if (bounds) lastBounds = bounds;
          show =
            !!bounds &&
            hasVisibleBrowserArea(bounds) &&
            !hasOccludingOverlay(bounds);
          nextLayout = show ? JSON.stringify([lastBounds, true]) : "hidden";
          if (
            nextLayout === lastLayout &&
            (!bounds || JSON.stringify(lastBounds) === lastGeometry)
          ) {
            if (show) setSnapshot(null);
            return;
          }
        }
        const sentBounds = lastBounds;
        const viewportChanged =
          !!lastNativeBounds &&
          !sameSnapshotViewport(
            snapshotViewport(lastNativeBounds),
            snapshotViewport(sentBounds),
          );
        await nativeBrowser.layout(readyId, sentBounds, show);
        lastNativeBounds = sentBounds;
        lastGeometry = JSON.stringify(sentBounds);
        lastLayout = nextLayout;
        if (show && !disposed) setSnapshot(null);
        else if (
          !disposed &&
          bounds &&
          viewportChanged &&
          hasOccludingOverlay(bounds)
        ) {
          // A retained overlay can outlive a pane resize. Resize the hidden
          // native viewport first, then replace its backing at the new size.
          cancelOverlayCapture();
          void captureForOverlay();
        }
      } catch (reason) {
        if (!disposed)
          setNotice(
            `Could not update preview placement: ${errorMessage(reason)}`,
          );
      } finally {
        inFlight = false;
        if (pending && !disposed) {
          pending = false;
          if (pendingImmediate) {
            pendingImmediate = false;
            present();
          } else schedule();
        }
      }
    };
    const schedule = () => {
      if (disposed || (lastLayout === "hidden" && isPaused())) return;
      if (inFlight) {
        pending = true;
        return;
      }
      if (frame !== null || fallback !== null) return;
      const flush = () => void update();
      frame = requestAnimationFrame(flush);
      // WKWebView may defer animation frames while native children cover it.
      // One bounded fallback restores visibility without an idle polling loop.
      fallback = window.setTimeout(flush, LAYOUT_FALLBACK_MS);
    };
    const present = () => {
      if (disposed) return;
      cancelQueued();
      const bounds = currentBounds();
      if (
        !bounds ||
        !hasVisibleBrowserArea(bounds) ||
        !hasOccludingOverlay(bounds)
      )
        cancelOverlayCapture();
      if (inFlight) {
        pending = true;
        pendingImmediate = true;
        return;
      }
      // Explicit tab/visibility changes must not wait for a host animation
      // frame, which WKWebView can throttle behind native child pages.
      void update();
    };
    const resetPlacement = () => {
      // A native reparent may invalidate a layout the retained renderer already
      // sent while another window owned the page. Republish it even unchanged.
      placementInvalidated = true;
      present();
    };
    const resize = new ResizeObserver(schedule);
    const overlayNode = (node: Node) =>
      node instanceof HTMLElement &&
      (node.matches(OVERLAYS) || node.querySelector(OVERLAYS));
    const overlays = new MutationObserver((records) => {
      if (lastLayout === "hidden" && isPaused()) return;
      if (
        records.some((record) =>
          record.type === "attributes"
            ? // A retained floating panel may remove its occlusion marker.
              // Its new selector state alone cannot tell us to restore the page.
              [
                "aria-modal",
                "role",
                "open",
                "hidden",
                "data-native-browser-occluded",
                "data-native-browser-edge",
              ].includes(record.attributeName ?? "") ||
              overlayNode(record.target)
            : [...record.addedNodes, ...record.removedNodes].some(overlayNode),
        )
      )
        present();
    });
    const transitionEnded = (event: Event) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.contains(host.current) || overlayNode(target))
      )
        schedule();
    };
    let stopObserving: (() => void) | undefined;
    const observePresentation = () => {
      if (isPaused()) {
        stopObserving?.();
        stopObserving = undefined;
        return;
      }
      if (stopObserving || !host.current) return;
      // Retain the native page, its agent binding and navigation state while
      // hidden, without asking WebKit to collect whole-app mutation records
      // for every visited tab. Reconnect before publishing the visible layout.
      resize.observe(host.current);
      overlays.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          "aria-modal",
          "role",
          "open",
          "hidden",
          "class",
          "style",
          "data-native-browser-occluded",
          "data-native-browser-edge",
        ],
      });
      document.addEventListener("visibilitychange", present);
      document.addEventListener("transitionend", transitionEnded, true);
      document.addEventListener("animationend", transitionEnded, true);
      window.addEventListener("resize", schedule);
      window.addEventListener("supermono:workspace-layout", present);
      window.addEventListener("supermono:browser-layout-reset", resetPlacement);
      const focusListener = getCurrentWindow().onFocusChanged(schedule);
      stopObserving = () => {
        resize.disconnect();
        overlays.disconnect();
        document.removeEventListener("visibilitychange", present);
        document.removeEventListener("transitionend", transitionEnded, true);
        document.removeEventListener("animationend", transitionEnded, true);
        window.removeEventListener("resize", schedule);
        window.removeEventListener("supermono:workspace-layout", present);
        window.removeEventListener(
          "supermono:browser-layout-reset",
          resetPlacement,
        );
        void focusListener.then((unlisten) => unlisten()).catch(() => {});
      };
    };
    scheduleLayout.current = () => {
      observePresentation();
      present();
    };
    scheduleLayout.current();
    return () => {
      disposed = true;
      cancelQueued();
      cancelOverlayCapture();
      stopObserving?.();
      scheduleLayout.current = () => {};
      refreshZoomSnapshot.current = () => {};
    };
  }, [readyId]);

  useLayoutEffect(() => {
    // Overlay captures are temporary backing images, not workspace previews.
    // Release their decoded pixels/base64 once the pane no longer presents them.
    if (!visible || error || floating) setSnapshot(null);
    scheduleLayout.current();
  }, [visible, error, floating, expanded]);

  useEffect(() => {
    if (
      !pictureInPictureRequest ||
      requestedPictureInPicture.current === pictureInPictureRequest
    )
      return;
    if (!hasUrl) {
      requestedPictureInPicture.current = pictureInPictureRequest;
      const notice = "Open a page before using Picture in Picture.";
      setNotice(notice);
      callbacks.current.onPictureInPictureResult?.(
        pictureInPictureRequest,
        null,
        notice,
      );
      return;
    }
    if (!readyId) return;
    requestedPictureInPicture.current = pictureInPictureRequest;
    void nativeBrowser
      .setFloating(readyId, true)
      .then((label) =>
        callbacks.current.onPictureInPictureResult?.(
          pictureInPictureRequest,
          label,
        ),
      )
      .catch((reason) => {
        const notice = errorMessage(reason);
        setNotice(notice);
        callbacks.current.onPictureInPictureResult?.(
          pictureInPictureRequest,
          null,
          notice,
        );
      });
  }, [pictureInPictureRequest, readyId, hasUrl]);

  useEffect(() => {
    if (!loading || !isTauri()) return;
    const timeout = window.setTimeout(() => {
      setNotice(
        "This page is taking longer to load. Check that the address or local server is available; the preview will continue loading.",
      );
    }, 20_000);
    return () => clearTimeout(timeout);
  }, [loading, url]);

  const navigate = (value: string) => {
    try {
      const target = resolveBrowserAddress(value);
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

  const action = (kind: BrowserAction) => {
    if (!readyId) return;
    setNotice(null);
    void nativeBrowser
      .action(readyId, kind)
      .catch((reason) =>
        setNotice(`Browser action unavailable: ${errorMessage(reason)}`),
      );
  };

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
    if (!readyId || floating) return;
    setToolsMenu(null);
    setFindOpen(true);
    findInput.current?.focus();
    findInput.current?.select();
    focusShellForToolbar(findInput.current);
  };
  useLayoutEffect(() => {
    if (findOpen && visible && !floating) {
      findInput.current?.focus({ preventScroll: true });
      findInput.current?.select();
      // Native toolbar shortcuts already own the window-to-shell handoff.
      if (!pendingToolbar) focusShellForToolbar(findInput.current);
    }
  }, [findOpen]);
  useLayoutEffect(() => {
    scheduleLayout.current();
  }, [findOpen, downloadsOpen]);

  useEffect(() => {
    if (!readyId || !findOpen || !visible || floating) return;
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
  }, [readyId, findOpen, findText, visible, floating]);

  useEffect(() => {
    if (!readyId) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void nativeBrowser
      .listenToolbar((command) => {
        if (disposed || command.id !== readyId) return;
        // A grouped PiP return may dock this page before the owning workspace
        // becomes visible. Preserve its shortcut until that handshake finishes.
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
    if (!pendingToolbar || !readyId || !visible || floating) return;
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
  }, [pendingToolbar, readyId, visible, floating]);

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
  const changeFloating = (next: boolean) => {
    if (!readyId) return;
    void nativeBrowser
      .setFloating(readyId, next)
      .catch((reason) => setNotice(errorMessage(reason)));
  };
  const showFloating = () => {
    if (!readyId) return;
    void nativeBrowser
      .showFloating(readyId)
      .catch((reason) => setNotice(errorMessage(reason)));
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
    if (choice === "external") openExternal();
    if (choice === "pip") changeFloating(!floating);
    if (choice === "find") openFind();
    if (choice === "downloads") setDownloadsOpen((open) => !open);
    if (choice === "devtools" && readyId)
      void nativeBrowser
        .action(readyId, "devtools")
        .catch((reason) =>
          setNotice(`Developer tools unavailable: ${errorMessage(reason)}`),
        );
  };
  const openTools = (button: HTMLButtonElement) => {
    setToolsMenu(toolsMenu ? null : browserMenuPosition(button));
  };
  const utilityItems: ExplorerMenuItem[] = [
    ...(nativeMenus && readyId
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
      disabled: !readyId || floating,
    },
    { kind: "item", id: "downloads", label: "Downloads", disabled: !readyId },
    {
      kind: "item",
      id: "devtools",
      label: "Developer tools",
      disabled: !readyId,
    },
    { kind: "sep" },
    ...(isDetachedWorkspace()
      ? []
      : [
          {
            kind: "item" as const,
            id: "pip",
            label: floating ? "Return to workspace" : "Picture in Picture",
            disabled: !readyId,
          },
        ]),
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
    { kind: "item", id: "external", label: "Open in Brave", disabled: !url },
  ];

  return (
    <section
      className="browser-pane"
      aria-label="Browser preview"
      data-browser-pane={id}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && !event.altKey) {
          if (event.key.toLowerCase() === "f" && readyId && !floating) {
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
        {onAddToChat ? (
          <button
            type="button"
            className={`browser-icon-button${editing ? " browser-edit-done" : ""}`}
            aria-label={editing ? "Exit edit mode" : "Edit page"}
            title={
              editing ? "Exit edit mode (Esc)" : "Select an element to edit"
            }
            aria-pressed={editing}
            disabled={!readyId || !url || floating}
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
        <button
          type="button"
          className="browser-icon-button browser-utility"
          aria-label="Open preview in Brave"
          title="Open in Brave"
          disabled={!url}
          onClick={openExternal}
        >
          <ExternalLink size={14} />
        </button>
        {!isDetachedWorkspace() && (
          <button
            type="button"
            className="browser-icon-button browser-utility"
            aria-label={
              floating ? "Return browser to workspace" : "Picture in Picture"
            }
            title={floating ? "Return to workspace" : "Picture in Picture"}
            disabled={!readyId}
            onClick={() => changeFloating(!floating)}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
            >
              <rect
                x="2"
                y="3"
                width="16"
                height="13"
                rx="2"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <rect
                x="10"
                y="9"
                width="6"
                height="5"
                rx="1"
                fill="currentColor"
              />
            </svg>
          </button>
        )}
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
          <span>Select an element, then add a comment. Press Esc to exit.</span>
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
          native={nativeMenus && !!readyId}
          onError={() =>
            setNotice("Could not open browser actions. Please try again.")
          }
          className="browser-actions-menu"
          header={
            nativeMenus && readyId ? undefined : (
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
      {findOpen && !floating ? (
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
          <button
            type="button"
            aria-label="Dismiss preview notice"
            onClick={() => setNotice(null)}
          >
            <X size={12} />
          </button>
        </div>
      ) : null}
      <div ref={host} className="browser-native-host">
        {snapshot && !error && !floating ? (
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
        ) : floating ? (
          <div
            className="browser-empty browser-floating-placeholder"
            role="status"
          >
            <span className="browser-empty-mark">↗</span>
            <strong>Open in Picture in Picture</strong>
            <p>{error || "This page is open in its floating window."}</p>
            <div className="browser-empty-actions">
              <button type="button" onClick={showFloating}>
                Show window
              </button>
              <button type="button" onClick={() => changeFloating(false)}>
                Return to workspace
              </button>
            </div>
          </div>
        ) : error ? (
          <div className="browser-empty" role="status">
            <span className="browser-empty-mark">↗</span>
            <strong>Preview unavailable</strong>
            <p>{error}</p>
            {browserSearchSuggestion(address || url) ? (
              <p>
                This looks like a search term. Enter a full address such as
                google.com, or search for it below.
              </p>
            ) : null}
            <div className="browser-empty-actions">
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
                  Open in Brave
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

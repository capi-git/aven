import { message } from "@tauri-apps/plugin-dialog";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "../chrome/icons";
import { focusableWithin, isVisible, topModal } from "../chrome/Modal";
import { useImageFile, type ImageFileState } from "../hooks/useImageFile";
import { useImageViewerState } from "../hooks/useImageViewer";
import { useImageZoom } from "../hooks/useImageZoom";
import { copyText } from "../lib/clipboard";
import { errorText, logError } from "../lib/errors";
import { formatFileSize } from "../lib/filePreview";
import { revealPath } from "../lib/fs";
import {
  closeImageViewer,
  dataUrlBytes,
  imageGroupSummary,
  registerImageViewerHost,
  stepImageViewer,
  type ImageViewerItem,
  type ImageViewerState,
} from "../lib/imageViewer";
import { LAYER } from "../lib/layers";
import { displayAppData } from "../lib/paths";
import { REVEAL_LABEL } from "../lib/platform";
import "./ImageViewer.css";

type Props = {
  /** Open a picture's file as an ordinary editor tab, bypassing the viewer. */
  onOpenInTab: (path: string) => void;
};

/**
 * The window's one image popup. It shows whatever `openImageViewer` asks
 * for, over everything, until Escape, the backdrop or Close dismisses it.
 *
 * It sits on the page, beside the app, so it stays above every layer there
 * (the composer's runner, menus) while the app hides underneath it. Its
 * colours are the app's: the app shell's own colours differ from the page
 * root's, so the popup is wrapped in the shell's class on a box-less
 * element. A window without the shell (a detached workspace) keeps the
 * page's colours, as its own surfaces do.
 */
export function ImageViewer({ onOpenInTab }: Props) {
  useEffect(() => registerImageViewerHost(), []);
  const state = useImageViewerState();
  if (!state) return null;
  const inShell = document.querySelector(".personal-shell") !== null;
  return createPortal(
    <div
      className={inShell ? "personal-shell image-viewer-theme" : undefined}
      style={{ display: "contents" }}
    >
      <ImageViewerDialog state={state} onOpenInTab={onOpenInTab} />
    </div>,
    document.body,
  );
}

type Natural = { key: string; w: number; h: number };

function ImageViewerDialog({
  state,
  onOpenInTab,
}: {
  state: ImageViewerState;
  onOpenInTab: (path: string) => void;
}) {
  // The work underneath steps aside while the popup is open (ImageViewer.css).
  // A layout effect, so it is back before focus returns to it on close.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.add("image-viewer-open");
    return () => root.classList.remove("image-viewer-open");
  }, []);
  const rootRef = useRef<HTMLDivElement>(null);
  const pressed = useRef<EventTarget | null>(null);
  const titleId = useId();
  const item = state.items[state.index];
  // Keyed by the picture, not its position: when a folder's listing arrives
  // and the one open picture gains neighbours, it stays as it is.
  const itemKey = `${state.request}:${item.path ?? item.src ?? state.index}`;
  const many = state.items.length > 1;
  const source = useItemSource(item);
  const [natural, setNatural] = useState<Natural | null>(null);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const copiedTimer = useRef<number | null>(null);

  useEffect(() => {
    // Read when the viewer appears, after whatever opened it (a picker, the
    // palette) has closed and handed focus back.
    const root = rootRef.current;
    const opener = document.activeElement;
    if (root && !root.contains(opener)) root.focus({ preventScroll: true });
    return () => {
      const active = document.activeElement;
      if (
        (!active || active === document.body || root?.contains(active)) &&
        opener instanceof HTMLElement &&
        opener !== document.body &&
        isVisible(opener)
      )
        opener.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const root = rootRef.current;
      if (!root || topModal() !== root) return;
      const plain =
        !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeImageViewer();
      } else if (
        plain &&
        (event.key === "ArrowLeft" || event.key === "ArrowRight")
      ) {
        event.preventDefault();
        event.stopPropagation();
        stepImageViewer(event.key === "ArrowLeft" ? -1 : 1);
      } else if (event.key === "Tab") {
        const focusable = focusableWithin([root]);
        if (!focusable.length) return;
        const index = focusable.indexOf(document.activeElement as HTMLElement);
        const next =
          index < 0
            ? event.shiftKey
              ? focusable.length - 1
              : 0
            : (index + (event.shiftKey ? -1 : 1) + focusable.length) %
              focusable.length;
        event.preventDefault();
        focusable[next].focus({ preventScroll: true });
      }
    };
    // Capture, so the editor or chat underneath never sees these keys.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(
    () => () => {
      if (copiedTimer.current != null) window.clearTimeout(copiedTimer.current);
    },
    [],
  );

  const onNatural = useCallback(
    (w: number, h: number) => setNatural({ key: itemKey, w, h }),
    [itemKey],
  );

  /** Close only for a click that started and ended on empty space. */
  const dismiss = (event: MouseEvent<HTMLElement>) => {
    const element = event.currentTarget;
    if (event.target !== element || pressed.current !== element) return;
    const box = element.getBoundingClientRect();
    // A click on a scroll bar lands on its box, outside the client area.
    if (
      event.clientX - box.left > element.clientLeft + element.clientWidth ||
      event.clientY - box.top > element.clientTop + element.clientHeight
    )
      return;
    closeImageViewer();
  };

  const path = item.path;
  const openInTab = () => {
    if (!path) return;
    closeImageViewer();
    onOpenInTab(path);
  };
  const reveal = () => {
    if (!path) return;
    void revealPath(path).catch((error: unknown) => {
      logError("reveal image", error);
      void message(errorText(error), {
        title: "Could not show the file",
        kind: "error",
      }).catch(() => {});
    });
  };
  const copyPath = () => {
    if (!path) return;
    void copyText(path).then(
      () => {
        setCopiedPath(path);
        if (copiedTimer.current != null)
          window.clearTimeout(copiedTimer.current);
        copiedTimer.current = window.setTimeout(
          () => setCopiedPath(null),
          1500,
        );
      },
      (error: unknown) => logError("copy image path", error),
    );
  };

  const size =
    source.status === "ready" || source.status === "unsupported"
      ? source.size
      : undefined;
  // An SVG without its own size reports none; say nothing rather than 0 × 0.
  const dimensions =
    natural?.key === itemKey && natural.w > 0 && natural.h > 0 ? natural : null;
  const meta = [
    dimensions ? `${dimensions.w} × ${dimensions.h}` : "",
    size !== undefined ? formatFileSize(size) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const summary = imageGroupSummary(state.items, state.index);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="image-viewer"
      style={{ zIndex: LAYER.dialog }}
      onMouseDownCapture={(event) => {
        pressed.current = event.target;
      }}
    >
      <div
        className="image-viewer-backdrop"
        aria-hidden="true"
        onClick={dismiss}
      />
      <header className="image-viewer-bar" onClick={dismiss}>
        <div className="image-viewer-title">
          {/* A captioned picture, such as an agent's Before shot, goes by its
              caption; its saved file name stays in the tooltip. */}
          <h2 id={titleId} title={displayAppData(path) ?? item.name}>
            {item.label || item.name}
          </h2>
          {meta ? <span className="image-viewer-meta">{meta}</span> : null}
        </div>
        <div
          className="image-viewer-actions"
          role="toolbar"
          aria-label="Image actions"
        >
          {path ? (
            <>
              <button
                type="button"
                className="image-viewer-action"
                onClick={openInTab}
              >
                Open in tab
              </button>
              <button
                type="button"
                className="image-viewer-action"
                onClick={reveal}
              >
                {REVEAL_LABEL}
              </button>
              <button
                type="button"
                className="image-viewer-action"
                title={path}
                onClick={copyPath}
              >
                {copiedPath === path ? "Copied" : "Copy path"}
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="image-viewer-action image-viewer-close"
            aria-label="Close"
            title="Close (Esc)"
            onClick={closeImageViewer}
          >
            <X className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </header>
      <div className="image-viewer-stage" onClick={dismiss}>
        <ViewerPicture
          key={itemKey}
          item={item}
          source={source}
          onNatural={onNatural}
          onDismiss={dismiss}
        />
        {many ? (
          <>
            <button
              type="button"
              className="image-viewer-nav"
              data-side="previous"
              aria-label="Previous image"
              title="Previous (←)"
              onClick={() => stepImageViewer(-1)}
            >
              <ChevronLeft className="size-4" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              className="image-viewer-nav"
              data-side="next"
              aria-label="Next image"
              title="Next (→)"
              onClick={() => stepImageViewer(1)}
            >
              <ChevronRight className="size-4" strokeWidth={1.75} />
            </button>
          </>
        ) : null}
      </div>
      <p className="image-viewer-count" aria-live="polite" onClick={dismiss}>
        {summary}
      </p>
    </div>
  );
}

/** One picture, fitted to the stage; a click shows it at its own size. */
function ViewerPicture({
  item,
  source,
  onNatural,
  onDismiss,
}: {
  item: ImageViewerItem;
  source: ViewerSource;
  onNatural: (w: number, h: number) => void;
  onDismiss: (event: MouseEvent<HTMLElement>) => void;
}) {
  const { natural, zoom, scrollerRef, imageProps } = useImageZoom();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (natural) onNatural(natural.w, natural.h);
  }, [natural, onNatural]);

  let status: string | null = null;
  let detail: string | null = null;
  if (failed) status = `Couldn’t show ${item.name}`;
  else if (source.status === "loading") status = `Opening ${item.name}…`;
  else if (source.status === "error") {
    status = `Couldn’t open ${item.name}`;
    detail = source.message;
  } else if (source.status === "unsupported") {
    status = `${item.name} isn’t a readable image`;
    detail = formatFileSize(source.size);
  }

  if (status || source.status !== "ready") {
    return (
      <div className="image-viewer-status" role="status">
        <span>{status}</span>
        {detail ? <small>{detail}</small> : null}
      </div>
    );
  }

  return (
    <div
      ref={scrollerRef}
      className="image-viewer-scroller"
      data-zoom={zoom === "fit" ? "fit" : "actual"}
      onClick={onDismiss}
    >
      <img
        {...imageProps}
        src={source.url}
        alt={item.label || item.name}
        draggable={false}
        onError={() => setFailed(true)}
        className={`image-viewer-image ${imageProps.className}`}
      />
    </div>
  );
}

type ViewerSource =
  | Exclude<ImageFileState, { status: "ready" }>
  | { status: "ready"; url: string; size?: number };

/** Where a picture's pixels come from: its file, or a URL it already has. */
function useItemSource(item: ImageViewerItem): ViewerSource {
  const file = useImageFile(item.src ? undefined : item.path);
  if (!item.src) return file;
  return {
    status: "ready",
    url: item.src,
    size: item.size ?? dataUrlBytes(item.src),
  };
}

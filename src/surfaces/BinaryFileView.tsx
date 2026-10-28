import { useCallback, useEffect, useState } from "react";
import { useImageFile } from "../hooks/useImageFile";
import { useImageZoom } from "../hooks/useImageZoom";
import { AlertCircle, Folder, Minus, Plus, RotateCcw } from "../chrome/icons";
import { FileTypeIcon } from "../chrome/FileTypeIcon";
import { copyText } from "../lib/clipboard";
import { formatFileSize } from "../lib/filePreview";
import { watchFile } from "../lib/fileWatch";
import { basename, revealPath } from "../lib/fs";
import { displayAppData, displayPath } from "../lib/paths";

type Props = { path: string; cwd: string };

/**
 * Read-only surface for files the editor can't open. Images render; bytes that
 * turn out not to be an image get a card pointing at the file on disk.
 */
export function BinaryFileView({ path, cwd }: Props) {
  const [reloadKey, setReloadKey] = useState(0);
  const state = useImageFile(path, reloadKey);

  const reload = useCallback(() => setReloadKey((value) => value + 1), []);

  useEffect(() => {
    let timer = 0;
    const stop = watchFile(path, () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(reload, 50);
    });
    return () => {
      window.clearTimeout(timer);
      stop();
    };
  }, [path, reload]);

  if (state.status === "loading") {
    return (
      <div className="grid h-full place-items-center text-ui-label text-content/45">
        Opening {basename(path)}…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <FileCard
        path={path}
        cwd={cwd}
        title={`Couldn’t open ${basename(path)}`}
        detail={state.message}
        icon={<AlertCircle className="mx-auto mb-3 size-5 text-red-400" />}
        onRetry={reload}
      />
    );
  }

  if (state.status === "unsupported") {
    return (
      <FileCard
        path={path}
        cwd={cwd}
        title={basename(path)}
        detail={`${formatFileSize(state.size)} · not a readable image`}
        icon={
          <div className="mx-auto mb-3 flex justify-center">
            <FileTypeIcon name={basename(path)} isDir={false} size={28} />
          </div>
        }
      />
    );
  }

  return <ImageView url={state.url} size={state.size} mime={state.mime} />;
}

function ImageView({
  url,
  size,
  mime,
}: {
  url: string;
  size: number;
  mime: string;
}) {
  const { natural, zoom, setZoom, zoomIn, zoomOut, scrollerRef, imageProps } =
    useImageZoom();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollerRef}
        className="flex min-h-0 flex-1 overflow-auto overscroll-contain p-4"
        style={{
          // A checkerboard so transparent PNGs read as transparent rather than
          // as whatever the theme background happens to be.
          backgroundImage:
            "linear-gradient(45deg, rgba(128,128,128,0.10) 25%, transparent 25%, transparent 75%, rgba(128,128,128,0.10) 75%), linear-gradient(45deg, rgba(128,128,128,0.10) 25%, transparent 25%, transparent 75%, rgba(128,128,128,0.10) 75%)",
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0, 8px 8px",
        }}
      >
        <img src={url} alt="" draggable={false} {...imageProps} />
      </div>
      <footer className="flex h-8 shrink-0 items-center gap-3 border-t border-content/10 px-3 text-ui-caption text-content/50">
        <span className="tabular-nums">
          {natural ? `${natural.w} × ${natural.h}` : "—"}
        </span>
        <span className="tabular-nums">{formatFileSize(size)}</span>
        <span className="uppercase">{mime.replace(/^image\//, "")}</span>
        <span className="flex-1" />
        <ZoomButton label="Zoom out" onClick={zoomOut}>
          <Minus className="size-3" strokeWidth={1.75} />
        </ZoomButton>
        <button
          type="button"
          title="Fit to window"
          onClick={() => setZoom("fit")}
          className="w-11 rounded text-center tabular-nums hover:text-content"
        >
          {zoom === "fit" ? "Fit" : `${Math.round(zoom * 100)}%`}
        </button>
        <ZoomButton label="Zoom in" onClick={zoomIn}>
          <Plus className="size-3" strokeWidth={1.75} />
        </ZoomButton>
      </footer>
    </div>
  );
}

function ZoomButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="grid size-5 place-items-center rounded hover:bg-content/10 hover:text-content"
    >
      {children}
    </button>
  );
}

function FileCard({
  path,
  cwd,
  title,
  detail,
  icon,
  onRetry,
}: {
  path: string;
  cwd: string;
  title: string;
  detail: string;
  icon: React.ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="max-w-md text-center">
        {icon}
        <p className="text-ui-body text-content">{title}</p>
        <p className="mt-1 text-ui-label leading-5 text-content/50">{detail}</p>
        <p className="mt-1 truncate font-mono text-ui-caption text-content/35">
          {displayAppData(displayPath(path, cwd))}
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          {onRetry ? (
            <CardButton onClick={onRetry}>
              <RotateCcw className="size-3" strokeWidth={1.75} />
              Retry
            </CardButton>
          ) : null}
          <CardButton onClick={() => void revealPath(path).catch(() => {})}>
            <Folder className="size-3" strokeWidth={1.75} />
            Reveal
          </CardButton>
          <CardButton onClick={() => void copyText(path).catch(() => {})}>
            Copy path
          </CardButton>
        </div>
      </div>
    </div>
  );
}

function CardButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-7 items-center gap-1.5 rounded-md bg-(--aven-control-bg) px-2.5 text-ui-label text-content hover:bg-(--aven-control-hover) active:bg-(--aven-control-pressed)"
    >
      {children}
    </button>
  );
}

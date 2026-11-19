import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useImageViewerAvailable } from "../hooks/useImageViewer";
import { readDisplayImage } from "../lib/displayImage";
import { sniffImageMime } from "../lib/filePreview";
import { basename, readBinaryFile } from "../lib/fs";
import { openImageGroupAt } from "../lib/imageViewer";
import "./LocalMarkdownImage.css";

/**
 * Reads visible image files as a smaller display copy (the original when it
 * is small or a copy fails). A click shows the full picture in the image
 * viewer, with the other pictures in the same reply; without a viewer it
 * opens the file.
 */
export function LocalMarkdownImage({
  path,
  alt,
  onOpenFile,
}: {
  path: string;
  alt?: string;
  onOpenFile?: (path: string) => void;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Set when a display copy would not draw; the original is read instead.
  const [original, setOriginal] = useState(false);
  const [state, setState] = useState<{ src?: string; error?: string }>({});
  const viewer = useImageViewerAvailable();
  const open =
    viewer || onOpenFile
      ? (event: MouseEvent<HTMLElement>) => {
          if (viewer && openImageGroupAt(event.currentTarget)) return;
          onOpenFile?.(path);
        }
      : undefined;

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px" },
    );
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let created: string | undefined;
    setState({});
    void (original ? readBinaryFile(path) : readDisplayImage(path))
      .then((bytes) => {
        if (cancelled) return;
        const mime = sniffImageMime(bytes);
        if (!mime) throw new Error("This file is not a supported image.");
        created = URL.createObjectURL(new Blob([bytes], { type: mime }));
        setState({ src: created });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setState({
            error: error instanceof Error ? error.message : String(error),
          });
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [path, visible, attempt, original]);

  const label = alt || basename(path);
  const image = state.src ? (
    <img
      src={state.src}
      alt={label}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => {
        if (!original) setOriginal(true);
        else setState({ error: "The image could not be displayed." });
      }}
    />
  ) : null;
  return (
    <span ref={host} className="markdown-local-image" data-local-image={path}>
      {image ? (
        open ? (
          <button
            type="button"
            className="markdown-local-image-open"
            title={`Open ${label}`}
            onClick={open}
          >
            {image}
          </button>
        ) : (
          image
        )
      ) : (
        <span className="markdown-local-image-status" role="status">
          <span>
            {state.error ? `Couldn’t load ${label}` : `Loading ${label}…`}
          </span>
          {state.error ? (
            <>
              <small>{state.error}</small>
              <span className="markdown-local-image-actions">
                <button
                  type="button"
                  onClick={() => setAttempt((value) => value + 1)}
                >
                  Retry image
                </button>
                {onOpenFile ? (
                  <button type="button" onClick={() => onOpenFile(path)}>
                    Open file
                  </button>
                ) : null}
              </span>
            </>
          ) : null}
        </span>
      )}
    </span>
  );
}

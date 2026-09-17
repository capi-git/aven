import { useEffect, useRef, useState } from "react";
import { X } from "./icons";
import { attachmentPreviewSrc } from "../lib/attachments";
import { sniffImageMime } from "../lib/filePreview";
import { readBinaryFile } from "../lib/fs";
import { openInAppFile } from "../lib/inAppLinks";
import type { Attachment } from "../lib/session";
import { FileTypeIcon } from "./FileTypeIcon";

type Props = {
  attachment: Attachment;
  onRemove?: () => void;
};

export function AttachmentChip({ attachment, onRemove }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const directPreview = attachmentPreviewSrc(attachment);
  const [visible, setVisible] = useState(false);
  const [savedPreview, setSavedPreview] = useState<{
    path: string;
    src: string;
  }>();
  const path = attachment.path;
  const imagePath =
    attachment.kind === "image" && !directPreview ? path : undefined;

  useEffect(() => {
    if (!imagePath || visible) return;
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
  }, [imagePath, visible]);

  useEffect(() => {
    if (!imagePath || !visible) return;
    let cancelled = false;
    let created: string | undefined;
    void readBinaryFile(imagePath)
      .then((bytes) => {
        if (cancelled) return;
        const mime = sniffImageMime(bytes);
        if (!mime) return;
        created = URL.createObjectURL(new Blob([bytes], { type: mime }));
        setSavedPreview({ path: imagePath, src: created });
      })
      .catch(() => {
        // Keep the named, openable file chip when a saved file cannot be previewed.
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [imagePath, visible]);

  const preview =
    directPreview ??
    (savedPreview?.path === imagePath ? savedPreview?.src : undefined);
  const image = attachment.kind === "image" && preview;

  const content = image ? (
    <img
      src={preview}
      alt=""
      className="size-9 shrink-0 rounded-lg object-cover"
    />
  ) : (
    <>
      <span className="grid size-5 shrink-0 place-items-center">
        <FileTypeIcon name={attachment.name} isDir={false} size={16} />
      </span>
      <span className="chat-reference min-w-0 max-w-[140px] truncate text-[11px] leading-4">
        {attachment.name}
      </span>
    </>
  );

  return (
    <div
      ref={host}
      className={`group relative flex min-w-0 items-center gap-1.5 rounded-md ${
        image ? "" : "bg-content/10 py-0.5 pl-1 pr-1"
      }`}
      title={attachment.path ?? attachment.name}
    >
      {path ? (
        <button
          type="button"
          className="flex min-w-0 items-center gap-1.5 rounded-md focus-visible:outline-2 focus-visible:outline-accent"
          aria-label={`Open ${attachment.name}`}
          onClick={(event) => {
            event.stopPropagation();
            openInAppFile(path);
          }}
        >
          {content}
        </button>
      ) : (
        content
      )}
      {onRemove ? (
        <button
          type="button"
          title="Remove"
          aria-label={`Remove ${attachment.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className={`grid shrink-0 place-items-center rounded-full text-content/70 hover:bg-content/15 hover:text-content ${
            image
              ? "absolute -right-1 -top-1 size-5 bg-content/20 opacity-100 shadow-sm backdrop-blur-sm"
              : "size-4 text-content/40"
          }`}
        >
          <X className={image ? "size-3" : "size-3"} strokeWidth={2} />
        </button>
      ) : null}
    </div>
  );
}

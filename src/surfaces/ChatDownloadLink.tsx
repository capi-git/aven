import "./ChatDownloadLink.css";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { ExplorerMenu, type ExplorerMenuItem } from "../chrome/ExplorerMenu";
import { FileTypeIcon } from "../chrome/FileTypeIcon";
import { Popover } from "../chrome/Popover";
import {
  chatDownload,
  downloadAgentFile,
  keepAgentFilesOutOfGit,
  openChatDownload,
  revealChatDownload,
  subscribeChatDownloads,
  type ChatDownload,
} from "../lib/chatDownloads";
import { basename } from "../lib/fs";
import { fileLinkHref } from "../lib/inAppLinks";
import { IS_MAC } from "../lib/platform";

/** The browser's words for it: Safari and Chrome both say this on a Mac. */
export const SHOW_DOWNLOAD_LABEL = IS_MAC ? "Show in Finder" : "Show in folder";

/** The download popup's line under the file's name. */
export function chatDownloadStatus(download: ChatDownload): string {
  if (download.state === "saving") return "Downloading…";
  if (download.state === "failed") return download.error;
  return "Downloaded";
}

/**
 * The link's text with the arrow held to its first word, so a wrapped line
 * never leaves the arrow on its own.
 */
function withGlyph(children: ReactNode, glyph: ReactNode): ReactNode {
  const text =
    typeof children === "string"
      ? children
      : Array.isArray(children) &&
          children.length === 1 &&
          typeof children[0] === "string"
        ? children[0]
        : undefined;
  if (text === undefined)
    return (
      <>
        {glyph}
        {children}
      </>
    );
  const [, first = "", rest = ""] = text.match(/^(\S*)([\s\S]*)$/) ?? [];
  return (
    <>
      <span className="chat-download-lead">
        {glyph}
        {first}
      </span>
      {rest}
    </>
  );
}

/**
 * A file an agent made for the user, as a blue link in its reply. A click
 * saves a copy to Downloads, as a browser download link does, and a small
 * popup under the link says so, with Open and Show in Finder. The link keeps
 * a check once it has been downloaded.
 */
export function ChatDownloadLink({
  path,
  children,
}: {
  /** The agent's file, under `.aven/files`. */
  path: string;
  children: ReactNode;
}) {
  const download = useSyncExternalStore(subscribeChatDownloads, () =>
    chatDownload(path),
  );
  const link = useRef<HTMLAnchorElement | null>(null);
  const [popup, setPopup] = useState(false);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const name = basename(path);
  const saved = download?.state === "saved" ? download : undefined;
  // The agent made its folder with this file: Git should leave it alone.
  useEffect(() => keepAgentFilesOutOfGit(path), [path]);

  const start = () => {
    setPopup(true);
    void downloadAgentFile(path);
  };
  const close = (focusLink: boolean) => {
    setPopup(false);
    if (focusLink) link.current?.focus();
  };

  const items: ExplorerMenuItem[] = [
    { kind: "item", id: "download", label: "Download" },
    ...(saved?.openable
      ? [{ kind: "item" as const, id: "open", label: "Open" }]
      : []),
    ...(saved
      ? [{ kind: "item" as const, id: "reveal", label: SHOW_DOWNLOAD_LABEL }]
      : []),
  ];

  const glyph = (
    <svg className="chat-download-glyph" viewBox="0 0 16 16" aria-hidden="true">
      {saved ? (
        <path d="M3.25 8.5 6.5 11.75 12.75 4.75" />
      ) : (
        <path d="M8 2.5v8M4.75 7.5 8 10.75 11.25 7.5M3 13.5h10" />
      )}
    </svg>
  );

  return (
    <>
      <a
        ref={link}
        // The file's own address, so the system's Open Link can't land on a
        // web page; every click is handled here.
        href={fileLinkHref(path)}
        className="chat-reference chat-download-link"
        data-state={download?.state}
        dir="auto"
        title={`Save ${name} to Downloads`}
        aria-busy={download?.state === "saving" || undefined}
        onClick={(event: MouseEvent<HTMLAnchorElement>) => {
          event.preventDefault();
          start();
        }}
        onAuxClick={(event) => {
          if (event.button === 1) event.preventDefault();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenuAt({ x: event.clientX, y: event.clientY });
        }}
        onKeyDown={(event: KeyboardEvent<HTMLAnchorElement>) => {
          if (
            event.key !== "ContextMenu" &&
            !(event.shiftKey && event.key === "F10")
          )
            return;
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          setMenuAt({ x: rect.left, y: rect.bottom });
        }}
      >
        {withGlyph(children, glyph)}
      </a>
      {popup && download ? (
        <Popover
          anchor={link}
          side="bottom"
          align="start"
          width={280}
          role="dialog"
          aria-label={`Download of ${name}`}
          onDismiss={(reason) => close(reason === "escape")}
        >
          <div className="chat-download-popup" data-state={download.state}>
            <div className="chat-download-file">
              <FileTypeIcon
                name={saved?.name ?? name}
                isDir={false}
                size={20}
              />
              <div className="chat-download-text">
                <span
                  className="chat-download-name"
                  title={saved?.path ?? name}
                >
                  {saved?.name ?? name}
                </span>
                <span
                  className="chat-download-status"
                  role={download.state === "failed" ? "alert" : "status"}
                >
                  {chatDownloadStatus(download)}
                </span>
              </div>
            </div>
            {saved ? (
              <div className="chat-download-actions">
                {saved.openable ? (
                  <button
                    type="button"
                    onClick={() => {
                      // Opening hands the window to another app, which
                      // closes this popup; a refusal stays to be read.
                      void openChatDownload(path).then((opened) => {
                        if (opened) close(false);
                      });
                    }}
                  >
                    Open
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    close(false);
                    revealChatDownload(path);
                  }}
                >
                  {SHOW_DOWNLOAD_LABEL}
                </button>
              </div>
            ) : null}
          </div>
        </Popover>
      ) : null}
      {menuAt ? (
        <ExplorerMenu
          x={menuAt.x}
          y={menuAt.y}
          items={items}
          ariaLabel={`Actions for ${name}`}
          onClose={() => setMenuAt(null)}
          onPick={(id) => {
            setMenuAt(null);
            if (id === "download") start();
            else if (id === "open")
              void openChatDownload(path).then((opened) => {
                if (!opened) setPopup(true);
              });
            else if (id === "reveal") revealChatDownload(path);
          }}
        />
      ) : null}
    </>
  );
}

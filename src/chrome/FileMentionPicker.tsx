import "./Menu.css";
import { MessageSquare, StickyNote } from "./icons";
import {
  memo,
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { RankedFile } from "../lib/fileIndex";
import { isChatMentionPath } from "../lib/chatMentions";
import { isNoteMentionPath } from "../lib/notes";
import { FileTypeIcon } from "./FileTypeIcon";
import { MatchText } from "./MatchText";

type Props = {
  files: RankedFile[];
  query: string;
  active: number;
  loading?: boolean;
  includeNotes?: boolean;
  includeChats?: boolean;
  onActive: (index: number) => void;
  onPick: (file: RankedFile) => void;
};

/** Memoized: the composer re-renders for every keystroke and draft change. */
export const FileMentionPicker = memo(function FileMentionPicker({
  files,
  query,
  active,
  loading,
  includeNotes = false,
  includeChats = false,
  onActive,
  onPick,
}: Props) {
  const activeRef = useRef<HTMLButtonElement>(null);
  const pointer = useRef({ x: Number.NaN, y: Number.NaN, allow: false });
  const fromPointer = useRef(false);

  useEffect(() => {
    pointer.current.allow = false;
  }, [files]);

  useEffect(() => {
    if (fromPointer.current) {
      fromPointer.current = false;
      return;
    }
    pointer.current.allow = false;
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onListMouseMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.clientX === pointer.current.x && e.clientY === pointer.current.y) {
      return;
    }
    pointer.current = { x: e.clientX, y: e.clientY, allow: true };
  };

  const onRowEnter = (index: number) => {
    if (!pointer.current.allow) return;
    fromPointer.current = true;
    onActive(index);
  };

  const kinds =
    includeNotes && includeChats
      ? "files, chats or notes"
      : includeChats
        ? "files or chats"
        : includeNotes
          ? "files or notes"
          : "files or folders";

  return (
    <div data-mention-picker className="aven-glass-overlay overflow-hidden">
      {files.length === 0 ? (
        <p className="aven-menu aven-menu-note">
          {loading
            ? "Indexing files…"
            : query.trim()
              ? `No matching ${kinds}`
              : `No ${kinds} found`}
        </p>
      ) : (
        <div
          role="listbox"
          aria-label={
            includeNotes || includeChats
              ? "Files, chats and notes"
              : "Files and folders"
          }
          onMouseMove={onListMouseMove}
          className="aven-menu max-h-[min(240px,40vh)] overflow-y-auto overscroll-none"
        >
          {files.map((file, index) => {
            const highlighted = index === active;
            const note = isNoteMentionPath(file.path);
            const chat = isChatMentionPath(file.path);
            const named = note || chat;
            const slash = file.relative.lastIndexOf("/");
            const dir = named
              ? ""
              : slash === -1
                ? ""
                : file.relative.slice(0, slash);
            const nameOffset = slash === -1 ? 0 : slash + 1;
            const namePositions = named
              ? file.positions
              : file.positions
                  .filter((pos) => pos >= nameOffset)
                  .map((pos) => pos - nameOffset);
            return (
              <button
                key={file.path}
                ref={highlighted ? activeRef : undefined}
                type="button"
                role="option"
                aria-selected={highlighted}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => onRowEnter(index)}
                onClick={() => onPick(file)}
                data-active={highlighted}
                className="aven-menu-item"
              >
                <span aria-hidden="true" className="aven-menu-icon">
                  {note ? (
                    <StickyNote className="size-3.5" strokeWidth={1.75} />
                  ) : chat ? (
                    <MessageSquare className="size-3.5" strokeWidth={1.75} />
                  ) : (
                    <FileTypeIcon
                      name={file.name}
                      isDir={Boolean(file.isDir)}
                      size={14}
                    />
                  )}
                </span>
                <span
                  className={`aven-menu-label ${
                    highlighted ? "text-mention" : ""
                  }`}
                >
                  <MatchText
                    text={file.name}
                    positions={namePositions}
                    active={Boolean(query.trim())}
                  />
                  {file.isDir ? "/" : null}
                </span>
                {named ? (
                  <span className="aven-menu-shortcut font-mono">
                    {note ? "Note" : "Chat"}
                  </span>
                ) : dir ? (
                  <span className="aven-menu-detail max-w-[45%] font-mono">
                    <MatchText
                      text={dir}
                      positions={file.positions.filter((pos) => pos < slash)}
                      active={Boolean(query.trim())}
                    />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

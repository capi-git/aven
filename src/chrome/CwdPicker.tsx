import { ChevronDown, ChevronRight } from "./icons";
import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { basename, pickFolder } from "../lib/fs";
import { isProjectlessCwd } from "../lib/projectlessWorkspace";
import { displayAppData, prettyCwd, prettyParent } from "../lib/paths";
import {
  looksLikeProject,
  sameProjectPath,
  type RecentProject,
} from "../lib/recents";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { LAYER } from "../lib/layers";
import "./Menu.css";
import { Popover } from "./Popover";
import { ProjectLogoIcon } from "./ProjectLogoIcon";
import { MOD } from "../lib/platform";

type Props = {
  cwd: string;
  recents: RecentProject[];
  projectLogoPath?: string | null;
  enabled?: boolean;
  placement?: "above" | "below";
  className?: string;
  buttonClassName?: string;
  /** Chevron on the trailing edge; flips when the menu is open. */
  chevron?: boolean;
  children?: ReactNode;
  onCwdChange: (path: string) => void;
  onNewTerminal?: () => void;
  onClose?: () => void;
};

const MENU_WIDTH = 288;
const MENU_MAX_HEIGHT = 360;
const SUBMENU_MAX_HEIGHT = 320;
const PREVIEW = 5;
const SUBMENU_GAP = 4;
const HOVER_CLOSE_MS = 100;
/* Both menus sit outside the trigger, so neither counts as a click-away. */
const SELF = "[data-cwd-picker],[data-cwd-submenu]";

type Row =
  | { kind: "recent"; path: string }
  | { kind: "more" }
  | { kind: "choose-folder" }
  | { kind: "new-terminal" };

export function CwdPicker({
  cwd,
  recents,
  projectLogoPath,
  enabled = true,
  placement = "above",
  className,
  buttonClassName,
  chevron = false,
  children,
  onCwdChange,
  onNewTerminal,
  onClose,
}: Props) {
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [folderError, setFolderError] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const closeMoreTimer = useRef<number | null>(null);
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const projectless = isProjectlessCwd(cwd);
  const inProject = !projectless && looksLikeProject(cwd);
  const label = projectless ? "No project" : displayAppData(prettyCwd(cwd));
  const otherRecents = useMemo(
    () =>
      recents.filter((item) => !inProject || !sameProjectPath(item.path, cwd)),
    [cwd, inProject, recents],
  );
  const previewRecents = otherRecents.slice(0, PREVIEW);
  const overflowRecents = otherRecents.slice(PREVIEW);
  const hasMore = overflowRecents.length > 0;

  const rows = useMemo((): Row[] => {
    const out: Row[] = previewRecents.map((item) => ({
      kind: "recent",
      path: item.path,
    }));
    if (hasMore) out.push({ kind: "more" });
    if (projectless) out.push({ kind: "choose-folder" });
    if (onNewTerminal) out.push({ kind: "new-terminal" });
    return out;
  }, [hasMore, onNewTerminal, previewRecents, projectless]);

  const dismiss = (restore = false) => {
    setOpen(false);
    setMoreOpen(false);
    setActive(0);
    if (closeMoreTimer.current != null) {
      window.clearTimeout(closeMoreTimer.current);
      closeMoreTimer.current = null;
    }
    if (restore) onCloseRef.current?.();
  };

  const openMore = () => {
    if (closeMoreTimer.current != null) {
      window.clearTimeout(closeMoreTimer.current);
      closeMoreTimer.current = null;
    }
    setMoreOpen(true);
  };

  const scheduleCloseMore = () => {
    if (closeMoreTimer.current != null)
      window.clearTimeout(closeMoreTimer.current);
    closeMoreTimer.current = window.setTimeout(() => {
      closeMoreTimer.current = null;
      setMoreOpen(false);
    }, HOVER_CLOSE_MS);
  };

  const pick = (row: Row) => {
    if (row.kind === "more") return;
    dismiss(true);
    if (row.kind === "choose-folder") {
      setFolderError(false);
      void pickFolder()
        .then((path) => {
          if (path) onCwdChange(path);
        })
        .catch(() => {
          setFolderError(true);
          setOpen(true);
        });
      return;
    }
    if (row.kind === "new-terminal") {
      onNewTerminal?.();
      return;
    }
    onCwdChange(row.path);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (!enabled) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const row = rows[active + 1];
      if (row?.kind === "more") openMore();
      setActive((i) => Math.min(rows.length - 1, i + 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    }
    if (e.key === "ArrowRight") {
      const row = rows[active];
      if (row?.kind === "more") {
        e.preventDefault();
        openMore();
      }
    }
    if (e.key === "ArrowLeft") {
      if (moreOpen) {
        e.preventDefault();
        setMoreOpen(false);
      }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[active];
      if (row?.kind === "more") {
        openMore();
        return;
      }
      if (row) pick(row);
    }
  };

  const newTerminalIndex = onNewTerminal
    ? previewRecents.length + (hasMore ? 1 : 0) + Number(projectless)
    : -1;
  const moreIndex = hasMore ? previewRecents.length : -1;

  return (
    <div
      ref={root}
      className={`relative flex h-full min-w-0${className ? ` ${className}` : ""}`}
    >
      <button
        type="button"
        title={projectless ? "No project · Choose a folder" : cwd}
        aria-label={
          projectless ? "No project · Choose a folder" : `Project ${label}`
        }
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={!enabled}
        data-tauri-drag-region="false"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (!enabled) return;
          if (open) {
            dismiss(true);
            return;
          }
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        className={
          buttonClassName
            ? `${buttonClassName} ${
                open ? "bg-content/10 text-content" : "hover:bg-content/5"
              } disabled:opacity-40`
            : `flex min-w-0 items-center gap-1.5 ${
                open ? "text-content" : "text-content/50 hover:text-content"
              } disabled:opacity-40`
        }
      >
        {(projectless ? undefined : children) ?? (
          <>
            <ProjectLogoIcon
              path={projectless ? null : projectLogoPath}
              fallbackStrokeWidth={1.5}
            />
            <span className="truncate font-mono text-ui-label">{label}</span>
          </>
        )}
        {chevron ? (
          <ChevronDown
            className={`size-3 shrink-0 text-content/50 ${
              open ? "rotate-180" : ""
            }`}
            strokeWidth={1.75}
          />
        ) : null}
      </button>
      {open ? (
        <Popover
          anchor={root}
          side={placement === "below" ? "bottom" : "top"}
          width={MENU_WIDTH}
          maxHeight={MENU_MAX_HEIGHT}
          ignore={SELF}
          onDismiss={(reason) => dismiss(reason === "escape")}
          // Take focus so arrow keys and Enter drive the menu; left in the
          // composer, Enter would send the message instead.
          autoFocus
          tabIndex={-1}
          onKeyDown={onKeyDown}
          role="menu"
          aria-label="Project picker"
          data-cwd-picker
          className="flex flex-col overflow-hidden"
        >
          <div
            ref={lockOverscroll}
            className="aven-menu min-h-0 flex-1 overflow-y-auto overscroll-none"
          >
            {folderError ? (
              <p role="alert" className="aven-menu-note">
                Could not open the folder picker. Try again.
              </p>
            ) : null}
            {inProject ? (
              <>
                <p className="aven-menu-section">Current project</p>
                <div className="aven-menu-note">
                  <p className="truncate text-content">{basename(cwd)}</p>
                  <p className="aven-menu-description truncate font-mono">
                    {displayAppData(prettyParent(cwd))}
                  </p>
                </div>
              </>
            ) : null}
            {previewRecents.length > 0 ? (
              <>
                <p className="aven-menu-section">Recent projects</p>
                {previewRecents.map((item, index) => (
                  <button
                    key={item.path}
                    type="button"
                    role="menuitem"
                    title={displayAppData(item.path)}
                    onMouseDown={(e) => e.stopPropagation()}
                    onMouseEnter={() => {
                      setMoreOpen(false);
                      setActive(index);
                    }}
                    onClick={() => pick({ kind: "recent", path: item.path })}
                    data-active={active === index}
                    className="aven-menu-item"
                  >
                    <span className="aven-menu-label">
                      {basename(item.path)}
                    </span>
                    <span className="aven-menu-detail max-w-28 font-mono">
                      {displayAppData(prettyParent(item.path))}
                    </span>
                  </button>
                ))}
              </>
            ) : null}
            {hasMore ? (
              <button
                ref={moreRef}
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                onMouseDown={(e) => e.stopPropagation()}
                onMouseEnter={() => {
                  setActive(moreIndex);
                  openMore();
                }}
                onMouseLeave={scheduleCloseMore}
                onFocus={() => {
                  setActive(moreIndex);
                  openMore();
                }}
                data-active={active === moreIndex}
                className="aven-menu-item"
              >
                <span className="aven-menu-label">More Projects</span>
                <ChevronRight
                  aria-hidden="true"
                  className="aven-menu-chevron"
                  strokeWidth={1.75}
                />
              </button>
            ) : null}
          </div>
          {projectless || onNewTerminal ? (
            <div className="aven-menu shrink-0 border-t border-(color:--aven-menu-line)">
              {projectless ? (
                <button
                  type="button"
                  role="menuitem"
                  onMouseDown={(e) => e.stopPropagation()}
                  onMouseEnter={() => {
                    setMoreOpen(false);
                    setActive(previewRecents.length + (hasMore ? 1 : 0));
                  }}
                  onClick={() => pick({ kind: "choose-folder" })}
                  data-active={
                    active === previewRecents.length + (hasMore ? 1 : 0)
                  }
                  className="aven-menu-item"
                >
                  <span className="aven-menu-label">Choose folder…</span>
                </button>
              ) : null}
              {onNewTerminal ? (
                <button
                  type="button"
                  role="menuitem"
                  onMouseDown={(e) => e.stopPropagation()}
                  onMouseEnter={() => {
                    setMoreOpen(false);
                    setActive(newTerminalIndex);
                  }}
                  onClick={() => pick({ kind: "new-terminal" })}
                  data-active={active === newTerminalIndex}
                  className="aven-menu-item"
                >
                  <span className="aven-menu-label">New terminal</span>
                  <span className="aven-menu-shortcut">{MOD}`</span>
                </button>
              ) : null}
            </div>
          ) : null}
        </Popover>
      ) : null}
      {open && moreOpen ? (
        <Popover
          anchor={moreRef}
          side="right"
          gap={SUBMENU_GAP}
          width={MENU_WIDTH}
          maxHeight={SUBMENU_MAX_HEIGHT}
          layer={LAYER.submenu}
          role="menu"
          aria-label="More projects"
          data-cwd-submenu
          className="aven-menu overflow-y-auto overscroll-none"
          onMouseEnter={openMore}
          onMouseLeave={scheduleCloseMore}
        >
          {overflowRecents.map((item) => (
            <button
              key={item.path}
              type="button"
              role="menuitem"
              title={displayAppData(item.path)}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => pick({ kind: "recent", path: item.path })}
              className="aven-menu-item"
            >
              <span className="aven-menu-label">{basename(item.path)}</span>
              <span className="aven-menu-detail max-w-28 font-mono">
                {displayAppData(prettyParent(item.path))}
              </span>
            </button>
          ))}
        </Popover>
      ) : null}
    </div>
  );
}

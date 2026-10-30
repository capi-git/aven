import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { logError } from "../lib/errors";
import {
  GIT_SETUP_WORDS,
  botGitNote,
  gitSetupError,
  setUpProjectGit,
  type GitSetupNeed,
} from "../lib/projectGitSetup";
import { useUsagePanelTheme } from "../lib/usagePanel";
import { Modal } from "./Modal";
import { Popover } from "./Popover";
import { ToolbarPanel } from "./ToolbarPanel";
import "./Menu.css";
import "./WorkspaceMenuPanel.css";
import "./TeamCard.css";
import "./BotPicker.css";

/** A project the picker lists: ready for a bot, or needing Git first. */
export type BotPickerProject = {
  path: string;
  label: string;
  state: "ready" | GitSetupNeed;
};

type NeedsGit = BotPickerProject & { state: GitSetupNeed };

const needsGit = (project: BotPickerProject): project is NeedsGit =>
  project.state !== "ready";

export const BOT_PICKER_WIDTH = 300;

type ListProps = {
  projects: readonly BotPickerProject[];
  /** Said when no project is listed. */
  empty: string;
  /** Add the project's bot; a project that needed Git has it by now. */
  onAdd: (path: string) => void;
  /** A row started or finished setting up Git. */
  onBusyChange?: (busy: boolean) => void;
};

/** Up and down move between the picker's buttons. */
function moveFocus(event: KeyboardEvent<HTMLElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const buttons = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
      "button:not(:disabled)",
    ),
  ];
  if (!buttons.length) return;
  event.preventDefault();
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : index < 0
          ? event.key === "ArrowDown"
            ? 0
            : buttons.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
            buttons.length;
  buttons[next]?.focus();
}

/**
 * The projects that can have a bot, then below them the ones that need Git
 * first, each with one button that sets it up and then adds the bot.
 */
export function BotPickerList({
  projects,
  empty,
  onAdd,
  onBusyChange,
}: ListProps) {
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const ready = projects.filter((project) => project.state === "ready");
  const needGit = projects.filter(needsGit);
  const busy = (path: string | null) => {
    setBusyPath(path);
    onBusyChange?.(path !== null);
  };
  return (
    <>
      <div
        className="aven-menu workspace-menu-panel-items bot-picker-items"
        onKeyDown={moveFocus}
      >
        {ready.map((project) => (
          <button
            key={project.path}
            type="button"
            className="aven-menu-item"
            data-bot-ready=""
            disabled={busyPath !== null}
            onClick={() => onAdd(project.path)}
          >
            <span className="aven-menu-label">{project.label}</span>
          </button>
        ))}
        {ready.length && needGit.length ? (
          <div role="separator" className="aven-menu-separator" />
        ) : null}
        {needGit.map((project) => (
          <BotGitSetupRow
            key={project.path}
            project={project}
            locked={busyPath !== null && busyPath !== project.path}
            onBusyChange={(on) => busy(on ? project.path : null)}
            onReady={onAdd}
          />
        ))}
        {!projects.length ? (
          <p className="aven-menu-note workspace-menu-panel-empty">{empty}</p>
        ) : null}
      </div>
      {needGit.length ? (
        <p className="bot-picker-note">{botGitNote()}</p>
      ) : null}
    </>
  );
}

/**
 * One project that needs Git: its name, a grey note, and the button that
 * sets Git up. While that runs the row says so; a problem shows on the row.
 */
function BotGitSetupRow({
  project,
  locked,
  onBusyChange,
  onReady,
}: {
  project: NeedsGit;
  /** Another row is setting up Git. */
  locked: boolean;
  onBusyChange: (busy: boolean) => void;
  onReady: (path: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const words = GIT_SETUP_WORDS[project.state];
  const setUp = async () => {
    setBusy(true);
    setProblem(null);
    onBusyChange(true);
    try {
      await setUpProjectGit(project.path);
    } catch (error) {
      logError("Set up Git", error);
      if (!mounted.current) return;
      setBusy(false);
      setProblem(gitSetupError(error));
      onBusyChange(false);
      return;
    }
    // Dismissed meanwhile: Git is set up, and the bot waits for the next
    // time it is asked for.
    if (!mounted.current) return;
    setBusy(false);
    onBusyChange(false);
    onReady(project.path);
  };
  return (
    <div
      className="bot-picker-setup"
      data-bot-setup={project.state}
      aria-busy={busy || undefined}
    >
      <span className="bot-picker-setup-text">
        <span className="bot-picker-setup-name" title={project.path}>
          {project.label}
        </span>
        {busy ? (
          <small role="status">{words.busy}</small>
        ) : (
          <small>{words.note}</small>
        )}
      </span>
      <button
        type="button"
        className="team-card-button"
        data-size="compact"
        disabled={busy || locked}
        aria-label={`${words.action} for ${project.label}`}
        onClick={() => void setUp()}
      >
        {words.action}
      </button>
      {problem ? (
        <p className="bot-picker-problem" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/** New bot: the picker under the button that opened it. */
export function BotPicker({
  x,
  y,
  onClose,
  onBusyChange,
  label = "Add a bot to",
  ...list
}: ListProps & {
  x: number;
  y: number;
  onClose: () => void;
  /** What the picker adds, for screen readers: "Add a crew to". */
  label?: string;
}) {
  const theme = useUsagePanelTheme(true);
  // Setting up Git can't be stopped halfway, so the picker stays until the
  // row is done.
  const busy = useRef(false);
  return (
    <Popover
      autoFocus
      initialFocus="button:not(:disabled)"
      tabIndex={-1}
      anchor={{ x, y }}
      width={BOT_PICKER_WIDTH}
      panel
      role="dialog"
      aria-label={label}
      onDismiss={() => {
        if (!busy.current) onClose();
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <ToolbarPanel
        theme={theme}
        className="workspace-menu-panel workspace-menu-panel-compact bot-picker"
      >
        <BotPickerList
          {...list}
          onBusyChange={(on) => {
            busy.current = on;
            onBusyChange?.(on);
          }}
        />
      </ToolbarPanel>
    </Popover>
  );
}

/**
 * Add a bot, asked of one project that needs Git first (from its menu or
 * its Home tile): the same row and button as New bot's picker.
 */
export function BotGitSetupSheet({
  project,
  onAdd,
  onClose,
}: {
  project: BotPickerProject;
  onAdd: (path: string) => void;
  onClose: () => void;
}) {
  const busy = useRef(false);
  return (
    <Modal
      onClose={() => {
        if (!busy.current) onClose();
      }}
      title="Add a bot"
      size="sm"
      className="bot-git-sheet"
    >
      <div className="bot-git-sheet-body">
        <BotPickerList
          projects={[project]}
          empty=""
          onAdd={onAdd}
          onBusyChange={(on) => {
            busy.current = on;
          }}
        />
      </div>
    </Modal>
  );
}

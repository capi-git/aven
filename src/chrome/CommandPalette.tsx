import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  PALETTE_START,
  cycleIndex,
  mergePaletteChats,
  offersNewChat,
  parsePaletteQuery,
  rankPaletteChats,
  rankPaletteCommands,
  type PaletteAgent,
  type PaletteChat,
  type PaletteCommand,
  type PaletteCommandId,
} from "../lib/commandPalette";
import {
  loadProjectFiles,
  peekProjectFiles,
  rankProjectFiles,
  recentOpenedFiles,
  type RankedFile,
} from "../lib/fileIndex";
import type { ProjectFile } from "../lib/fs";
import { fuzzyMatch } from "../lib/fuzzy";
import { LAYER } from "../lib/layers";
import { MOD } from "../lib/platform";
import { looksLikeProject } from "../lib/recents";
import { sessionDisplayTitle } from "../lib/session";
import type { SettingsSearchResult } from "../lib/settingsSearch";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { FileTypeIcon } from "./FileTypeIcon";
import { HarnessIcon } from "./HarnessIcon";
import {
  Folder,
  Globe,
  MessageSquarePlus,
  Search,
  Settings,
  Terminal,
  Zap,
} from "./icons";

export type PaletteProject = { path: string; name: string };

export type PaletteRaceRequest = {
  text: string;
  agents: PaletteAgent[];
  project: string;
};

export type PaletteChatRequest = {
  text: string;
  agent: PaletteAgent;
  project: string;
  background: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  project: PaletteProject;
  projects: readonly PaletteProject[];
  chats: readonly PaletteChat[];
  agents: readonly PaletteAgent[];
  commands: readonly PaletteCommand[];
  searchChats: (query: string) => Promise<PaletteChat[]>;
  searchSettings: (query: string) => SettingsSearchResult[];
  onRunCommand: (id: PaletteCommandId) => void;
  onOpenChat: (id: string) => void;
  onOpenProject: (path: string) => void;
  onOpenFile: (path: string) => void;
  onOpenSetting: (setting: SettingsSearchResult) => void;
  onStartChat: (request: PaletteChatRequest) => void;
  /** Absent hides races. */
  onStartRace?: (request: PaletteRaceRequest) => void;
};

type Item =
  | { kind: "new-chat"; key: string }
  | { kind: "race"; key: string }
  | { kind: "command"; key: string; command: PaletteCommand }
  | { kind: "chat"; key: string; chat: PaletteChat }
  | { kind: "project"; key: string; project: PaletteProject }
  | { kind: "file"; key: string; file: RankedFile }
  | { kind: "setting"; key: string; setting: SettingsSearchResult };

type Section = { title: string; items: Item[] };

const COMMAND_ICONS: Partial<Record<PaletteCommandId, ReactNode>> = {
  new_chat: <MessageSquarePlus className="size-3.5" />,
  new_terminal: <Terminal className="size-3.5" />,
  new_browser_tab: <Globe className="size-3.5" />,
  open_search: <Search className="size-3.5" />,
  open_settings: <Settings className="size-3.5" />,
  add_project: <Folder className="size-3.5" />,
};

/** ⌘K: jump anywhere, run a command, or start a chat from what you type. */
export function CommandPalette(props: Props) {
  if (!props.open) return null;
  return <CommandPaletteBody {...props} />;
}

function CommandPaletteBody({
  onClose,
  project,
  projects,
  chats,
  agents,
  commands,
  searchChats,
  searchSettings,
  onRunCommand,
  onOpenChat,
  onOpenProject,
  onOpenFile,
  onOpenSetting,
  onStartChat,
  onStartRace,
}: Props) {
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement | null>(null);
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [agentIndex, setAgentIndex] = useState(0);
  const targets = useMemo(
    () => [project, ...projects.filter((item) => item.path !== project.path)],
    [project, projects],
  );
  const [targetIndex, setTargetIndex] = useState(0);
  const [files, setFiles] = useState<ProjectFile[]>(
    () => peekProjectFiles(project.path) ?? [],
  );
  const [remoteChats, setRemoteChats] = useState<PaletteChat[]>([]);
  const { mode, text } = parsePaletteQuery(query);
  const newChat = offersNewChat(mode, text) && agents.length > 0;
  const agent = agents[agentIndex] ?? agents[0];
  const target = targets[targetIndex] ?? project;
  // Race the chosen agent against the next distinct one.
  const raceAgents = agent
    ? [agent, ...agents.filter((item) => item.harness !== agent.harness)].slice(
        0,
        2,
      )
    : [];
  const canRace = newChat && !!onStartRace && raceAgents.length >= 2;

  useEffect(() => {
    input.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // Files for the current project, shared with Go to File's index.
  useEffect(() => {
    if (!looksLikeProject(project.path)) return;
    let cancelled = false;
    void loadProjectFiles(project.path)
      .then((next) => {
        if (!cancelled) setFiles(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [project.path]);

  // Chats in every project come from the session index, debounced.
  useEffect(() => {
    if (!text || (mode !== "all" && mode !== "chats")) {
      setRemoteChats([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchChats(text)
        .then((found) => {
          if (!cancelled) setRemoteChats(found);
        })
        .catch(() => {});
    }, 140);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mode, text, searchChats]);

  const sections = useMemo<Section[]>(() => {
    const out: Section[] = [];
    const add = (title: string, items: Item[]) => {
      if (items.length) out.push({ title, items });
    };
    const commandItems = (found: PaletteCommand[]) =>
      found.map((command): Item => ({
        kind: "command",
        key: `command:${command.id}`,
        command,
      }));
    const chatItems = (found: PaletteChat[]) =>
      found.map((chat): Item => ({
        kind: "chat",
        key: `chat:${chat.id}`,
        chat,
      }));
    const projectItems = (found: PaletteProject[]) =>
      found.map((item): Item => ({
        kind: "project",
        key: `project:${item.path}`,
        project: item,
      }));
    const fileItems = (limit: number) =>
      rankProjectFiles(files, text, recentOpenedFiles(project.path), limit).map(
        (file): Item => ({ kind: "file", key: `file:${file.path}`, file }),
      );
    const settingItems = (limit: number) =>
      searchSettings(text)
        .slice(0, limit)
        .map((setting): Item => ({
          kind: "setting",
          key: `setting:${setting.id}`,
          setting,
        }));
    const matchingProjects = () =>
      projects.filter((item) => fuzzyMatch(text, item.name)).slice(0, 4);

    if (mode === "commands") {
      add("Commands", commandItems(rankPaletteCommands(commands, text)));
      if (text) add("Settings", settingItems(8));
      return out;
    }
    if (mode === "files") {
      add("Files", fileItems(40));
      return out;
    }
    if (mode === "chats") {
      add(
        "Chats",
        chatItems(
          rankPaletteChats(mergePaletteChats(chats, remoteChats), text, 20),
        ),
      );
      return out;
    }
    if (!text) {
      add(
        "Start",
        commandItems(
          PALETTE_START.flatMap((id) =>
            commands.filter((command) => command.id === id),
          ),
        ),
      );
      add("Recent chats", chatItems(rankPaletteChats(chats, "", 5)));
      add("Projects", projectItems(projects.slice(0, 5)));
      return out;
    }
    if (newChat)
      out.push({
        title: "",
        items: [
          { kind: "new-chat", key: "new-chat" },
          ...(canRace ? [{ kind: "race" as const, key: "race" }] : []),
        ],
      });
    add(
      "Chats",
      chatItems(
        rankPaletteChats(mergePaletteChats(chats, remoteChats), text, 5),
      ),
    );
    add(
      "Commands",
      commandItems(rankPaletteCommands(commands, text).slice(0, 4)),
    );
    add("Projects", projectItems(matchingProjects()));
    add("Files", fileItems(5));
    add("Settings", settingItems(3));
    return out;
  }, [
    mode,
    text,
    commands,
    chats,
    remoteChats,
    projects,
    files,
    project.path,
    searchSettings,
    newChat,
    canRace,
  ]);

  const items = useMemo(
    () => sections.flatMap((section) => section.items),
    [sections],
  );

  useEffect(() => {
    setActive(0);
  }, [query]);
  useEffect(() => {
    setActive((index) => Math.min(index, Math.max(0, items.length - 1)));
  }, [items.length]);
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-palette-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const start = (background: boolean) => {
    if (!agent) return;
    onStartChat({ text, agent, project: target.path, background });
    onClose();
  };
  const race = () => {
    if (!canRace || !onStartRace) return;
    onStartRace({ text, agents: raceAgents, project: target.path });
    onClose();
  };
  const activate = (item: Item | undefined) => {
    if (!item) return;
    if (item.kind === "new-chat") return start(false);
    if (item.kind === "race") return race();
    onClose();
    if (item.kind === "command") onRunCommand(item.command.id);
    else if (item.kind === "chat") onOpenChat(item.chat.id);
    else if (item.kind === "project") onOpenProject(item.project.path);
    else if (item.kind === "file") onOpenFile(item.file.path);
    else onOpenSetting(item.setting);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (items.length)
        setActive((index) =>
          cycleIndex(items.length, index, event.key === "ArrowDown" ? 1 : -1),
        );
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      if (!newChat) return;
      if (event.shiftKey)
        setTargetIndex((index) => cycleIndex(targets.length, index, 1));
      else setAgentIndex((index) => cycleIndex(agents.length, index, 1));
      return;
    }
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (newChat && (event.metaKey || event.ctrlKey)) return start(true);
      if (canRace && event.altKey) return race();
      activate(items[active]);
    }
  };

  let index = -1;
  return createPortal(
    <div className="fixed inset-0" style={{ zIndex: LAYER.dialog }}>
      <div className="absolute inset-0 bg-black/40" onMouseDown={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        data-command-palette
        onMouseDown={(event) => event.stopPropagation()}
        className="absolute left-1/2 top-[11%] flex max-h-[min(560px,76vh)] w-[min(640px,calc(100vw-24px))] -translate-x-1/2 flex-col overflow-hidden rounded-[14px] border border-content/15 bg-[color-mix(in_srgb,var(--color-content)_5%,var(--color-background-base))] shadow-2xl"
      >
        <label className="flex items-center gap-2.5 border-b border-content/10 px-4 py-3 text-content/50">
          <Search className="size-4 shrink-0" strokeWidth={1.75} />
          <input
            ref={input}
            value={query}
            placeholder="Search, run a command, or start a chat…"
            aria-label="Command palette"
            aria-activedescendant={
              items[active] ? `palette-${active}` : undefined
            }
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-content outline-none placeholder:text-content/40"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd className="rounded border border-content/15 px-1.5 text-[11px] text-content/45">
            esc
          </kbd>
        </label>
        <div
          ref={(element) => {
            list.current = element;
            lockOverscroll(element);
          }}
          role="listbox"
          className="min-h-0 flex-1 overflow-y-auto p-1.5"
        >
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-[12px] text-content/45">
              {mode === "files" && !looksLikeProject(project.path)
                ? "Open a project to search its files."
                : "Nothing matches."}
            </p>
          ) : null}
          {sections.map((section) => (
            <div
              key={section.title || "new-chat"}
              role="group"
              aria-label={section.title || "New chat"}
            >
              {section.title ? (
                <div className="px-2.5 pb-1 pt-2 text-[11px] text-content/40">
                  {section.title}
                </div>
              ) : null}
              {section.items.map((item) => {
                index += 1;
                const position = index;
                const selected = position === active;
                if (item.kind === "race")
                  return (
                    <div
                      key={item.key}
                      id={`palette-${position}`}
                      role="option"
                      aria-selected={selected}
                      data-palette-index={position}
                      onMouseMove={() => setActive(position)}
                      onClick={race}
                      className={`mx-1 flex cursor-default items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] ${selected ? "bg-content/10" : ""}`}
                    >
                      <Zap className="size-4 shrink-0 text-content/60" />
                      <span className="min-w-0 flex-1 truncate text-content">
                        Race it:{" "}
                        {raceAgents
                          .map((item) => item.label.split(" · ")[0])
                          .join(" vs ")}
                      </span>
                      <span className="shrink-0 text-[11px] text-content/40">
                        separate copies · ⌥↵
                      </span>
                    </div>
                  );
                if (item.kind === "new-chat")
                  return (
                    <div
                      key={item.key}
                      id={`palette-${position}`}
                      role="option"
                      aria-selected={selected}
                      data-palette-index={position}
                      onMouseMove={() => setActive(position)}
                      onClick={() => start(false)}
                      className={`m-1 cursor-default rounded-[10px] border px-3 py-2.5 ${selected ? "border-content/25 bg-content/[0.07]" : "border-content/12 bg-content/[0.03]"}`}
                    >
                      <div className="flex items-center gap-2.5">
                        <MessageSquarePlus className="size-4 shrink-0 text-content/60" />
                        <span className="min-w-0 flex-1 truncate text-[13px] text-content">
                          Start a chat: “{text}”
                        </span>
                        <kbd className="text-[11px] text-content/45">↵</kbd>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Chip
                          label={
                            agent ? `${agent.label}` : "No agent available"
                          }
                          icon={
                            agent ? (
                              <HarnessIcon
                                harness={agent.harness}
                                className="size-3.5"
                              />
                            ) : null
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            setAgentIndex((current) =>
                              cycleIndex(agents.length, current, 1),
                            );
                          }}
                        />
                        <Chip
                          label={target.name}
                          icon={<Folder className="size-3.5" />}
                          onClick={(event) => {
                            event.stopPropagation();
                            setTargetIndex((current) =>
                              cycleIndex(targets.length, current, 1),
                            );
                          }}
                        />
                      </div>
                    </div>
                  );
                return (
                  <div
                    key={item.key}
                    id={`palette-${position}`}
                    role="option"
                    aria-selected={selected}
                    data-palette-index={position}
                    onMouseMove={() => setActive(position)}
                    onClick={() => activate(item)}
                    className={`flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] ${selected ? "bg-content/10" : ""}`}
                  >
                    <Row item={item} project={project} />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-content/10 px-4 py-2 text-[11px] text-content/40">
          {newChat ? (
            <>
              <span>↵ start chat</span>
              <span>{MOD}↵ start in background</span>
              <span>⇥ agent</span>
              <span>⇧⇥ project</span>
              {canRace ? <span>⌥↵ race</span> : null}
            </>
          ) : (
            <>
              <span>↑↓ move</span>
              <span>↵ open</span>
              <span>&gt; commands</span>
              <span>@ files</span>
              <span># chats</span>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Chip({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick: (event: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={onClick}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-content/15 bg-content/[0.06] px-2 py-0.5 text-[12px] text-content hover:bg-content/10"
    >
      {icon}
      <span className="truncate">{label}</span>
      <span className="text-content/40">▾</span>
    </button>
  );
}

function Row({ item, project }: { item: Item; project: PaletteProject }) {
  if (item.kind === "command")
    return (
      <>
        <span className="grid size-4 shrink-0 place-items-center text-content/55">
          {COMMAND_ICONS[item.command.id] ?? <Zap className="size-3.5" />}
        </span>
        <span className="min-w-0 flex-1 truncate text-content">
          {item.command.label}
        </span>
        {item.command.keys ? (
          <kbd className="shrink-0 text-[11px] text-content/40">
            {item.command.keys}
          </kbd>
        ) : null}
      </>
    );
  if (item.kind === "chat")
    return (
      <>
        <HarnessIcon harness={item.chat.harness} className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-content">
          {sessionDisplayTitle(item.chat.title, item.chat.harness)}
        </span>
        <span className="shrink-0 truncate text-[12px] text-content/40">
          {item.chat.busy ? "running" : projectLabel(item.chat.cwd, project)}
        </span>
      </>
    );
  if (item.kind === "project")
    return (
      <>
        <Folder className="size-4 shrink-0 text-content/55" />
        <span className="min-w-0 flex-1 truncate text-content">
          {item.project.name}
        </span>
        <span className="shrink-0 truncate text-[12px] text-content/40">
          {item.project.path}
        </span>
      </>
    );
  if (item.kind === "file")
    return (
      <>
        <FileTypeIcon name={item.file.name} isDir={false} />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-content">
          {item.file.relative}
        </span>
      </>
    );
  if (item.kind === "setting")
    return (
      <>
        <Settings className="size-4 shrink-0 text-content/55" />
        <span className="min-w-0 flex-1 truncate text-content">
          {item.setting.label}
        </span>
        <span className="shrink-0 text-[12px] capitalize text-content/40">
          {item.setting.section}
        </span>
      </>
    );
  return null;
}

function projectLabel(cwd: string, current: PaletteProject) {
  if (cwd === current.path) return current.name;
  const parts = cwd.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

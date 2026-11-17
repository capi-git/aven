import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  projectDisplayName,
  useProjectLabels,
} from "../hooks/useProjectLabels";
import { sameProjectPath } from "../lib/recents";
import {
  loadSettingsProject,
  saveSettingsProject,
  subscribeSettingsProject,
} from "../lib/settingsProject";
import { pageHeadings, type PageHeading } from "../lib/settingsHeadings";
import {
  AppWindow,
  Archive,
  Copy,
  Folder,
  ArrowLeft,
  Bot,
  GitBranch,
  Globe,
  Inbox,
  Keyboard,
  MessageSquare,
  Palette,
  Search,
  Settings,
  Terminal,
  Wrench,
  type IconComponent,
} from "./icons";
import {
  SETTINGS_SECTIONS,
  settingsSectionLabel,
  type SettingsSectionId,
} from "../lib/settings";
import { requestSettingsAnchor, searchSettings } from "../lib/settingsSearch";
import "./SettingsRail.css";

export const SECTION_ICONS: Record<SettingsSectionId, IconComponent> = {
  general: Settings,
  appearance: Palette,
  notifications: Inbox,
  keybindings: Keyboard,
  providers: Bot,
  "provider-setup": Wrench,
  tasks: MessageSquare,
  skills: Wrench,
  git: GitBranch,
  connections: Globe,
  browser: AppWindow,
  worktrees: Copy,
  terminal: Terminal,
  project: Folder,
  archive: Archive,
};

const SECTION_DESCRIPTIONS: Record<SettingsSectionId, string> = {
  general: "Updates & extras",
  appearance: "Colour & transparency",
  notifications: "Alerts & sound",
  keybindings: "Find a command or key",
  providers: "Agents & models",
  "provider-setup": "Install & sign in",
  tasks: "Access, follow-ups & review",
  skills: "Instructions & computer use",
  git: "Commits & pull requests",
  connections: "Linked services",
  browser: "Tab memory",
  worktrees: "Copies & branches",
  terminal: "Font & cursor",
  project: "Name, scripts & memory",
  archive: "Saved history",
};

type Props = {
  section: SettingsSectionId;
  onSelect: (section: SettingsSectionId) => void;
  onClose: () => void;
  embedded?: boolean;
  /** The workspace's projects, each with its own page under Projects. */
  projects?: readonly string[];
};

/** The same navigation can live in the project rail or beside settings content. */
export function SettingsNav({
  section,
  onSelect,
  onClose,
  embedded = false,
  projects = [],
}: Props) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLElement | null>(null);
  const results = useMemo(() => searchSettings(query), [query]);
  const searching = query.trim().length > 0;
  const headings = usePageHeadings(section);
  // Escape anywhere in Settings clears an open search before it closes Settings.
  useEffect(() => {
    if (!query) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape") return;
      if (
        document.querySelector(
          '[role="dialog"], [role="alertdialog"], [role="menu"]',
        )
      )
        return;
      event.preventDefault();
      setQuery("");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [query]);

  return (
    <div className={`settings-nav${embedded ? " settings-nav--embedded" : ""}`}>
      <div className="settings-nav__back">
        <NavRow
          label="Back to app"
          icon={ArrowLeft}
          onClick={onClose}
          keyHint="esc"
        />
      </div>
      <label className="settings-nav__search">
        <Search className="size-3.5 shrink-0" aria-hidden />
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.preventDefault();
              event.stopPropagation();
              setQuery("");
            } else if (event.key === "ArrowDown" && searching) {
              event.preventDefault();
              resultsRef.current
                ?.querySelector<HTMLButtonElement>("button")
                ?.focus();
            }
          }}
          type="search"
          aria-label="Search settings"
          placeholder="Search settings"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      {searching ? (
        <nav
          ref={resultsRef}
          aria-label="Settings search results"
          className="settings-nav__sections"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            setQuery("");
            searchRef.current?.focus();
          }}
        >
          <p className="settings-nav__group" role="status">
            {results.length
              ? `${results.length} ${results.length === 1 ? "setting" : "settings"}`
              : "No matching settings"}
          </p>
          {results.map((result) => (
            <button
              type="button"
              key={result.id}
              className="settings-nav__item settings-nav__result"
              title={result.description}
              onClick={() => {
                setQuery("");
                requestSettingsAnchor(result.id, result.section);
                onSelect(result.section);
              }}
            >
              <span className="settings-nav__icon-tile" aria-hidden="true">
                {(() => {
                  const Icon = SECTION_ICONS[result.section];
                  return (
                    <Icon className="settings-nav__icon" strokeWidth={1.75} />
                  );
                })()}
              </span>
              <span className="settings-nav__result-copy">
                <span className="settings-nav__label">{result.label}</span>
                <small>{settingsSectionLabel(result.section)}</small>
              </span>
            </button>
          ))}
        </nav>
      ) : (
        <nav aria-label="Settings sections" className="settings-nav__sections">
          {SETTINGS_SECTIONS.flatMap((item, index) => [
            ...(index === 0 || SETTINGS_SECTIONS[index - 1].group !== item.group
              ? [
                  <div
                    key={`group-${item.group}`}
                    className="settings-nav__group"
                  >
                    {item.group}
                  </div>,
                ]
              : []),
            <NavRow
              key={item.id}
              sectionId={item.id}
              label={item.label}
              description={SECTION_DESCRIPTIONS[item.id]}
              icon={SECTION_ICONS[item.id]}
              active={item.id === section}
              onClick={() => onSelect(item.id)}
            />,
            // The open page's headings, Super-style: a click scrolls to one.
            ...(item.id === section && headings.length > 1
              ? [
                  <div
                    key={`${item.id}-headings`}
                    className="settings-nav__headings"
                  >
                    {headings.map((heading, index) => (
                      <button
                        type="button"
                        key={`${index}-${heading.title}`}
                        className="settings-nav__heading"
                        onClick={() =>
                          heading.element.scrollIntoView({
                            block: "start",
                            behavior: "smooth",
                          })
                        }
                      >
                        {heading.title}
                      </button>
                    ))}
                  </div>,
                ]
              : []),
          ])}
          {projects.length > 0 ? (
            <ProjectRows
              projects={projects}
              current={section === "project"}
              onSelect={() => onSelect("project")}
            />
          ) : null}
        </nav>
      )}
    </div>
  );
}

/** Settings › Projects: one row per project, each opening its own page. */
function ProjectRows({
  projects,
  current,
  onSelect,
}: {
  projects: readonly string[];
  current: boolean;
  onSelect: () => void;
}) {
  const labels = useProjectLabels();
  const openProject = useSyncExternalStore(
    subscribeSettingsProject,
    loadSettingsProject,
    loadSettingsProject,
  );
  return (
    <>
      <div className="settings-nav__group">Projects</div>
      {projects.map((path) => (
        <NavRow
          key={path}
          label={projectDisplayName(path, labels)}
          description={path}
          icon={Folder}
          active={current && sameProjectPath(openProject, path)}
          onClick={() => {
            saveSettingsProject(path);
            onSelect();
          }}
        />
      ))}
    </>
  );
}

/**
 * The headings of the settings page on screen, kept current as the page
 * renders. Read from the page itself, so every section gets them for free.
 */
function usePageHeadings(section: SettingsSectionId): PageHeading[] {
  const [headings, setHeadings] = useState<PageHeading[]>([]);
  useEffect(() => {
    let frame = 0;
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = pageHeadings(document);
        setHeadings((current) =>
          current.length === next.length &&
          current.every(
            (entry, index) =>
              entry.title === next[index].title &&
              entry.element === next[index].element,
          )
            ? current
            : next,
        );
      });
    };
    read();
    const page = document.querySelector("[data-app-settings]");
    const observer = page ? new MutationObserver(read) : null;
    if (page) observer?.observe(page, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [section]);
  return headings;
}

function NavRow({
  label,
  description,
  sectionId,
  icon: Icon,
  active = false,
  onClick,
  keyHint,
}: {
  label: string;
  description?: string;
  sectionId?: SettingsSectionId;
  icon: IconComponent;
  active?: boolean;
  onClick: () => void;
  keyHint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-description={description}
      aria-current={active ? "page" : undefined}
      title={description}
      data-settings-section={sectionId}
      className="settings-nav__item"
    >
      <span className="settings-nav__icon-tile" aria-hidden="true">
        <Icon className="settings-nav__icon" strokeWidth={1.75} />
      </span>
      <span className="settings-nav__label">{label}</span>
      {keyHint ? (
        <kbd className="settings-nav__key" aria-hidden="true">
          {keyHint}
        </kbd>
      ) : null}
    </button>
  );
}

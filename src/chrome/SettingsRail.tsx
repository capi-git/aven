import { useEffect, useMemo, useRef, useState } from "react";
import {
  AppWindow,
  Archive,
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
  Wrench,
  type IconComponent,
} from "./icons";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import {
  SETTINGS_SECTIONS,
  settingsSectionLabel,
  type SettingsSectionId,
} from "../lib/settings";
import { requestSettingsAnchor, searchSettings } from "../lib/settingsSearch";
import "./SettingsRail.css";

const SECTION_ICONS: Record<SettingsSectionId, IconComponent> = {
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
  archive: Archive,
};

const SECTION_DESCRIPTIONS: Record<SettingsSectionId, string> = {
  general: "Updates & extras",
  appearance: "Colors & transparency",
  notifications: "Alerts & sound",
  keybindings: "Keyboard shortcuts",
  providers: "Agents & models",
  "provider-setup": "Install & sign in",
  tasks: "Access, follow-ups & review",
  skills: "Instructions & computer use",
  git: "Commits & pull requests",
  connections: "Linked services",
  browser: "Tab memory",
  archive: "Saved history",
};

type Props = {
  section: SettingsSectionId;
  onSelect: (section: SettingsSectionId) => void;
  onClose: () => void;
  embedded?: boolean;
};

/** The same navigation can live in the project rail or beside settings content. */
export function SettingsNav({
  section,
  onSelect,
  onClose,
  embedded = false,
}: Props) {
  const lockOverscroll = useLockOverscroll<HTMLElement>();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLElement | null>(null);
  const results = useMemo(() => searchSettings(query), [query]);
  const searching = query.trim().length > 0;
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
      <div className="settings-nav__return">
        <NavRow label="Back to workspace" icon={ArrowLeft} onClick={onClose} />
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
          placeholder="Search"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      {searching ? (
        <nav
          ref={(node) => {
            resultsRef.current = node;
            lockOverscroll(node);
          }}
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
        <nav
          ref={lockOverscroll}
          aria-label="Settings sections"
          className="settings-nav__sections"
        >
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
          ])}
        </nav>
      )}
    </div>
  );
}

function NavRow({
  label,
  description,
  sectionId,
  icon: Icon,
  active = false,
  onClick,
}: {
  label: string;
  description?: string;
  sectionId?: SettingsSectionId;
  icon: IconComponent;
  active?: boolean;
  onClick: () => void;
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
    </button>
  );
}

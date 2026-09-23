import {
  Archive,
  ArrowLeft,
  Bot,
  Keyboard,
  Palette,
  Settings,
  Wrench,
  type IconComponent,
} from "./icons";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "../lib/settings";
import "./SettingsRail.css";

const SECTION_ICONS: Record<SettingsSectionId, IconComponent> = {
  general: Settings,
  appearance: Palette,
  keybindings: Keyboard,
  providers: Bot,
  skills: Wrench,
  archive: Archive,
};

const SECTION_DESCRIPTIONS: Record<SettingsSectionId, string> = {
  general: "Tasks & preferences",
  appearance: "Colors & layout",
  keybindings: "Keyboard shortcuts",
  providers: "Models & connections",
  skills: "Instructions & computer use",
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

  return (
    <div className={`settings-nav${embedded ? " settings-nav--embedded" : ""}`}>
      <nav
        ref={lockOverscroll}
        aria-label="Settings sections"
        className="settings-nav__sections"
      >
        {SETTINGS_SECTIONS.map((item) => (
          <NavRow
            key={item.id}
            sectionId={item.id}
            label={item.label}
            description={SECTION_DESCRIPTIONS[item.id]}
            icon={SECTION_ICONS[item.id]}
            active={item.id === section}
            onClick={() => onSelect(item.id)}
          />
        ))}
      </nav>
      <div className="settings-nav__footer">
        <NavRow label="Back" icon={ArrowLeft} onClick={onClose} />
      </div>
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

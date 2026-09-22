import {
  Archive,
  ArrowLeft,
  Bot,
  Keyboard,
  Palette,
  SlidersHorizontal,
  type IconComponent,
} from "./icons";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "../lib/settings";
import "./SettingsRail.css";

const SECTION_ICONS: Record<SettingsSectionId, IconComponent> = {
  general: SlidersHorizontal,
  appearance: Palette,
  keybindings: Keyboard,
  providers: Bot,
  archive: Archive,
};

const SECTION_SUBTITLES: Record<SettingsSectionId, string> = {
  general: "Tasks & preferences",
  appearance: "Colors & layout",
  keybindings: "Keyboard shortcuts",
  providers: "Models & connections",
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
            label={item.label}
            subtitle={SECTION_SUBTITLES[item.id]}
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
  subtitle,
  icon: Icon,
  active = false,
  onClick,
}: {
  label: string;
  subtitle?: string;
  icon: IconComponent;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className="settings-nav__item"
    >
      <Icon
        className="settings-nav__icon"
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <span className="settings-nav__copy">
        <span className="settings-nav__label">{label}</span>
        {subtitle && <span className="settings-nav__subtitle">{subtitle}</span>}
      </span>
    </button>
  );
}

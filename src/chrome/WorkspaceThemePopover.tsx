import {
  useCallback,
  useId,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import {
  resolveColorScheme,
  SIDEBAR_BLUR_MAX,
  SIDEBAR_BLUR_MIN,
  SIDEBAR_OPACITY_MAX,
  SIDEBAR_OPACITY_MIN,
} from "../lib/appearance";
import { HAS_NATIVE_GLASS } from "../lib/platform";
import {
  applyWorkspaceThemePreset,
  resolvedWorkspaceColors,
  saveWorkspaceColor,
  type WorkspaceColorTarget,
  resetWorkspaceTheme,
  saveWorkspaceTheme,
  useWorkspaceTheme,
  WORKSPACE_THEME_PRESETS,
} from "../lib/workspaceThemes";
import { Check, RotateCcw, X } from "./icons";
import { Popover } from "./Popover";
import { WorkspaceColorPicker } from "./WorkspaceColorPicker";
import { ApplyWorkspaceThemeButton } from "./ApplyWorkspaceThemeButton";
import "./WorkspaceThemePopover.css";

type Props = {
  profileId: string;
  profileName: string;
  anchor: HTMLButtonElement;
  onDismiss: () => void;
  side?: "top" | "bottom";
};

export function WorkspaceThemePopover({
  profileId,
  profileName,
  anchor,
  onDismiss,
  side = "top",
}: Props) {
  const theme = useWorkspaceTheme(profileId);
  // The edited profile may be inactive; the current window scheme belongs
  // to a different profile. Only a System choice needs an OS subscription.
  const subscribeScheme = useCallback(
    (onChange: () => void) => {
      if (theme.preference !== "system" || !window.matchMedia) return () => {};
      const query = window.matchMedia("(prefers-color-scheme: light)");
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    [theme.preference],
  );
  const readScheme = useCallback(
    () => resolveColorScheme(theme.preference),
    [theme.preference],
  );
  const scheme = useSyncExternalStore(subscribeScheme, readScheme, readScheme);
  const glassDisabled = !HAS_NATIVE_GLASS || scheme === "light";
  const opacity = Math.round(theme.opacity * 100);
  const [target, setTarget] = useState<WorkspaceColorTarget>("background");
  const colors = resolvedWorkspaceColors(theme, scheme);
  const targetLabel =
    target === "background"
      ? "Background"
      : target === "accent"
        ? "Accent"
        : "Highlights";
  const id = useId();
  const dismiss = useCallback(
    (restoreFocus: boolean) => {
      onDismiss();
      if (restoreFocus && anchor.isConnected)
        anchor.focus({ preventScroll: true });
    },
    [anchor, onDismiss],
  );
  return (
    <Popover
      anchor={anchor}
      side={side}
      align="start"
      gap={8}
      width={284}
      role="dialog"
      aria-label={`Customize ${profileName}`}
      tabIndex={-1}
      onDismiss={(reason) => dismiss(reason === "escape")}
      autoFocus
      bare
      className="workspace-theme-popover"
    >
      <div className="workspace-theme-heading">
        <span>{profileName}</span>
        <span className="workspace-theme-caption">Appearance</span>
        <button
          type="button"
          className="workspace-theme-close"
          aria-label="Close appearance"
          title="Close appearance (Esc)"
          onClick={() => dismiss(true)}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      <div
        className="workspace-theme-schemes"
        role="group"
        aria-label={`${profileName} color scheme`}
      >
        {(["dark", "light", "system"] as const).map((preference) => (
          <button
            key={preference}
            type="button"
            aria-pressed={theme.preference === preference}
            onClick={() => saveWorkspaceTheme(profileId, { preference })}
          >
            {preference[0].toUpperCase() + preference.slice(1)}
          </button>
        ))}
      </div>
      <div
        className="workspace-theme-targets"
        role="group"
        aria-label="Customize colors"
      >
        {(["background", "accent", "highlight"] as const).map((part) => (
          <button
            key={part}
            type="button"
            aria-pressed={target === part}
            onClick={() => setTarget(part)}
          >
            <span style={{ backgroundColor: colors[part] }} aria-hidden />
            {part === "highlight"
              ? "Highlights"
              : part[0].toUpperCase() + part.slice(1)}
          </button>
        ))}
      </div>
      <WorkspaceColorPicker
        key={`${scheme}:${target}`}
        label={targetLabel}
        value={colors[target]}
        onChange={(color) =>
          saveWorkspaceColor(profileId, scheme, target, color)
        }
      />
      <div className="workspace-theme-preset-heading">
        <span>Presets</span>
        <span>{WORKSPACE_THEME_PRESETS.length} colors</span>
      </div>
      <div
        className="workspace-theme-presets"
        role="group"
        aria-label={`${profileName} palette`}
      >
        {WORKSPACE_THEME_PRESETS.map((preset) => {
          const palette = preset.colors[scheme];
          const selected =
            colors.background === palette.background &&
            colors.accent === palette.accent &&
            colors.highlight === palette.highlight;
          return (
            <button
              key={preset.name}
              type="button"
              title={
                preset.name === "Black"
                  ? "Black — solid black in dark mode"
                  : preset.name
              }
              aria-label={`${preset.name} palette`}
              aria-pressed={selected}
              onClick={() => {
                if (preset.name === "Black") {
                  saveWorkspaceTheme(profileId, {
                    preference: "dark",
                    opacity: 1,
                    blur: 0,
                    bodyGlass: true,
                  });
                  applyWorkspaceThemePreset(profileId, preset, "dark");
                } else applyWorkspaceThemePreset(profileId, preset, scheme);
              }}
            >
              <span
                className="workspace-theme-swatch"
                style={
                  {
                    "--swatch-color":
                      preset.name === "Black" ? "#000000" : palette.background,
                  } as CSSProperties
                }
              >
                {selected ? <Check className="size-3" /> : null}
              </span>
              <span>{preset.name}</span>
            </button>
          );
        })}
      </div>
      <fieldset className="workspace-theme-glass" disabled={glassDisabled}>
        <legend className="sr-only">Window transparency</legend>
        <label className="workspace-theme-slider" htmlFor={`${id}-opacity`}>
          <span>Window opacity</span>
          <output>{opacity}%</output>
          <input
            id={`${id}-opacity`}
            type="range"
            min={Math.round(SIDEBAR_OPACITY_MIN * 100)}
            max={Math.round(SIDEBAR_OPACITY_MAX * 100)}
            value={opacity}
            aria-valuetext={`${opacity}% background opacity`}
            aria-describedby={`${id}-glass-hint`}
            onChange={(event) =>
              saveWorkspaceTheme(profileId, {
                opacity: Number(event.target.value) / 100,
              })
            }
          />
        </label>
        <label className="workspace-theme-slider" htmlFor={`${id}-blur`}>
          <span>Background blur</span>
          <output>{theme.blur}px</output>
          <input
            id={`${id}-blur`}
            type="range"
            min={SIDEBAR_BLUR_MIN}
            max={SIDEBAR_BLUR_MAX}
            value={theme.blur}
            aria-describedby={`${id}-glass-hint`}
            onChange={(event) =>
              saveWorkspaceTheme(profileId, {
                blur: Number(event.target.value),
              })
            }
          />
        </label>
        <label className="workspace-theme-glass-toggle">
          <input
            type="checkbox"
            checked={theme.bodyGlass}
            aria-describedby={`${id}-glass-hint`}
            onChange={(event) =>
              saveWorkspaceTheme(profileId, { bodyGlass: event.target.checked })
            }
          />
          <span>Include workspace</span>
        </label>
      </fieldset>
      <p id={`${id}-glass-hint`} className="workspace-theme-hint">
        {!HAS_NATIVE_GLASS
          ? "Transparency is available on macOS."
          : scheme === "light"
            ? "Glass settings are saved for dark mode."
            : opacity === 100
              ? "Solid background. Lower opacity to see desktop blur."
              : "Blur softens the desktop behind the window. Text stays sharp."}
      </p>
      <ApplyWorkspaceThemeButton profileId={profileId} compact />
      <button
        type="button"
        className="workspace-theme-reset"
        onClick={() => resetWorkspaceTheme(profileId)}
      >
        <RotateCcw className="size-3" /> Reset appearance
      </button>
      <span className="workspace-theme-saved">Saved to {profileName}</span>
    </Popover>
  );
}

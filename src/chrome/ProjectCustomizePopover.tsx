import { useEffect, useRef, useState } from "react";
import { useProjectAppearance } from "../hooks/useProjectAppearance";
import { useProjectMemory } from "../hooks/useProjectMemory";
import { normalizeHex } from "../lib/colorUtils";
import { logError } from "../lib/errors";
import { projectName } from "../lib/paths";
import { projectMemoryEdited } from "../lib/projectMemory";
import { clearProjectLogo, pickAndSetProjectLogo } from "../lib/projectLogos";
import { PROJECT_MASCOTS } from "../lib/projectMascots";
import {
  TAB_GROUP_COLORS,
  clearTabGroupSettings,
  saveTabGroupColor,
  saveTabGroupCustomColor,
  saveTabGroupLabel,
  saveTabGroupMascot,
} from "../lib/tabGroups";
import { ColorPickerPopover, ColorSwatchRow } from "./ColorPickerPopover";
import { Brain, ChevronRight, ImagePlus, Trash2 } from "./icons";
import { MemoryKeeperSwitch } from "./MemoryKeeper";
import { Popover, type PopoverAnchor } from "./Popover";
import { ProjectMark } from "./ProjectMark";
import { ProjectMascot } from "./ProjectMascot";
import { ProjectMemoryDialog } from "./ProjectMemoryDialog";

type Props = {
  path: string;
  anchor: PopoverAnchor;
  onClose: () => void;
};

/**
 * Name, colour, logo and mascot for one project. Changes apply as they are
 * made and reach every window; Reset returns to the folder name and the
 * automatic colour and mascot. Project memory opens its own editor from here,
 * so every place that customizes a project also reaches its memory.
 */
export function ProjectCustomizePopover({ path, anchor, onClose }: Props) {
  const [editingMemory, setEditingMemory] = useState(false);
  if (editingMemory)
    return <ProjectMemoryDialog path={path} onClose={onClose} />;
  return (
    <ProjectAppearancePopover
      path={path}
      anchor={anchor}
      onClose={onClose}
      onEditMemory={() => setEditingMemory(true)}
    />
  );
}

function ProjectAppearancePopover({
  path,
  anchor,
  onClose,
  onEditMemory,
}: Props & { onEditMemory: () => void }) {
  const appearance = useProjectAppearance(path);
  const folder = projectName(path);
  const [name, setName] = useState(appearance?.customLabel ?? "");
  const [customOpen, setCustomOpen] = useState(appearance?.customColor != null);
  const [logoBusy, setLogoBusy] = useState(false);
  const nameRef = useRef(name);
  nameRef.current = name;
  const committed = useRef(appearance?.customLabel ?? "");
  // Escape leaves the name as it was, even if closing blurs the field.
  const discarded = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  if (!appearance) return null;
  const key = appearance.key;

  const commitName = () => {
    if (discarded.current) return;
    const next = nameRef.current.trim();
    if (next === committed.current) return;
    committed.current = next;
    saveTabGroupLabel(key, next);
  };
  const close = () => {
    commitName();
    onClose();
  };

  const chooseLogo = () => {
    setLogoBusy(true);
    void pickAndSetProjectLogo(key)
      .catch((error) => logError("Save project logo", error))
      .finally(() => setLogoBusy(false));
  };
  const removeLogo = () => {
    setLogoBusy(true);
    void clearProjectLogo(key)
      .catch((error) => logError("Remove project logo", error))
      .finally(() => setLogoBusy(false));
  };
  const reset = () => {
    committed.current = "";
    setName("");
    setCustomOpen(false);
    // Reads the logo record before the settings below drop it.
    if (appearance.logoPath) removeLogo();
    clearTabGroupSettings(key);
  };

  const shownIndex =
    appearance.customColor != null
      ? null
      : (appearance.colorIndex ?? appearance.automaticColorIndex);
  const customized =
    appearance.customLabel != null ||
    appearance.colorIndex != null ||
    appearance.customColor != null ||
    appearance.mascotOverride != null ||
    appearance.logoPath != null;

  return (
    <Popover
      anchor={anchor}
      side="right"
      align="start"
      gap={6}
      width={256}
      role="dialog"
      aria-label={`Customize ${appearance.label}`}
      onDismiss={(reason) => {
        if (reason === "escape") discarded.current = true;
        else commitName();
        onClose();
      }}
      className="project-customize p-3"
    >
      <div className="flex items-center gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-content/5">
          <ProjectMark appearance={appearance} className="project-mark-large" />
        </span>
        <input
          ref={input}
          value={name}
          maxLength={60}
          placeholder={folder}
          aria-label="Project name"
          spellCheck={false}
          onChange={(event) => setName(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            close();
          }}
          className="aven-field h-8 min-w-0 flex-1 px-2 text-ui-label"
        />
      </div>

      <p className="mt-3 mb-1.5 text-ui-caption text-content/50">Colour</p>
      <ColorSwatchRow
        colors={TAB_GROUP_COLORS}
        colorIndex={shownIndex ?? -1}
        customColor={appearance.customColor}
        customPickerOpen={customOpen}
        onPickIndex={(index) => {
          setCustomOpen(false);
          saveTabGroupColor(key, index);
        }}
        onToggleCustom={() => setCustomOpen((open) => !open)}
      />
      {customOpen ? (
        <ColorPickerPopover
          value={appearance.customColor ?? normalizeHex(appearance.color)}
          onChange={(color) => saveTabGroupCustomColor(key, color)}
        />
      ) : null}

      <p className="mt-3 mb-1.5 text-ui-caption text-content/50">Mascot</p>
      {/* Equal cells that wrap, six to a row, so every mascot fits the
          popover's width however many there are. */}
      <div
        className="grid grid-cols-6 gap-1"
        role="radiogroup"
        aria-label="Mascot"
      >
        {PROJECT_MASCOTS.map((mascot) => {
          const selected = appearance.mascot === mascot.name;
          return (
            <button
              key={mascot.name}
              type="button"
              role="radio"
              title={mascot.label}
              aria-label={mascot.label}
              aria-checked={selected}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => saveTabGroupMascot(key, mascot.name)}
              className={`grid h-7 min-w-0 place-items-center rounded-md ${
                selected
                  ? "bg-content/12 ring-1 ring-content/40"
                  : "hover:bg-content/8"
              }`}
            >
              <ProjectMascot
                project={key}
                name={mascot.name}
                color={appearance.color}
                className="size-[18px]"
              />
            </button>
          );
        })}
      </div>

      <p className="mt-3 mb-1.5 text-ui-caption text-content/50">Logo</p>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={logoBusy}
          onMouseDown={(event) => event.preventDefault()}
          onClick={chooseLogo}
          className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md bg-content/6 px-2 text-ui-label text-content hover:bg-content/10 disabled:opacity-50"
        >
          <ImagePlus className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="truncate">
            {appearance.logoPath ? "Change image…" : "Choose image…"}
          </span>
        </button>
        {appearance.logoPath ? (
          <button
            type="button"
            title="Remove logo"
            aria-label="Remove logo"
            disabled={logoBusy}
            onMouseDown={(event) => event.preventDefault()}
            onClick={removeLogo}
            className="grid size-7 shrink-0 place-items-center rounded-md text-content/55 hover:bg-content/10 hover:text-content disabled:opacity-50"
          >
            <Trash2 className="size-3.5" strokeWidth={1.75} />
          </button>
        ) : null}
      </div>

      <p className="mt-3 mb-1.5 text-ui-caption text-content/50">Memory</p>
      <ProjectMemoryRow
        path={path}
        onOpen={() => {
          commitName();
          onEditMemory();
        }}
      />
      <div className="mt-1">
        <MemoryKeeperSwitch path={path} />
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-content/10 pt-2">
        <button
          type="button"
          disabled={!customized && !name.trim()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={reset}
          className="h-7 rounded-md px-2 text-ui-label text-content/60 hover:bg-content/8 hover:text-content disabled:opacity-40"
        >
          Reset
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={close}
          className="h-7 rounded-md bg-(--aven-control-bg) px-3 text-ui-label text-content hover:bg-(--aven-control-hover) active:bg-(--aven-control-pressed)"
        >
          Done
        </button>
      </div>
    </Popover>
  );
}

/** What the project's memory holds, and the way into its editor. */
function ProjectMemoryRow({
  path,
  onOpen,
}: {
  path: string;
  onOpen: () => void;
}) {
  const { memory, loading } = useProjectMemory(path);
  const summary = loading
    ? ""
    : memory
      ? projectMemoryEdited(memory.updatedAt, Date.now())
      : "Empty";
  return (
    <button
      type="button"
      title="Decisions, conventions and gotchas every agent in this project receives"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onOpen}
      className="flex h-9 w-full min-w-0 items-center gap-2 rounded-md bg-content/6 px-2 text-left text-ui-label text-content hover:bg-content/10"
    >
      <Brain className="size-3.5 shrink-0 text-content/70" strokeWidth={1.75} />
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate">Project memory…</span>
        <span className="truncate text-ui-caption text-content/45">
          {summary}
        </span>
      </span>
      <ChevronRight className="size-3 shrink-0 text-content/40" />
    </button>
  );
}

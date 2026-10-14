import { Popover, type PopoverAnchor } from "./Popover";
import { ArrowDownCircle, Folder, FolderPlus } from "./icons";

/** The sidebar's add-project choices, shared by the workspace and the floating sidebar. */
export function AddProjectMenu({
  anchor,
  onDismiss,
  onAddExisting,
  onClone,
  onCreate,
}: {
  anchor: PopoverAnchor;
  onDismiss: () => void;
  onAddExisting: () => void;
  onClone: () => void;
  onCreate: () => void;
}) {
  return (
    <Popover
      anchor={anchor}
      side="top"
      align="start"
      width={228}
      autoFocus
      onDismiss={onDismiss}
    >
      <div
        className="personal-project-menu"
        role="menu"
        aria-label="Add project"
      >
        <button role="menuitem" onClick={onAddExisting}>
          <FolderPlus className="size-3.5" /> Add existing project
        </button>
        <button role="menuitem" onClick={onClone}>
          <ArrowDownCircle className="size-3.5" /> Clone from URL
        </button>
        <button role="menuitem" onClick={onCreate}>
          <Folder className="size-3.5" /> Quick start new project
        </button>
      </div>
    </Popover>
  );
}

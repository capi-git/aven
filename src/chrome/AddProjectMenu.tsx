import { Popover, type PopoverAnchor } from "./Popover";
import { ArrowDownCircle, Folder, FolderPlus } from "./icons";
import "./Menu.css";

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
      <div className="aven-menu" role="menu" aria-label="Add project">
        <button
          type="button"
          role="menuitem"
          className="aven-menu-item"
          onClick={onAddExisting}
        >
          <span aria-hidden="true" className="aven-menu-icon">
            <FolderPlus />
          </span>
          <span className="aven-menu-label">Add existing project</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="aven-menu-item"
          onClick={onClone}
        >
          <span aria-hidden="true" className="aven-menu-icon">
            <ArrowDownCircle />
          </span>
          <span className="aven-menu-label">Clone from URL</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="aven-menu-item"
          onClick={onCreate}
        >
          <span aria-hidden="true" className="aven-menu-icon">
            <Folder />
          </span>
          <span className="aven-menu-label">Quick start new project</span>
        </button>
      </div>
    </Popover>
  );
}

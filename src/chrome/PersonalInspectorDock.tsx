import { useEffect, type CSSProperties } from "react";
import { useDragResize } from "../hooks/useDragResize";
import {
  WorkspaceInspector,
  type WorkspaceInspectorProps,
} from "./WorkspaceInspector";

type Props = WorkspaceInspectorProps & {
  width: number;
  onWidthChange: (width: number) => void;
};
export function PersonalInspectorDock({
  width,
  onWidthChange,
  ...props
}: Props) {
  const resize = useDragResize({
    enabled: props.active,
    min: 260,
    max: () => 380,
    direction: "left",
    defaultWidth: 280,
    initial: width,
    onCommit: onWidthChange,
  });
  useEffect(() => {
    if (!resize.dragging) return;
    document.body.dataset.personalResizing = "true";
    return () => {
      delete document.body.dataset.personalResizing;
    };
  }, [resize.dragging]);
  return (
    <div
      className="personal-inspector-slot"
      data-open={props.active}
      data-resizing={resize.dragging}
      aria-hidden={!props.active}
      inert={!props.active || undefined}
      style={{ "--inspector-width": `${resize.width}px` } as CSSProperties}
    >
      <aside ref={resize.setPaneRef} className="personal-inspector-dock">
        <div
          role="separator"
          aria-label="Resize file panel"
          aria-orientation="vertical"
          aria-valuemin={260}
          aria-valuemax={380}
          aria-valuenow={resize.width}
          tabIndex={props.active ? 0 : -1}
          className="personal-inspector-divider"
          onPointerDown={resize.onPointerDown}
          onDoubleClick={resize.onDoubleClick}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            resize.setWidth(
              resize.width + (event.key === "ArrowLeft" ? 20 : -20),
            );
          }}
        />
        <WorkspaceInspector {...props} />
      </aside>
    </div>
  );
}

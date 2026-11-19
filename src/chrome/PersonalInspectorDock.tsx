import {
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type TransitionEvent,
} from "react";
import { useDragResize } from "../hooks/useDragResize";
import { useSidePanelOpen } from "../hooks/useSidePanelOpen";
import { useSidePanelTab } from "../hooks/useSidePanelTab";
import { motionReduced } from "../lib/motion";
import {
  beginSidePanelOpen,
  endSidePanelOpen,
  setSidePanelTab,
} from "../lib/sidePanel";
import {
  WorkspaceInspector,
  type WorkspaceInspectorProps,
} from "./WorkspaceInspector";

type Props = Omit<WorkspaceInspectorProps, "active" | "tab" | "onTabChange"> & {
  /** The workspace is on screen; the panel shows while it is and is open. */
  workspaceVisible: boolean;
  width: number;
  onWidthChange: (width: number) => void;
};
export function PersonalInspectorDock({
  workspaceVisible,
  width,
  onWidthChange,
  ...rest
}: Props) {
  const open = useSidePanelOpen();
  const active = workspaceVisible && open;
  const tab = useSidePanelTab();
  const props: WorkspaceInspectorProps = {
    ...rest,
    active,
    tab,
    onTabChange: setSidePanelTab,
  };
  const shown = useRef(active);
  useLayoutEffect(() => {
    const opened = active && !shown.current;
    shown.current = active;
    // The reads the panel starts wait for its slide to end (sidePanel.ts).
    // Before paint, so its contents' first effects already see the slide.
    if (opened && !motionReduced()) beginSidePanelOpen();
    else if (!active) endSidePanelOpen();
    // Publish the panel's new width before paint: native browser pages
    // beside it can throttle WebKit's animation frames, so their resize
    // observers alone trail a toggle.
    window.dispatchEvent(new Event("supermono:workspace-layout"));
  }, [active]);
  useEffect(() => endSidePanelOpen, []);
  const onTransitionEnd = (event: TransitionEvent<HTMLElement>) => {
    if (event.target === event.currentTarget && active) endSidePanelOpen();
  };
  const resize = useDragResize({
    enabled: props.active,
    min: 260,
    max: () => Math.max(260, Math.min(380, window.innerWidth - 520)),
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
      <aside
        ref={resize.setPaneRef}
        className="personal-inspector-dock"
        onTransitionEnd={onTransitionEnd}
      >
        <div
          role="separator"
          aria-label="Resize side panel"
          aria-orientation="vertical"
          aria-valuemin={260}
          aria-valuemax={380}
          aria-valuenow={resize.width}
          tabIndex={props.active ? 0 : -1}
          className="personal-panel-resizer personal-inspector-divider"
          data-native-hit-margin=""
          data-resizing={resize.dragging || undefined}
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

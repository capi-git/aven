import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { useWorkspaceMenuPanel } from "../hooks/useWorkspaceMenuPanel";
import { useUsagePanelTheme } from "../lib/usagePanel";
import type { WorkspaceMenuPanelSnapshot } from "../lib/workspaceMenuPanel";
import { Popover, type PopoverAnchor } from "./Popover";
import type { PopoverAlign } from "../lib/popover";
import { WorkspaceMenuPanelContent } from "./WorkspaceMenuPanel";

export type ExplorerMenuItem =
  | { kind: "sep" }
  | {
      kind: "item";
      id: string;
      label: string;
      shortcut?: string;
      disabled?: boolean;
      danger?: boolean;
      checked?: boolean;
    };

type Props = {
  x: number;
  y: number;
  items: ExplorerMenuItem[];
  ariaLabel?: string;
  header?: ReactNode;
  width?: number;
  anchor?: PopoverAnchor;
  align?: PopoverAlign;
  gap?: number;
  native?: boolean;
  className?: string;
  onPick: (id: string) => void;
  onClose: () => void;
  onError?: () => void;
};

const MENU_WIDTH = 260;
type PanelAnchor =
  HTMLElement | { x: number; y: number; width: number; height: number };

function nativeAnchor({ anchor, x, y }: Props): PanelAnchor {
  if (anchor instanceof HTMLElement) return anchor;
  if (anchor && "current" in anchor && anchor.current) return anchor.current;
  if (anchor && "x" in anchor) {
    return {
      x: anchor.x,
      y: anchor.y,
      width: "width" in anchor ? anchor.width : 0,
      height: "height" in anchor ? anchor.height : 0,
    };
  }
  return { x, y, width: 0, height: 0 };
}

export function ExplorerMenu(props: Props) {
  const theme = useUsagePanelTheme(true);
  const {
    items,
    ariaLabel = "File actions",
    width = MENU_WIDTH,
    align = "start",
    gap = 0,
  } = props;
  const itemSignature = JSON.stringify(items);
  const snapshot = useMemo<WorkspaceMenuPanelSnapshot>(() => {
    let separatorBefore = false;
    const choices: WorkspaceMenuPanelSnapshot["items"] = [];
    const choicesForOpen = JSON.parse(itemSignature) as ExplorerMenuItem[];
    choicesForOpen.forEach((item, index) => {
      if (item.kind === "sep") {
        separatorBefore = choices.length > 0;
        return;
      }
      choices.push({
        // `close` belongs to the panel host. Domain IDs never cross that boundary.
        id: `menu-item-${index}`,
        label: item.label,
        shortcut: item.shortcut,
        checked: item.checked,
        disabled: item.disabled,
        danger: item.danger,
        separatorBefore,
      });
      separatorBefore = false;
    });
    return {
      title: ariaLabel,
      items: choices,
      theme,
      compact: true,
      width,
      align: align === "center" ? "start" : align,
      gap,
    };
  }, [itemSignature, ariaLabel, theme, width, align, gap]);
  const select = (id: string) => {
    const index = snapshot.items.findIndex((item) => item.id === id);
    const selected = snapshot.items[index];
    if (!selected || selected.disabled) return;
    const item = items[Number(id.slice("menu-item-".length))];
    if (item?.kind === "item" && !item.disabled) props.onPick(item.id);
  };
  // Native browser children require their own window, but the window's content
  // is still Aven's themed UI. Arbitrary React headers stay in the HTML surface.
  return props.native && isTauri() && !props.header ? (
    <NativeExplorerMenu {...props} snapshot={snapshot} onSelect={select} />
  ) : (
    <HtmlExplorerMenu {...props} snapshot={snapshot} onSelect={select} />
  );
}

type SurfaceProps = Props & {
  snapshot: WorkspaceMenuPanelSnapshot;
  onSelect: (id: string) => void;
};

function NativeExplorerMenu(props: SurfaceProps) {
  const anchor = useRef<PanelAnchor | null>(null);
  anchor.current = nativeAnchor(props);
  const close = useRef(props.onClose);
  close.current = props.onClose;
  useWorkspaceMenuPanel({
    open: true,
    anchor,
    snapshot: props.snapshot,
    onSelect: props.onSelect,
    onClose: props.onClose,
    // Never swap to an HTML overlay here: doing so occludes live Chromium and
    // causes the page to flash. Closing lets the user retry the owned panel.
    onError: () => {
      props.onError?.();
      props.onClose();
    },
  });
  useEffect(() => {
    const dismiss = () => close.current();
    const checkAnchor = () => {
      const target = anchor.current;
      if (target instanceof HTMLElement && !target.isConnected) dismiss();
    };
    checkAnchor();
    const observer = new MutationObserver(checkAnchor);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, []);
  return null;
}

function HtmlExplorerMenu({
  x,
  y,
  header,
  width = MENU_WIDTH,
  anchor,
  align,
  gap = 0,
  className = "",
  onClose,
  snapshot,
  onSelect,
}: SurfaceProps) {
  return (
    <Popover
      anchor={anchor ?? { x, y }}
      align={align}
      gap={gap}
      width={width}
      panel
      onDismiss={onClose}
      onContextMenu={(e) => e.preventDefault()}
      className={className}
    >
      <WorkspaceMenuPanelContent
        snapshot={snapshot}
        header={header}
        onSelect={onSelect}
        onClose={onClose}
      />
    </Popover>
  );
}

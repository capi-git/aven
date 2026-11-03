import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
      description?: string;
      shortcut?: string;
      disabled?: boolean;
      danger?: boolean;
      checked?: boolean;
    };

type Props = {
  x: number;
  y: number;
  items: ExplorerMenuItem[];
  /**
   * Rarer choices, one page in. A row whose id is `page:<name>` opens
   * `pages[name]` in the same menu, under a Back row.
   */
  pages?: Record<string, ExplorerMenuItem[]>;
  ariaLabel?: string;
  header?: ReactNode;
  width?: number;
  anchor?: PopoverAnchor;
  align?: PopoverAlign;
  gap?: number;
  native?: boolean;
  searchable?: boolean;
  className?: string;
  onPick: (id: string) => void;
  onClose: () => void;
  onError?: () => void;
};

const MENU_WIDTH = 232;
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

/** A row that opens a page of `pages`, ending in the submenu chevron. */
export function menuPage(page: string, label: string): ExplorerMenuItem {
  return { kind: "item", id: `page:${page}`, label, shortcut: "›" };
}

/** A page's rows, or the only row inline when a page would be overkill. */
export function pageOrInline(
  page: string,
  label: string,
  rows: ExplorerMenuItem[],
): ExplorerMenuItem[] {
  const choices = rows.filter((row) => row.kind === "item");
  if (choices.length === 0) return [];
  return choices.length === 1 ? choices : [menuPage(page, label)];
}

export function ExplorerMenu(given: Props) {
  const theme = useUsagePanelTheme(true);
  const [page, setPage] = useState<string | null>(null);
  // Selecting a page's row must not close the menu showing it.
  const pageSwitch = useRef(false);
  const pageClass = `explorer-menu-${useId().replace(/[^\w-]/g, "")}`;
  // Same as the tab menu: the page replaces the rows of the open menu, and
  // focus returns to its first row rather than to what opened the menu.
  useLayoutEffect(() => {
    if (!pageSwitch.current) return;
    pageSwitch.current = false;
    const rows = document.querySelector<HTMLElement>(
      `.${pageClass} [role="menu"]`,
    );
    if (!rows) return;
    rows.scrollTop = 0;
    (rows.querySelector<HTMLElement>("button:not(:disabled)") ?? rows).focus({
      preventScroll: true,
    });
  }, [page, pageClass]);
  const pageRows = page ? given.pages?.[page] : undefined;
  const props: Props = {
    ...given,
    items: pageRows
      ? [
          { kind: "item", id: "page:", label: "‹ Back" },
          { kind: "sep" },
          ...pageRows,
        ]
      : given.items,
    className: `${pageClass} ${given.className ?? ""}`,
    onClose: () => {
      if (!pageSwitch.current) given.onClose();
    },
  };
  const {
    items,
    ariaLabel = "File actions",
    width = MENU_WIDTH,
    align = "start",
    gap = 0,
    searchable,
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
        description: item.description,
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
      ...(searchable ? { searchable: true } : {}),
      width,
      align: align === "center" ? "start" : align,
      gap,
    };
  }, [itemSignature, ariaLabel, theme, width, align, gap, searchable]);
  const select = (id: string) => {
    const index = snapshot.items.findIndex((item) => item.id === id);
    const selected = snapshot.items[index];
    if (!selected || selected.disabled) return;
    const item = items[Number(id.slice("menu-item-".length))];
    if (item?.kind !== "item" || item.disabled) return;
    if (given.pages && item.id.startsWith("page:")) {
      pageSwitch.current = true;
      setPage(item.id.slice("page:".length) || null);
      return;
    }
    props.onPick(item.id);
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
  const focusAnchor = () => {
    const element =
      anchor instanceof HTMLElement
        ? anchor
        : anchor && "current" in anchor
          ? anchor.current
          : null;
    if (element?.isConnected) element.focus({ preventScroll: true });
  };
  return (
    <Popover
      autoFocus
      initialFocus='input:not(:disabled), button:not(:disabled), [role="menu"]'
      tabIndex={-1}
      anchor={anchor ?? { x, y }}
      align={align}
      gap={gap}
      width={width}
      panel
      onDismiss={(reason) => {
        if (reason === "escape") focusAnchor();
        onClose();
      }}
      onContextMenu={(e) => e.preventDefault()}
      className={className}
    >
      <WorkspaceMenuPanelContent
        snapshot={snapshot}
        header={header}
        onSelect={(id) => {
          focusAnchor();
          onSelect(id);
        }}
        onClose={() => {
          focusAnchor();
          onClose();
        }}
      />
    </Popover>
  );
}

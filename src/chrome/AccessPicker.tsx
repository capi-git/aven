import { ChevronDown, Lock } from "./icons";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  RUNTIME_MODE_HINT,
  RUNTIME_MODE_LABEL,
  RUNTIME_MODES,
  type RuntimeMode,
} from "../lib/session";
import { Popover } from "./Popover";
import { AccessPanelContent, ACCESS_ICONS } from "./AccessPanel";
import {
  nativeAccessPanel,
  type AccessPanelSnapshot,
} from "../lib/accessPanel";
import { useUsagePanelTheme } from "../lib/usagePanel";

type Props = {
  value: RuntimeMode;
  onChange: (mode: RuntimeMode) => void;
  onClose?: () => void;
  busy?: boolean;
  triggerIcon?: typeof Lock;
  compact?: boolean;
  side?: "top" | "bottom";
  /** Render in an app-owned popup above embedded browser views. */
  native?: boolean;
};

export function AccessPicker({
  value,
  onChange,
  onClose,
  busy = false,
  triggerIcon,
  compact = false,
  side = "top",
  native = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const Icon = triggerIcon ?? ACCESS_ICONS[value];
  const usePanel = native && nativeAccessPanel.supported();
  const theme = useUsagePanelTheme(open);
  const snapshot = useMemo<AccessPanelSnapshot>(
    () => ({ value, busy, theme }),
    [value, busy, theme],
  );
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const panelLabel = useRef<string | null>(null);
  const operations = useRef(Promise.resolve());
  const restoreFocus = () => {
    if (onCloseRef.current) onCloseRef.current();
    else root.current?.querySelector("button")?.focus({ preventScroll: true });
  };
  const dismiss = (restore: boolean) => {
    setOpen(false);
    if (restore) restoreFocus();
  };

  useEffect(() => {
    if (!usePanel || !open) return;
    const anchor = root.current?.querySelector("button");
    if (!anchor) return;
    let cancelled = false;
    let finished = false;
    let label: string | null = null;
    type PanelEvent = { label: string; action?: string };
    const pending: PanelEvent[] = [];
    const stops: (() => void)[] = [];
    const receive = (event: PanelEvent) => {
      if (cancelled || finished) return;
      if (!label) {
        pending.push(event);
        return;
      }
      if (event.label !== label) return;
      if (event.action !== undefined) {
        const mode = RUNTIME_MODES.find((mode) => mode === event.action);
        if (!mode) return;
        onChangeRef.current(mode);
        restoreFocus();
      }
      finished = true;
      panelLabel.current = null;
      setOpen(false);
    };
    const subscribe = async (event: string) => {
      const stop = await nativeAccessPanel.listen<PanelEvent>(event, receive);
      if (cancelled) stop();
      else stops.push(stop);
    };
    const start = async () => {
      if (cancelled) return;
      await subscribe("access-panel-action");
      if (cancelled) return;
      await subscribe("access-panel-closed");
      if (cancelled) return;
      label = await nativeAccessPanel.open(anchor, snapshotRef.current);
      if (cancelled) return;
      panelLabel.current = label;
      pending.splice(0).forEach(receive);
      if (!finished) await nativeAccessPanel.update(snapshotRef.current);
    };
    operations.current = operations.current
      .catch(() => {})
      .then(start)
      .catch(() => {
        stops.splice(0).forEach((stop) => stop());
        if (!cancelled) {
          setError("Could not open access options. Try again.");
          setOpen(false);
        }
      });
    return () => {
      cancelled = true;
      stops.splice(0).forEach((stop) => stop());
      // A late opening is closed before a replacement can open.
      operations.current = operations.current
        .catch(() => {})
        .then(async () => {
          panelLabel.current = null;
          await nativeAccessPanel.close();
        })
        .catch(() => {});
    };
  }, [open, usePanel]);

  useEffect(() => {
    if (usePanel && open && panelLabel.current)
      void nativeAccessPanel.update(snapshot).catch(() => {});
  }, [snapshot, open, usePanel]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        title={
          busy
            ? `${RUNTIME_MODE_LABEL[value]} applies to the next turn. The current turn keeps its starting access.`
            : `${RUNTIME_MODE_LABEL[value]}: ${RUNTIME_MODE_HINT[value]}`
        }
        aria-label={`${RUNTIME_MODE_LABEL[value]}${busy ? " · next turn" : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-access-trigger
        data-mode={value}
        data-compact={compact || undefined}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          setError(null);
          if (open) dismiss(true);
          else setOpen(true);
        }}
        className={`flex h-6.5 max-w-52 items-center gap-1 rounded-md px-1.5 ${open ? "bg-content/10 text-content" : "bg-content/10 text-content hover:bg-content/15"}`}
      >
        <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
        <span className={compact ? "sr-only" : "min-w-0 truncate text-[11px]"}>
          {RUNTIME_MODE_LABEL[value]}
          {busy ? " · next turn" : ""}
        </span>
        {compact ? (
          busy ? (
            <span className="text-[10px]">next turn</span>
          ) : null
        ) : (
          <ChevronDown
            className={`size-3 shrink-0 text-content/50 ${open ? "rotate-180" : ""}`}
            strokeWidth={1.75}
          />
        )}
      </button>
      {error ? (
        <span role="status" className="text-[11px] text-content/70">
          {error}
        </span>
      ) : null}
      {open && !usePanel ? (
        <Popover
          anchor={root}
          side={side}
          width={340}
          onDismiss={(reason) => dismiss(reason === "escape")}
        >
          <AccessPanelContent
            snapshot={snapshot}
            onSelect={(mode) => {
              onChange(mode);
              dismiss(true);
            }}
            onClose={() => dismiss(true)}
          />
        </Popover>
      ) : null}
    </div>
  );
}

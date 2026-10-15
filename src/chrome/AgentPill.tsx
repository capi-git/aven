import { memo, useMemo, useRef, useState } from "react";
import {
  HARNESS_TITLE,
  RUNTIME_MODE_HINT,
  type HarnessId,
  type RuntimeMode,
} from "../lib/session";
import { MOD } from "../lib/platform";
import { AccessModeOptions } from "./AccessPanel";
import { HarnessIcon } from "./HarnessIcon";
import { ChevronDown, LockOpen, Zap } from "./icons";
import {
  MODEL_SEARCH_FIELD,
  ModelChooser,
  useCurrentModel,
  useModelPickerHotkey,
} from "./ModelPicker";
import {
  ModelSettingsSections,
  modelSettingsSummary,
  useModelSettingList,
} from "./ModelSettings";
import { PanelSection } from "./PanelSection";
import { Popover } from "./Popover";
import { RaceOptions, type RaceProps } from "./RaceOptions";
import "./AgentPill.css";

type Props = {
  harness: HarnessId;
  model: string;
  modelSettings: Record<string, string>;
  runtimeMode: RuntimeMode;
  /** Access is offered only where the provider supports it. */
  showAccess: boolean;
  busy: boolean;
  /** Cmd+. and the menu command open this pill's panel. */
  hotkeys: boolean;
  /** Absent where the chat can't race. */
  race?: RaceProps;
  onModelChange: (harness: HarnessId, model: string) => void;
  onModelSettingsChange?: (settings: Record<string, string>) => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
  /** Hands focus back to the message field. */
  onClose?: () => void;
};

const PANEL_WIDTH = 540;
const MODELS_ONLY_WIDTH = 300;
const PANEL_MIN_HEIGHT = 260;
const PANEL_MAX_HEIGHT = 440;

/**
 * The composer's one control for who answers and how: the provider mark, the
 * model and its effort. It opens a single panel with the model list, the
 * model's settings, access and Race. Full access stays visible on the pill.
 *
 * Memoized with stable props, so typing in the composer never renders it.
 */
export const AgentPill = memo(function AgentPill({
  harness,
  model,
  modelSettings,
  runtimeMode,
  showAccess,
  busy,
  hotkeys,
  race,
  onModelChange,
  onModelSettingsChange,
  onRuntimeModeChange,
  onClose,
}: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const current = useCurrentModel(harness, model);
  const settings = useModelSettingList(harness, model);
  const summary = useMemo(
    () => modelSettingsSummary(settings, modelSettings),
    [settings, modelSettings],
  );
  const fullAccess = showAccess && runtimeMode === "full-access";

  const dismiss = (restore: boolean) => {
    setOpen(false);
    if (restore) onCloseRef.current?.();
  };
  const toggle = () => {
    if (open) dismiss(true);
    else setOpen(true);
  };
  useModelPickerHotkey(hotkeys, open, toggle);

  const description = [
    `${HARNESS_TITLE[current.harness]} ${current.name}`,
    summary.effort,
    summary.fast ? "Fast" : null,
    fullAccess ? "Full access" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const hasSide = settings.length > 0 || showAccess || Boolean(race);

  return (
    <div ref={root} className="relative min-w-0">
      <button
        type="button"
        data-agent-pill
        aria-label={description}
        aria-keyshortcuts={`${MOD}.`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={`${description} (${MOD}.)`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={toggle}
        className="agent-pill model-control"
      >
        <HarnessIcon harness={current.harness} className="agent-pill-mark" />
        <span key={current.id} className="agent-pill-model model-control-value">
          {current.name}
        </span>
        {summary.effort ? (
          <>
            <span className="agent-pill-separator" aria-hidden="true">
              ·
            </span>
            <span
              key={summary.effort}
              className="agent-pill-effort model-control-value"
            >
              {summary.effort}
            </span>
          </>
        ) : null}
        {summary.fast ? (
          <Zap className="agent-pill-fast" strokeWidth={2} aria-hidden />
        ) : null}
        {fullAccess ? (
          <span
            className="agent-pill-access"
            data-mode="full-access"
            title="Full access"
          >
            <LockOpen className="size-3" strokeWidth={2} aria-hidden />
          </span>
        ) : null}
        <ChevronDown
          className="agent-pill-chevron model-control-chevron"
          strokeWidth={1.75}
        />
      </button>
      {open ? (
        <Popover
          anchor={root}
          side="top"
          align="end"
          width={hasSide ? PANEL_WIDTH : MODELS_ONLY_WIDTH}
          minHeight={PANEL_MIN_HEIGHT}
          maxHeight={PANEL_MAX_HEIGHT}
          autoFocus
          initialFocus={MODEL_SEARCH_FIELD}
          onDismiss={(reason) => dismiss(reason === "escape")}
          role="dialog"
          aria-label="Agent options"
          data-model-picker
          data-agent-panel
          className="agent-panel"
        >
          <div className="agent-panel-body">
            <section aria-label="Model" className="agent-panel-models">
              <ModelChooser
                harness={harness}
                model={model}
                onPick={(nextHarness, nextModel) => {
                  onModelChange(nextHarness, nextModel);
                  dismiss(true);
                }}
              />
            </section>
            {hasSide ? (
              <div className="agent-panel-side">
                <ModelSettingsSections
                  harness={harness}
                  model={model}
                  values={modelSettings}
                  onChange={(next) => onModelSettingsChange?.(next)}
                />
                {showAccess ? (
                  <PanelSection
                    title="Access"
                    note={
                      busy
                        ? "Applies from the next turn."
                        : RUNTIME_MODE_HINT[runtimeMode]
                    }
                    data-access-options
                  >
                    <AccessModeOptions
                      value={runtimeMode}
                      onSelect={onRuntimeModeChange}
                      compact
                    />
                  </PanelSection>
                ) : null}
                {race ? <RaceOptions {...race} /> : null}
              </div>
            ) : null}
          </div>
        </Popover>
      ) : null}
    </div>
  );
});

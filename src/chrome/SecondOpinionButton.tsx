import {
  Check,
  ChevronDown,
  ChevronRight,
  MessageMultiple,
  Replace,
  type IconComponent,
} from "./icons";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  getHarnessAvailabilitySnapshot,
  hasProbedHarnessAvailability,
  isHarnessAvailable,
  probeHarnessAvailability,
  subscribeHarnessAvailability,
} from "../lib/harness/availability";
import { refreshHarnessCatalogs } from "../lib/harness/registry";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import {
  getModelSnapshot,
  getPickerVisibilitySnapshot,
  hasLiveCatalog,
  isPickerProviderVisible,
  pickerModelsFor,
  findModel,
  isPickerModelVisible,
  preferredModelId,
  subscribeModels,
  subscribePickerVisibility,
} from "../lib/models";
import { LAYER } from "../lib/layers";
import { secondOpinionTargets } from "../lib/secondOpinion";
import { HARNESS_TITLE, type HarnessId } from "../lib/session";
import { HarnessIcon } from "./HarnessIcon";
import "./Menu.css";
import { Popover } from "./Popover";

type Props = {
  from: HarnessId;
  fromModel?: string;
  onPick: (harness: HarnessId, model: string) => void;
  icon?: IconComponent;
  /** The trigger's name, as screen readers announce it. */
  title?: string;
  /** What the trigger does, on hover; defaults to its name. */
  hint?: string;
  disabledTitle?: string;
  description?: string;
  menuLabel?: string;
  includeCurrent?: boolean;
  /**
   * Display name of the model that wrote this turn. It is hidden from its own
   * provider's list, so a same-provider second opinion always comes from a
   * different model (MonoCode 90c5a655).
   */
  excludeModelName?: string;
  disabled?: boolean;
  triggerClassName?: string;
  /** Visible text after the trigger's icon, for a labelled row. */
  label?: ReactNode;
};

const MENU_WIDTH = 240;
const SUBMENU_WIDTH = 240;
const SUBMENU_MAX_HEIGHT = 288;
/** The flyout tucks under the parent menu's edge rather than floating free. */
const SUBMENU_OVERLAP = -4;
/** Neither menu is inside the other, so a click in one is not a click away. */
const SELF = "[data-provider-target]";

export function HandoffButton({
  from,
  onPick,
}: Pick<Props, "from" | "onPick">) {
  return (
    <SecondOpinionButton
      from={from}
      onPick={onPick}
      icon={Replace}
      title="Handoff"
      hint="Continue this chat with another AI"
      disabledTitle="Enable another installed provider in Settings to hand off"
      description="Another AI picks up this chat's work in a new chat."
      menuLabel="Hand this chat to another AI"
    />
  );
}

export function BuildTargetButton({
  from,
  model,
  disabled,
  onPick,
}: {
  from: HarnessId;
  model?: string;
  disabled?: boolean;
  onPick: (harness: HarnessId, model: string) => void;
}) {
  return (
    <SecondOpinionButton
      from={from}
      fromModel={model}
      onPick={onPick}
      icon={ChevronDown}
      title="Build with another model"
      disabledTitle="No build providers are available"
      description="Choose the model and provider that should build this plan."
      menuLabel="Build this plan with another model or provider"
      includeCurrent
      disabled={disabled}
      triggerClassName="flex h-6 w-6 shrink-0 items-center justify-center rounded-r-md border-l border-background-base/20 bg-content text-background-base hover:bg-(--aven-inverse-hover) disabled:pointer-events-none disabled:opacity-40"
    />
  );
}

export function SecondOpinionButton({
  from,
  fromModel,
  onPick,
  icon: Icon = MessageMultiple,
  title = "Second opinion",
  hint,
  disabledTitle = "No different model available for a second opinion",
  description = "Another AI checks this reply's work and fixes what's wrong.",
  menuLabel = "Ask another AI to check this reply",
  includeCurrent = false,
  excludeModelName,
  disabled: disabledByCaller = false,
  triggerClassName,
  label: triggerLabel,
}: Props) {
  const availabilityVersion = useSyncExternalStore(
    subscribeHarnessAvailability,
    getHarnessAvailabilitySnapshot,
    getHarnessAvailabilitySnapshot,
  );
  const visibilityVersion = useSyncExternalStore(
    subscribePickerVisibility,
    getPickerVisibilitySnapshot,
    getPickerVisibilitySnapshot,
  );
  const catalogVersion = useSyncExternalStore(
    subscribeModels,
    getModelSnapshot,
    getModelSnapshot,
  );
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [modelActive, setModelActive] = useState(0);
  const [inSubmenu, setInSubmenu] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const [activeRow, setActiveRow] = useState<HTMLButtonElement | null>(null);
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();

  const probed = hasProbedHarnessAvailability();
  const targets = useMemo(() => {
    void availabilityVersion;
    void visibilityVersion;
    return secondOpinionTargets(from, {
      installed: isHarnessAvailable,
      visible: isPickerProviderVisible,
      probed,
      includeCurrent,
    });
  }, [from, includeCurrent, probed, availabilityVersion, visibilityVersion]);

  // The model that answered is not a second opinion on itself.
  const modelsOf = (harness: HarnessId) => {
    const list = pickerModelsFor(harness);
    return excludeModelName && harness === from
      ? list.filter((model) => model.name !== excludeModelName)
      : list;
  };
  const activeHarness = targets[active];
  const models = useMemo(() => {
    void catalogVersion;
    void visibilityVersion;
    if (!activeHarness) return [];
    const list = pickerModelsFor(activeHarness);
    return excludeModelName && activeHarness === from
      ? list.filter((model) => model.name !== excludeModelName)
      : list;
  }, [
    activeHarness,
    catalogVersion,
    visibilityVersion,
    from,
    excludeModelName,
  ]);
  const currentModel = fromModel ? findModel(fromModel) : undefined;
  const useCurrentModel =
    currentModel != null && isPickerModelVisible(currentModel);
  const preferredFor = (harness: HarnessId): string | undefined => {
    if (harness === from && useCurrentModel && fromModel) return fromModel;
    const preferredId = preferredModelId(harness);
    if (!excludeModelName || harness !== from) return preferredId;
    const list = modelsOf(harness);
    return list.some((model) => model.id === preferredId)
      ? preferredId
      : list[0]?.id;
  };
  const preferred =
    activeHarness != null ? preferredFor(activeHarness) : undefined;

  useEffect(() => {
    if (!open) return;
    void probeHarnessAvailability();
  }, [open]);

  useEffect(() => {
    if (!open || !activeHarness) return;
    void refreshHarnessCatalogs([activeHarness]);
  }, [open, activeHarness]);

  useEffect(() => {
    setActive(0);
    setInSubmenu(false);
  }, [open, targets.join(",")]);

  useEffect(() => {
    if (!activeHarness) {
      setModelActive(0);
      return;
    }
    const index = models.findIndex((model) => model.id === preferred);
    setModelActive(index >= 0 ? index : 0);
  }, [activeHarness, preferred, models]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, [open]);

  const dismiss = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) button.current?.focus();
  };

  // With the answering model hidden, a provider only counts if it still has a
  // model to offer. One whose live catalog has not loaded yet cannot be
  // confirmed empty, so it keeps the button enabled until the menu loads it.
  const hasSelectableModel =
    !excludeModelName ||
    targets.some(
      (harness) => !hasLiveCatalog(harness) || modelsOf(harness).length > 0,
    );
  const noTargets = targets.length === 0 || !hasSelectableModel;
  const disabled = disabledByCaller || noTargets;
  const label = noTargets ? disabledTitle : title;

  const pick = (harness: HarnessId, model: string) => {
    const choice = findModel(model);
    if (
      !isPickerProviderVisible(harness) ||
      (choice && !isPickerModelVisible(choice))
    )
      return;
    setOpen(false);
    onPick(harness, model);
  };

  const pickPreferred = (harness: HarnessId) => {
    const model = preferredFor(harness);
    if (model) pick(harness, model);
  };

  const moveHarness = (dir: 1 | -1) => {
    if (targets.length === 0) return;
    setInSubmenu(false);
    setActive((index) => (index + dir + targets.length) % targets.length);
  };

  const moveModel = (dir: 1 | -1) => {
    if (models.length === 0) return;
    setModelActive((index) => (index + dir + models.length) % models.length);
  };

  const onMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (inSubmenu) moveModel(1);
      else moveHarness(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (inSubmenu) moveModel(-1);
      else moveHarness(-1);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (!inSubmenu && models.length > 0) setInSubmenu(true);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setInSubmenu(false);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (!activeHarness) return;
      if (inSubmenu) {
        const model = models[modelActive];
        if (model) pick(activeHarness, model.id);
        return;
      }
      pickPreferred(activeHarness);
    }
  };

  const showSubmenu =
    open &&
    inSubmenu &&
    activeRow != null &&
    activeRow.dataset.providerIndex === String(active) &&
    activeHarness != null &&
    models.length > 0;

  return (
    <>
      <button
        ref={button}
        type="button"
        title={noTargets ? label : (hint ?? label)}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        className={
          triggerClassName ??
          `rounded-md p-1 disabled:pointer-events-none disabled:opacity-40 ${
            open
              ? "bg-content/8 text-content/70"
              : "text-content/40 hover:bg-content/8 hover:text-content/70"
          }`
        }
        onClick={() => {
          if (disabled) return;
          setOpen((value) => !value);
        }}
      >
        <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
        {triggerLabel}
      </button>
      {open ? (
        <>
          <Popover
            anchor={button}
            side="top"
            align="center"
            width={MENU_WIDTH}
            autoFocus
            ignore={SELF}
            onDismiss={(reason) => dismiss(reason === "escape")}
            role="menu"
            tabIndex={-1}
            aria-label={menuLabel}
            onKeyDown={onMenuKey}
            data-provider-target
            className="aven-menu font-sans"
          >
            <p className="aven-menu-note aven-menu-description text-balance">
              {description}
            </p>
            <div role="separator" className="aven-menu-separator" />
            {targets.length === 0 ? (
              <div className="aven-menu-note">{disabledTitle}</div>
            ) : (
              targets.map((harness, index) => {
                const highlighted = index === active;
                const available = isHarnessAvailable(harness);
                return (
                  <button
                    key={harness}
                    ref={highlighted ? setActiveRow : undefined}
                    data-provider-index={index}
                    type="button"
                    role="menuitem"
                    aria-haspopup={
                      modelsOf(harness).length > 0 ? "menu" : undefined
                    }
                    aria-expanded={highlighted && showSubmenu}
                    disabled={!available && probed}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => {
                      setActive(index);
                      setInSubmenu(true);
                    }}
                    onClick={() => {
                      if (!available && probed) return;
                      pickPreferred(harness);
                    }}
                    data-active={highlighted && !(!available && probed)}
                    className="aven-menu-item"
                  >
                    <span aria-hidden="true" className="aven-menu-icon">
                      <HarnessIcon harness={harness} className="size-3.5" />
                    </span>
                    <span className="aven-menu-label">
                      {HARNESS_TITLE[harness]}
                    </span>
                    {modelsOf(harness).length > 0 ? (
                      <ChevronRight
                        aria-hidden="true"
                        className="aven-menu-chevron"
                        strokeWidth={1.75}
                      />
                    ) : null}
                  </button>
                );
              })
            )}
          </Popover>
          {showSubmenu ? (
            <Popover
              // Remounting per row re-measures the flyout against that row.
              key={active}
              ref={lockOverscroll}
              anchor={activeRow}
              side="right"
              gap={SUBMENU_OVERLAP}
              width={SUBMENU_WIDTH}
              maxHeight={SUBMENU_MAX_HEIGHT}
              layer={LAYER.submenu}
              role="menu"
              aria-label={`${HARNESS_TITLE[activeHarness]} models`}
              onMouseEnter={() => setInSubmenu(true)}
              data-provider-target
              className="aven-menu overflow-y-auto overscroll-none"
            >
              {models.map((model, index) => {
                const highlighted = index === modelActive;
                return (
                  <button
                    key={model.id}
                    type="button"
                    role="menuitem"
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => {
                      setInSubmenu(true);
                      setModelActive(index);
                    }}
                    onClick={() => pick(activeHarness, model.id)}
                    data-active={highlighted}
                    className="aven-menu-item"
                  >
                    <span className="aven-menu-label">{model.name}</span>
                    {model.id === preferred ? (
                      <Check aria-hidden="true" className="aven-menu-check" />
                    ) : null}
                  </button>
                );
              })}
            </Popover>
          ) : null}
        </>
      ) : null}
    </>
  );
}

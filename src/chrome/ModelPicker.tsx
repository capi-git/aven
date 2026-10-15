import { harnessDescriptor } from "../lib/harness/descriptors";
import { ChevronDown, Search, Star } from "./icons";
import "./ModelControls.css";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  coerceModelPickerTab,
  findPickerModel,
  getModelSnapshot,
  getPickerVisibilitySnapshot,
  loadFavoriteModels,
  loadModelPickerTab,
  pickerModelsFor,
  isPickerModelVisible,
  resolveModel,
  saveFavoriteModels,
  saveModelPickerTab,
  showProviderInModelPicker,
  stepModelPickerTab,
  subscribeModels,
  subscribePickerVisibility,
  type AgentModel,
  type ModelPickerTab,
} from "../lib/models";
import {
  harnessUnavailableHint,
  hasProbedHarnessAvailability,
  isHarnessAvailable,
  probeHarnessAvailability,
  subscribeHarnessAvailability,
  getHarnessAvailabilitySnapshot,
} from "../lib/harness/availability";
import { refreshHarnessCatalogs } from "../lib/harness/registry";
import { isImeComposition } from "../lib/keyboard";
import {
  HARNESSES,
  HARNESS_LABEL,
  HARNESS_TITLE,
  type HarnessId,
} from "../lib/session";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { HarnessIcon } from "./HarnessIcon";
import { Popover } from "./Popover";
import { MOD } from "../lib/platform";

type Props = {
  harness: HarnessId;
  model: string;
  hotkeys?: boolean;
  onChange: (harness: HarnessId, model: string) => void;
  onClose?: () => void;
};

const MENU_WIDTH = 300;
const MENU_MIN_HEIGHT = 180;
const MENU_MAX_HEIGHT = 340;
/** The field a model picker focuses once it is on screen. */
export const MODEL_SEARCH_FIELD = 'input[aria-label="Search models"]';

/**
 * Cmd+. and the menu bar's model picker command toggle a picker. Only the
 * focused pane's composer passes `enabled`; while the picker is closed, the
 * shortcut leaves other open pickers and the terminal alone.
 */
export function useModelPickerHotkey(
  enabled: boolean,
  open: boolean,
  toggle: () => void,
) {
  const openRef = useRef(open);
  openRef.current = open;
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  useEffect(() => {
    if (!enabled) return;
    let lastHotkey = 0;
    const toggleOnce = () => {
      // The menu command and the key event can both arrive for one press.
      const now = performance.now();
      if (now - lastHotkey < 80) return;
      lastHotkey = now;
      toggleRef.current();
    };
    const inBlockingUi = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      if (target.closest(".aven-terminal")) return true;
      return Boolean(
        target.closest(
          "[data-file-picker], [data-branch-picker], [data-skill-picker], [data-mention-picker], [data-access-picker]",
        ),
      );
    };
    const onKey = (e: KeyboardEvent) => {
      if (isImeComposition(e)) return;
      if (
        !(e.metaKey || e.ctrlKey) ||
        e.altKey ||
        e.shiftKey ||
        (e.key !== "." && e.code !== "Period")
      )
        return;
      if (!openRef.current && inBlockingUi(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      toggleOnce();
    };
    const onMenu = () => {
      if (inBlockingUi(document.activeElement)) return;
      toggleOnce();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("open_model_picker", onMenu);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("open_model_picker", onMenu);
    };
  }, [enabled]);
}

/** The model's display name, kept current as provider catalogs load. */
export function useCurrentModel(harness: HarnessId, model: string) {
  const catalogVersion = useSyncExternalStore(
    subscribeModels,
    getModelSnapshot,
    getModelSnapshot,
  );
  return useMemo(() => {
    // The snapshot marks a catalog change that can rename the model.
    void catalogVersion;
    return resolveModel(harness, model);
  }, [harness, model, catalogVersion]);
}

export function ModelPicker({
  harness,
  model,
  hotkeys = false,
  onChange,
  onClose,
}: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const current = useCurrentModel(harness, model);

  const dismiss = (restore: boolean) => {
    setOpen(false);
    if (restore) onCloseRef.current?.();
  };
  useModelPickerHotkey(hotkeys, open, () => {
    if (open) dismiss(true);
    else setOpen(true);
  });

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        title={`${HARNESS_TITLE[current.harness]} · ${current.name} (${MOD}.)`}
        aria-label={`${HARNESS_TITLE[current.harness]} ${current.name}`}
        aria-keyshortcuts={`${MOD}.`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (open) {
            dismiss(true);
            return;
          }
          setOpen(true);
        }}
        className={`model-control flex h-6.5 max-w-52 items-center gap-1 rounded-md px-1.5 ${
          open
            ? "bg-content/10 text-content"
            : "bg-content/10 text-content hover:bg-content/15"
        }`}
      >
        <HarnessIcon harness={current.harness} className="size-4 shrink-0" />
        <span
          key={current.id}
          className="model-control-value min-w-0 truncate text-ui-caption"
        >
          {current.name}
        </span>
        <ChevronDown
          className={`model-control-chevron size-3 shrink-0 text-content/50 ${open ? "rotate-180" : ""}`}
          strokeWidth={1.75}
        />
      </button>
      {open ? (
        <Popover
          anchor={root}
          side="top"
          width={MENU_WIDTH}
          minHeight={MENU_MIN_HEIGHT}
          maxHeight={MENU_MAX_HEIGHT}
          autoFocus
          initialFocus={MODEL_SEARCH_FIELD}
          onDismiss={(reason) => dismiss(reason === "escape")}
          role="dialog"
          aria-label="Model picker"
          data-model-picker
          className="flex flex-col overflow-hidden"
        >
          <ModelChooser
            harness={harness}
            model={model}
            onPick={(nextHarness, nextModel) => {
              onChange(nextHarness, nextModel);
              dismiss(true);
            }}
          />
        </Popover>
      ) : null}
    </div>
  );
}

/**
 * The provider tabs, search field and model list. Mounted only while a
 * picker is open: it settles the remembered tab and highlights the current
 * model in its first frame. Arrow keys in the field move the highlight and
 * Left/Right switch provider; Enter or Cmd+1-9 picks.
 */
export function ModelChooser({
  harness,
  model,
  onPick,
  className = "",
}: {
  harness: HarnessId;
  model: string;
  onPick: (harness: HarnessId, model: string) => void;
  className?: string;
}) {
  const catalogVersion = useSyncExternalStore(
    subscribeModels,
    getModelSnapshot,
    getModelSnapshot,
  );
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
  const shownInPicker = (id: HarnessId) =>
    showProviderInModelPicker(
      id,
      isHarnessAvailable(id),
      hasProbedHarnessAvailability(),
    );
  // Read when the picker opens, so it shows the provider last chosen anywhere.
  const [tab, setTab] = useState<ModelPickerTab>(() =>
    coerceModelPickerTab(loadModelPickerTab(), shownInPicker),
  );
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [favorites, setFavorites] = useState(loadFavoriteModels);
  const current = resolveModel(harness, model);

  const pickerHarnesses = HARNESSES.filter(shownInPicker);
  const visibleTab = coerceModelPickerTab(tab, shownInPicker);
  if (visibleTab !== tab) {
    setTab(visibleTab);
  }

  const selectTab = (next: ModelPickerTab) => {
    setTab(next);
    saveModelPickerTab(next);
  };

  useEffect(() => {
    void probeHarnessAvailability();
  }, []);

  useEffect(() => {
    if (visibleTab === "favorites") return;
    void refreshHarnessCatalogs([visibleTab]);
  }, [visibleTab]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const pool =
      visibleTab === "favorites"
        ? favorites
            .map((id) => findPickerModel(id))
            .filter(
              (item): item is AgentModel =>
                item != null &&
                shownInPicker(item.harness) &&
                isPickerModelVisible(item),
            )
            .filter(
              (item, index, list) =>
                list.findIndex((other) => other.id === item.id) === index,
            )
        : pickerModelsFor(visibleTab);
    if (!needle) return pool;
    return pool.filter((item) => {
      const hay =
        `${item.name} ${HARNESS_TITLE[item.harness]} ${HARNESS_LABEL[item.harness]}`.toLowerCase();
      return hay.includes(needle);
    });
    // Catalog, install probes, and picker-visibility all feed this list:
    // catalogs land after mount, and hiding a provider must drop its favorites.
  }, [
    visibleTab,
    query,
    favorites,
    catalogVersion,
    availabilityVersion,
    visibilityVersion,
  ]);

  // Opening, switching tab or searching highlights the current model. This
  // is derived while rendering, not in an effect after paint, so the first
  // frame is final. A catalog that lands later only clamps the highlight.
  const activeFor = `${visibleTab}\n${query}\n${current.id}`;
  const [activeKey, setActiveKey] = useState("");
  if (activeKey !== activeFor) {
    setActiveKey(activeFor);
    const index = visible.findIndex((item) => item.id === current.id);
    setActive(index >= 0 ? index : 0);
  }
  const activeRow =
    visible.length === 0 ? 0 : Math.min(active, visible.length - 1);

  const pick = (item: AgentModel) => {
    if (!isHarnessAvailable(item.harness) || !isPickerModelVisible(item))
      return;
    onPick(item.harness, item.id);
  };

  const toggleFavorite = (id: string) => {
    setFavorites((prev) => {
      const resolved = findPickerModel(id)?.id ?? id;
      const equivalent = (item: string) =>
        item === id || findPickerModel(item)?.id === resolved;
      const next = prev.some(equivalent)
        ? prev.filter((item) => !equivalent(item))
        : [...prev, id];
      saveFavoriteModels(next);
      return next;
    });
  };

  // Left and Right switch provider from the field and the tabs, as before
  // the list had its own keys.
  const onTabKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isImeComposition(e.nativeEvent)) return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.stopPropagation();
    selectTab(
      stepModelPickerTab(
        visibleTab,
        e.key === "ArrowLeft" ? -1 : 1,
        shownInPicker,
      ),
    );
  };

  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    // Enter and arrows belong to the input method while it composes.
    if (isImeComposition(e.nativeEvent)) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.max(0, Math.min(visible.length - 1, activeRow + 1)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(0, activeRow - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = visible[activeRow];
      if (item && isHarnessAvailable(item.harness)) pick(item);
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && !e.shiftKey && e.key >= "1" && e.key <= "9") {
      e.preventDefault();
      const item = visible[Number(e.key) - 1];
      if (item && isHarnessAvailable(item.harness)) pick(item);
    }
  };

  return (
    <div
      className={`flex min-h-0 min-w-0 flex-1 flex-col ${className}`}
      onKeyDown={onTabKey}
    >
      <nav
        role="tablist"
        aria-label="Providers"
        aria-keyshortcuts="ArrowLeft ArrowRight"
        aria-orientation="horizontal"
        className="flex w-full shrink-0 items-stretch border-b border-content/10"
      >
        <ProviderTabButton
          title="Favorites"
          selected={visibleTab === "favorites"}
          onSelect={() => selectTab("favorites")}
        >
          <Star
            className="size-4"
            strokeWidth={1.75}
            fill={visibleTab === "favorites" ? "currentColor" : "none"}
          />
        </ProviderTabButton>
        {pickerHarnesses.map((id) => (
          <ProviderTabButton
            key={id}
            title={HARNESS_TITLE[id]}
            selected={visibleTab === id}
            onSelect={() => selectTab(id)}
          >
            <HarnessIcon harness={id} className="size-4" />
          </ProviderTabButton>
        ))}
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="pb-1.5">
          <label className="flex items-center gap-2 border-b border-content/10 px-2 py-2.5 text-content/50">
            <Search className="size-3.5 shrink-0" strokeWidth={1.75} />
            <input
              type="text"
              value={query}
              placeholder="Search models..."
              aria-label="Search models"
              className="min-w-0 flex-1 bg-transparent text-ui-label text-content outline-none placeholder:text-content/40 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/60"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKey}
            />
          </label>
        </div>
        <ModelList
          models={visible}
          active={activeRow}
          currentId={current.id}
          favorites={favorites.map((id) => findPickerModel(id)?.id ?? id)}
          emptyLabel={
            visibleTab === "favorites" && !query.trim()
              ? "No favorite models"
              : visibleTab !== "favorites" && !isHarnessAvailable(visibleTab)
                ? harnessUnavailableHint(visibleTab)
                : visibleTab !== "favorites" &&
                    harnessDescriptor(visibleTab).emptyCatalogLabel &&
                    !query.trim()
                  ? harnessDescriptor(visibleTab).emptyCatalogLabel!
                  : "No matching models"
          }
          onActive={setActive}
          onPick={pick}
          onToggleFavorite={toggleFavorite}
        />
      </div>
    </div>
  );
}

function ProviderTabButton({
  title,
  selected,
  disabled = false,
  onSelect,
  children,
}: {
  title: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      title={title}
      aria-label={title}
      aria-selected={selected}
      aria-disabled={disabled}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        if (disabled) return;
        onSelect();
      }}
      className={`model-control-option relative flex min-w-0 flex-1 items-center justify-center gap-1 px-2 py-3 text-ui-caption leading-4 ${
        disabled
          ? "cursor-not-allowed text-content/25"
          : selected
            ? "bg-content/10 text-content"
            : "text-content/50 hover:bg-content/5 hover:text-content"
      }`}
    >
      <span className="shrink-0">{children}</span>
      {selected && !disabled ? (
        <span className="model-provider-indicator absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-content" />
      ) : null}
    </button>
  );
}

function ModelList({
  models,
  active,
  currentId,
  favorites,
  emptyLabel,
  onActive,
  onPick,
  onToggleFavorite,
}: {
  models: AgentModel[];
  active: number;
  currentId: string;
  favorites: string[];
  emptyLabel: string;
  onActive: (index: number) => void;
  onPick: (model: AgentModel) => void;
  onToggleFavorite: (id: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const activeRef = useRef<HTMLDivElement>(null);

  const setListRef = (el: HTMLDivElement | null) => {
    listRef.current = el;
    lockOverscroll(el);
  };

  // Before paint, so an opening picker never shows a frame scrolled to the
  // top before jumping to the highlighted row.
  useLayoutEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const hasRows = models.length > 0;
  // The popover measures hidden at its full height, then may place itself
  // shorter. Keep the highlighted row visible when the list is resized; the
  // observer runs after layout and before paint.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let height = el.clientHeight;
    const observer = new ResizeObserver(() => {
      if (el.clientHeight === height) return;
      height = el.clientHeight;
      activeRef.current?.scrollIntoView({ block: "nearest" });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasRows]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.stopPropagation();
      if (el.scrollHeight <= el.clientHeight + 1) return;
      el.scrollTop += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [models.length]);

  if (models.length === 0) {
    return (
      <div className="px-3 py-4 text-ui-label text-content/50">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div
      ref={setListRef}
      role="listbox"
      aria-label="Models"
      className="min-h-0 flex-1 overflow-y-auto overscroll-none px-1.5 pb-1.5"
    >
      {models.map((item, index) => {
        const selected = item.id === currentId;
        const highlighted = index === active;
        const favorited = favorites.includes(item.id);
        const disabled = !isHarnessAvailable(item.harness);
        const shortcut = index < 9 && !disabled ? `${MOD}${index + 1}` : null;
        return (
          <div
            key={item.id}
            ref={highlighted ? activeRef : undefined}
            onMouseEnter={() => onActive(index)}
            className={`flex w-full items-center gap-1 rounded-lg px-1 ${
              disabled
                ? ""
                : highlighted || selected
                  ? "bg-content/10"
                  : "hover:bg-content/5"
            }`}
          >
            <button
              type="button"
              role="option"
              aria-selected={selected}
              aria-disabled={disabled}
              disabled={disabled}
              // The search field moves through the list; Tab skips the rows.
              tabIndex={-1}
              title={
                disabled ? harnessUnavailableHint(item.harness) : undefined
              }
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (disabled) return;
                onPick(item);
              }}
              className={`flex min-w-0 flex-1 items-center gap-2 px-1.5 py-2 text-left ${
                disabled ? "cursor-not-allowed text-content/35" : "text-content"
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ui-body font-medium leading-5">
                  {item.name}
                </span>
                <span className="mt-0.5 flex items-center gap-1 text-ui-caption leading-4 text-content/50">
                  <HarnessIcon
                    harness={item.harness}
                    className="size-3 shrink-0 opacity-80"
                  />
                  <span className="truncate">
                    {HARNESS_TITLE[item.harness]} ·{" "}
                    {HARNESS_LABEL[item.harness]}
                  </span>
                </span>
              </span>
              {shortcut ? (
                <span className="shrink-0 rounded-md bg-content/10 px-1.5 py-0.5 font-mono text-ui-micro text-content/50">
                  {shortcut}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              title={favorited ? "Remove from favorites" : "Add to favorites"}
              aria-label={
                favorited ? "Remove from favorites" : "Add to favorites"
              }
              tabIndex={highlighted ? 0 : -1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite(item.id);
              }}
              className={`grid size-6 shrink-0 place-items-center rounded-md ${
                favorited
                  ? "text-content"
                  : "text-content/30 hover:text-content/70"
              }`}
            >
              <Star
                className="size-3.5"
                strokeWidth={1.75}
                fill={favorited ? "currentColor" : "none"}
              />
            </button>
          </div>
        );
      })}
    </div>
  );
}

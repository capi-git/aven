import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useProjectAppearance } from "../hooks/useProjectAppearance";
import { useUsageForecasts } from "../hooks/useUsageForecasts";
import { useWidth } from "../hooks/useNarrow";
import { appName } from "../lib/agentNames";
import {
  helmAccessibleName,
  effortHint,
  effortPips,
  helmCritterSnapshot,
  helmHintDue,
  helmPose,
  helmRows,
  HELM_HINT_MS,
  HELM_HOVER_CLOSE_MS,
  HELM_HOVER_OPEN_MS,
  markHelmHintSeen,
  moveGridCursor,
  moveHelmCursor,
  OPEN_USAGE_EVENT,
  roomBar,
  ROOM_CELLS,
  saveHelmCritter,
  subscribeHelmCritter,
  type HelmRowId,
} from "../lib/composerHelm";
import { composerFit } from "../lib/composerFit";
import {
  contextRatio,
  contextTooltip,
  type ContextUsage,
} from "../lib/contextUsage";
import { isHarnessAvailable } from "../lib/harness/availability";
import { pickerModelsFor, preferredModelId } from "../lib/models";
import { HELM_UNFURL_BEAT_MS, helmUnfurlSteps } from "../lib/motionTokens";
import { pixelTextPath, PIXEL_FONT_HEIGHT } from "../lib/pixelFont";
import { MOD } from "../lib/platform";
import { hasProjectAppearance } from "../lib/projectAppearance";
import { PROJECT_MASCOTS, projectMascot } from "../lib/projectMascots";
import {
  HARNESS_TITLE,
  RUNTIME_MODE_LABEL,
  type HarnessId,
  type RuntimeMode,
} from "../lib/session";
import type { Skill } from "../lib/skills";
import {
  saveTabGroupColor,
  saveTabGroupMascot,
  TAB_GROUP_COLORS,
} from "../lib/tabGroups";
import { usageAlternatives } from "../lib/usageAlternatives";
import { forecastSentence } from "../lib/usageForecast";
import { markUsageWarningSeen } from "../lib/usageHistory";
import { AgentPanel, useAgentSummary, type AgentPanelFocus } from "./AgentPill";
import { ColorSwatchRow } from "./ColorPickerPopover";
import { HarnessIcon } from "./HarnessIcon";
import { HelmCritter, PaperPlane } from "./HelmCritter";
import {
  HelmBubble,
  helmOutcome,
  useHelmRun,
  useHelmSay,
  type HelmFix,
  type HelmSay,
} from "./HelmRun";
import {
  ChevronLeft,
  ChevronRight,
  FilePlus,
  LockOpen,
  Lock,
  Zap,
} from "./icons";
import { useModelPickerHotkey } from "./ModelPicker";
import { ProjectMascot } from "./ProjectMascot";
import "./ComposerHelm.css";

/** A mode the message box can be put in (the old + menu's toggles). */
export type HelmMode = {
  id: "plan" | "orchestrator" | "discuss" | "race";
  label: string;
  description: string;
  icon: ReactNode;
  pressed: boolean;
  onToggle: () => void;
};

type Props = {
  /** The pane is on screen; a parked one stops its critter. */
  enabled: boolean;
  /** Cmd+. and the Switch Model… command open the dialog. */
  hotkeys: boolean;
  /** The folder whose critter stands here: the chat's project, or a bot's. */
  critterPath: string;
  harness: HarnessId;
  model: string;
  modelSettings: Record<string, string>;
  runtimeMode: RuntimeMode;
  /** Model, effort and access are offered (not in a bot's chat). */
  showAgent: boolean;
  /** Access is offered only where the provider supports it. */
  showAccess: boolean;
  busy: boolean;
  onModelChange: (harness: HarnessId, model: string) => void;
  onModelSettingsChange?: (settings: Record<string, string>) => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
  context?: ContextUsage;
  /** Free up space; absent where the chat can't compact. */
  onCompact?: () => void;
  compactDisabled: boolean;
  attachmentsSupported: boolean;
  onAttach: () => void;
  modes: readonly HelmMode[];
  /** Said in place of the modes while they are off (a discussion runs). */
  modesNote?: string;
  /** The chip of the mode that is on, standing on the box beside the critter. */
  modeChip?: ReactNode;
  recentSkills: readonly Skill[];
  onPickSkill: (skill: Skill) => void;
  hasValue: boolean;
  sendLabel: string;
  onSend: () => void;
  /** The team bar's Stop stops what this one would (a lead's run). */
  stopInBar: boolean;
  onStop?: () => void;
  /** Hands the keyboard back to the message. */
  onReturnFocus: () => void;
};

type Page = "main" | "modes" | "skills" | "critter";
type Opened = null | "hover" | "pinned" | "keyboard";

/** Rows' words, in the order the dialog draws them. */
const ROW_LABEL: Record<HelmRowId, string> = {
  model: "Model",
  effort: "Effort",
  access: "Access",
  room: "Room",
  files: "Files",
  modes: "Modes",
  skills: "Skills",
  critter: "Critter",
};

/** Six critters to a row in the picker grid. */
const CRITTER_COLUMNS = 6;

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** A row label in the critter's pixel font, with its words for readers. */
function PixelLabel({ text }: { text: string }) {
  const { d, width } = useMemo(() => pixelTextPath(text), [text]);
  return (
    <span className="helm-label">
      <svg
        aria-hidden
        viewBox={`0 0 ${width} ${PIXEL_FONT_HEIGHT}`}
        width={width}
        height={PIXEL_FONT_HEIGHT}
        shapeRendering="crispEdges"
        fill="currentColor"
      >
        <path d={d} />
      </svg>
      <span className="sr-only">{text}</span>
    </span>
  );
}

/** The room bar: twelve cells of what is left, its tip amber then red. */
function RoomBar({ used }: { used: number }) {
  const { lit, tone } = roomBar(used);
  return (
    <span className="helm-room" data-tone={tone} aria-hidden>
      {Array.from({ length: ROOM_CELLS }, (_, index) => (
        <i key={index} data-lit={index < lit || undefined} />
      ))}
    </span>
  );
}

function Pips({ on }: { on: number }) {
  return (
    <span className="helm-pips" aria-hidden>
      {[0, 1, 2, 3].map((index) => (
        <i key={index} data-on={index < on || undefined} />
      ))}
    </span>
  );
}

/**
 * The message box's helm: the project's critter on the box's top-right
 * corner, with the paper plane that sends and its speech bubble. Pointing
 * at it (or focusing it, or Cmd+.) unfurls a pixel dialog above the box
 * with everything the old bottom bar held.
 */
export const ComposerHelm = memo(function ComposerHelm(props: Props) {
  const {
    enabled,
    hotkeys,
    critterPath,
    harness,
    model,
    modelSettings,
    runtimeMode,
    showAgent,
    showAccess,
    busy,
    onModelChange,
    onModelSettingsChange,
    onRuntimeModeChange,
    context,
    onCompact,
    compactDisabled,
    attachmentsSupported,
    onAttach,
    modes,
    modesNote,
    modeChip,
    recentSkills,
    onPickSkill,
    hasValue,
    sendLabel,
    onSend,
    stopInBar,
    onStop,
    onReturnFocus,
  } = props;
  const dialogId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const critterRef = useRef<HTMLButtonElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [perchRef, perchWidth] = useWidth<HTMLDivElement>();
  const [opened, setOpened] = useState<Opened>(null);
  const [page, setPage] = useState<Page>("main");
  const [cursor, setCursor] = useState(0);
  const [panel, setPanel] = useState<AgentPanelFocus | null>(null);
  const [hop, setHop] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduced = useMemo(prefersReducedMotion, []);

  // The critter: the project's, or your own outside a project.
  const appearance = useProjectAppearance(critterPath);
  const personal = useSyncExternalStore(
    subscribeHelmCritter,
    helmCritterSnapshot,
    helmCritterSnapshot,
  );
  const inProject = hasProjectAppearance(critterPath) && !!appearance;
  const critterKey = inProject ? appearance.key : "aven-helm";
  const critterName = inProject ? appearance.mascot : personal.mascot;
  const critterColor = inProject
    ? appearance.color
    : personal.colorIndex != null
      ? TAB_GROUP_COLORS[personal.colorIndex]
      : TAB_GROUP_COLORS[0];
  const mascot = projectMascot(critterKey, critterName);

  // What the agent is.
  const agent = useAgentSummary({
    harness,
    model,
    modelSettings,
    runtimeMode,
    showAccess,
  });
  const ratio = contextRatio(context);
  const room = ratio == null ? null : roomBar(ratio);
  const activeMode = modes.find((mode) => mode.pressed) ?? null;

  // What the bubble says, and the critter acts out.
  const run = useHelmRun();
  const { say: runSay, dismiss } = useHelmSay(run, busy);
  const forecasts = useUsageForecasts();
  const usageWarning = showAgent ? agent.usageWarning : null;
  const currentModel = agent.current;
  const usageSay = useMemo<{ say: HelmSay; fixes: HelmFix[] } | null>(() => {
    if (!usageWarning?.unseen) return null;
    const now = Date.now();
    const options = usageAlternatives({
      harness,
      current: currentModel,
      forecasts,
      now,
      isAvailable: isHarnessAvailable,
      catalog: pickerModelsFor,
      preferred: preferredModelId,
      title: (id) => HARNESS_TITLE[id],
    });
    return {
      say: {
        kind: "error",
        text: forecastSentence(
          usageWarning.provider,
          usageWarning.kind,
          Math.max(0, usageWarning.pace.hitAt - now),
        ),
      },
      fixes: options.slice(0, 1).map((option) => ({
        label: option.label,
        detail: option.detail,
        run: () => {
          markUsageWarningSeen(usageWarning);
          onModelChange(option.harness, option.model);
        },
      })),
    };
  }, [usageWarning, harness, currentModel, forecasts, onModelChange]);

  const openUsage = useCallback(
    () => window.dispatchEvent(new Event(OPEN_USAGE_EVENT)),
    [],
  );
  const runFixes = useMemo<HelmFix[]>(() => {
    if (runSay?.kind !== "error") return [];
    if (runSay.recovery === "claude-login" && run?.onOpenTerminal) {
      const { onOpenTerminal, session } = run;
      return [
        { label: "Open terminal", run: () => onOpenTerminal(session.id) },
      ];
    }
    const fixes: HelmFix[] = [];
    if (showAgent)
      fixes.push({
        label: "Switch model",
        run: () => {
          dismiss();
          setPanel("model");
        },
      });
    if (harness === "claude" || harness === "codex")
      fixes.push({
        label: "Usage",
        detail: "Open usage details",
        run: openUsage,
      });
    return fixes;
  }, [runSay, run, showAgent, harness, openUsage, dismiss]);

  const say = runSay ?? usageSay?.say ?? null;
  const fixes = runSay ? runFixes : (usageSay?.fixes ?? []);
  const outcome = helmOutcome(say);
  const pose = helmPose({ busy, hasValue, open: !!opened, outcome });

  // The first-run hint: said once, when nothing else is.
  const [hint, setHint] = useState(false);
  useEffect(() => {
    if (!enabled || !helmHintDue()) return;
    const start = setTimeout(() => setHint(true), 1200);
    return () => clearTimeout(start);
  }, [enabled]);
  useEffect(() => {
    if (!hint) return;
    markHelmHintSeen();
    const end = setTimeout(() => setHint(false), HELM_HINT_MS);
    return () => clearTimeout(end);
  }, [hint]);

  // Nothing moves while the window is hidden or the pane is parked.
  const hidden = useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "hidden",
    () => false,
  );
  const paused = hidden || !enabled;

  // ---- opening and closing --------------------------------------------
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clearTimer, []);
  const open = useCallback((how: Exclude<Opened, null>) => {
    clearTimer();
    setHint(false);
    setOpened((current) =>
      current === "pinned" || current === "keyboard" ? current : how,
    );
  }, []);
  const close = useCallback(
    (returnFocus = false) => {
      clearTimer();
      setOpened(null);
      setPage("main");
      if (returnFocus) onReturnFocus();
    },
    [onReturnFocus],
  );
  const toggleFromKeyboard = useCallback(() => {
    if (opened) close(true);
    else {
      setCursor(0);
      setPage("main");
      setOpened("keyboard");
    }
  }, [opened, close]);
  useModelPickerHotkey(hotkeys && enabled, !!opened, toggleFromKeyboard);

  const scheduleOpen = () => {
    if (opened || panel) return;
    clearTimer();
    timer.current = setTimeout(() => open("hover"), HELM_HOVER_OPEN_MS);
  };
  const scheduleClose = () => {
    if (opened !== "hover") {
      clearTimer();
      return;
    }
    clearTimer();
    timer.current = setTimeout(() => {
      setOpened((current) => (current === "hover" ? null : current));
      setPage("main");
    }, HELM_HOVER_CLOSE_MS);
  };

  // Outside presses close a dialog that was clicked or keyed open.
  useEffect(() => {
    if (!opened) return;
    const onDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      close(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [opened, close]);

  // ---- rows ---------------------------------------------------------------
  const rows = helmRows({
    model: showAgent,
    effort: showAgent && !!agent.summary.effort,
    access: showAgent && showAccess,
    room: room != null,
    files: true,
    modes: modes.length > 0 || !!modesNote,
    skills: recentSkills.length > 0,
    critter: true,
  });
  const rowCount = rows.length;
  const safeCursor = Math.min(cursor, Math.max(0, rowCount - 1));

  const openPanel = (focus: AgentPanelFocus) => {
    close(false);
    setPanel(focus);
  };
  const activate = (id: HelmRowId) => {
    switch (id) {
      case "model":
      case "effort":
      case "access":
        openPanel(id);
        return;
      case "room":
        if (onCompact && !compactDisabled) {
          close(true);
          onCompact();
        }
        return;
      case "files":
        if (!attachmentsSupported) return;
        close(false);
        onAttach();
        return;
      case "modes":
      case "skills":
      case "critter":
        // While a discussion runs, what you send goes to both chats.
        if (id === "modes" && modesNote) return;
        setPage(id);
        setCursor(0);
        setOpened((current) => (current === "hover" ? "pinned" : current));
        return;
    }
  };

  // The keyboard lands on the ▶ row whenever the dialog was keyed open.
  const focusTarget = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (opened !== "keyboard" && opened !== "pinned") return;
    const root = rootRef.current;
    if (!root) return;
    const selector =
      focusTarget.current ??
      (page === "main"
        ? `[data-helm-row-index="${safeCursor}"]`
        : `[data-helm-item-index="${cursor}"]`);
    focusTarget.current = null;
    root.querySelector<HTMLElement>(selector)?.focus();
  }, [opened, page, cursor, safeCursor]);

  const backToMain = (from: Page) => {
    setPage("main");
    setCursor(Math.max(0, rows.indexOf(from as HelmRowId)));
  };

  // ---- the critter picker ---------------------------------------------
  const pickCritter = (name: string) => {
    if (inProject) saveTabGroupMascot(appearance.key, name);
    else saveHelmCritter({ ...personal, mascot: name });
    setHop((value) => value + 1);
  };
  const pickColor = (index: number) => {
    if (inProject) saveTabGroupColor(appearance.key, index);
    else saveHelmCritter({ ...personal, colorIndex: index });
    setHop((value) => value + 1);
  };
  const [previewCritter, setPreviewCritter] = useState<string | null>(null);

  const itemCount =
    page === "modes"
      ? modes.length
      : page === "skills"
        ? recentSkills.length
        : page === "critter"
          ? PROJECT_MASCOTS.length
          : 0;

  const onDialogKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (page !== "main") backToMain(page);
      else close(true);
      return;
    }
    if (page === "main") {
      const next = moveHelmCursor(event.key, safeCursor, rowCount);
      if (next !== null) {
        event.preventDefault();
        setCursor(next);
        setOpened((current) => (current === "hover" ? "keyboard" : current));
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        const id = rows[safeCursor];
        if (id) activate(id);
      }
      return;
    }
    if (event.key === "ArrowLeft" && page !== "critter") {
      event.preventDefault();
      backToMain(page);
      return;
    }
    const next =
      page === "critter"
        ? moveGridCursor(event.key, cursor, itemCount, CRITTER_COLUMNS)
        : moveHelmCursor(event.key, cursor, itemCount);
    if (next !== null) {
      event.preventDefault();
      setCursor(next);
      if (page === "critter") setPreviewCritter(PROJECT_MASCOTS[next].name);
    }
  };

  // ---- the unfurl ---------------------------------------------------------
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!opened || !frame || reduced) return;
    const width = frame.offsetWidth;
    const height = frame.offsetHeight;
    if (!width || !height) return;
    const steps = helmUnfurlSteps(Math.max(width, height));
    const keyframes: Keyframe[] = [
      { width: "0px", height: "0px", offset: 0, easing: "step-end" },
      ...steps.map((fraction, index) => ({
        width: `${Math.round(width * fraction)}px`,
        height: `${Math.round(height * fraction)}px`,
        offset: (index + 1) / (steps.length + 1),
        easing: "step-end",
      })),
      { width: `${width}px`, height: `${height}px`, offset: 1 },
    ];
    const animation = frame.animate?.(keyframes, {
      duration: HELM_UNFURL_BEAT_MS * (steps.length + 1),
      easing: "linear",
    });
    return () => animation?.cancel();
    // Only on opening: changing page inside an open dialog does not unfurl.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!opened, reduced]);

  // ---- words ----------------------------------------------------------------
  const accessLabel = showAccess ? RUNTIME_MODE_LABEL[runtimeMode] : null;
  const accessibleName = helmAccessibleName({
    model: showAgent
      ? `${appName(harness)} ${agentModelWords(agent.current.name, harness)}`
      : null,
    effort: showAgent ? agent.summary.effort : null,
    fast: showAgent && agent.summary.fast,
    access: showAgent ? accessLabel : null,
    roomLeft: room?.percentLeft ?? null,
    mode: activeMode?.label ?? null,
  });
  const contextWords = context ? contextTooltip(context) : null;
  const fit = composerFit(perchWidth, !!activeMode);

  const row = (id: HelmRowId, index: number) => {
    const active = page === "main" && index === safeCursor;
    let value: ReactNode = null;
    let aside: ReactNode = null;
    let disabled = false;
    switch (id) {
      case "model":
        value = (
          <>
            <HarnessIcon
              harness={agent.current.harness}
              className="helm-mark"
            />
            <b>{agentModelWords(agent.current.name, harness)}</b>
          </>
        );
        aside = agent.usageWarning ? (
          <span className="helm-amber">Usage limit close</span>
        ) : (
          appName(agent.current.harness)
        );
        break;
      case "effort":
        value = (
          <>
            <Pips on={effortPips(agent.summary.effort)} />
            {agent.summary.effort}
            {agent.summary.fast ? (
              <span className="helm-fast">
                <Zap aria-hidden />
                Fast
              </span>
            ) : null}
          </>
        );
        aside = effortHint(agent.summary.effort);
        break;
      case "access":
        value = (
          <span
            className={runtimeMode === "full-access" ? "helm-amber" : undefined}
          >
            {runtimeMode === "full-access" ? (
              <LockOpen aria-hidden className="helm-icon" />
            ) : (
              <Lock aria-hidden className="helm-icon" />
            )}
            {accessLabel}
          </span>
        );
        break;
      case "room":
        value = (
          <>
            <RoomBar used={ratio ?? 0} />
            <span
              className={
                room?.tone === "calm" ? undefined : `helm-${room?.tone}`
              }
              title={
                contextWords
                  ? `${contextWords.headline}. ${contextWords.detail}`
                  : undefined
              }
            >
              {room?.percentLeft}% left
            </span>
          </>
        );
        aside = onCompact ? (
          <span className={compactDisabled ? "helm-quiet" : "helm-ink"}>
            Free up space
          </span>
        ) : (
          contextWords?.detail
        );
        disabled = !onCompact || compactDisabled;
        break;
      case "files":
        value = (
          <>
            <FilePlus aria-hidden className="helm-icon" />
            {attachmentsSupported
              ? "Attach files"
              : `${appName(harness)} can't take files`}
          </>
        );
        aside = attachmentsSupported ? `${MOD}U` : null;
        disabled = !attachmentsSupported;
        break;
      case "modes":
        value = modesNote ? (
          <span
            className="helm-quiet"
            title={modesNote}
            data-composer-modes-off
          >
            {modesNote}
          </span>
        ) : activeMode ? (
          <>
            {activeMode.icon}
            {activeMode.label}
          </>
        ) : (
          <span className="helm-quiet">Plan, Orchestrator, Discuss, Race</span>
        );
        aside = modesNote ? null : (
          <ChevronRight aria-hidden className="helm-icon" />
        );
        disabled = !!modesNote;
        break;
      case "skills":
        value = (
          <span className="helm-skill-list">
            {recentSkills.slice(0, 3).map((skill) => (
              <span key={skill.invocation} className="helm-skill">
                /{skill.invocation}
              </span>
            ))}
          </span>
        );
        aside = <ChevronRight aria-hidden className="helm-icon" />;
        break;
      case "critter":
        value = (
          <>
            <ProjectMascot
              project={critterKey}
              name={mascot.name}
              color={critterColor}
              className="helm-mini-critter"
            />
            {mascot.label}
          </>
        );
        aside = <ChevronRight aria-hidden className="helm-icon" />;
        break;
    }
    return (
      <button
        key={id}
        type="button"
        role="menuitem"
        className="helm-row"
        data-helm-row={id}
        data-helm-row-index={index}
        data-active={active || undefined}
        aria-disabled={disabled || undefined}
        style={{ "--i": index } as CSSProperties}
        tabIndex={active ? 0 : -1}
        onMouseEnter={() => setCursor(index)}
        onFocus={() => setCursor(index)}
        onClick={() => activate(id)}
      >
        <span className="helm-cursor" aria-hidden>
          {active ? "▶" : ""}
        </span>
        <PixelLabel text={ROW_LABEL[id]} />
        <span className="helm-value">{value}</span>
        <span className="helm-aside">{aside}</span>
      </button>
    );
  };

  const subPage = () => {
    if (page === "modes")
      return (
        <div role="menu" aria-label="Modes" data-composer-plus>
          <BackRow label="Modes" onBack={() => backToMain("modes")} />
          {modes.map((mode, index) => (
            <button
              key={mode.id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={mode.pressed}
              className="helm-row helm-row-rich"
              data-helm-item-index={index}
              data-active={index === cursor || undefined}
              tabIndex={index === cursor ? 0 : -1}
              {...{ [`data-composer-${mode.id}`]: "" }}
              onMouseEnter={() => setCursor(index)}
              onFocus={() => setCursor(index)}
              onClick={() => {
                close(false);
                mode.onToggle();
              }}
            >
              <span className="helm-cursor" aria-hidden>
                {index === cursor ? "▶" : ""}
              </span>
              <span className="helm-mode-icon" aria-hidden>
                {mode.icon}
              </span>
              <span className="helm-mode-text" title={mode.description}>
                <span>{mode.label}</span>
                <span className="helm-quiet">{mode.description}</span>
              </span>
              <span className="helm-aside">{mode.pressed ? "On" : ""}</span>
            </button>
          ))}
        </div>
      );
    if (page === "skills")
      return (
        <div role="menu" aria-label="Recent skills">
          <BackRow label="Skills" onBack={() => backToMain("skills")} />
          {recentSkills.map((skill, index) => (
            <button
              key={skill.invocation}
              type="button"
              role="menuitem"
              className="helm-row"
              data-helm-item-index={index}
              data-active={index === cursor || undefined}
              tabIndex={index === cursor ? 0 : -1}
              onMouseEnter={() => setCursor(index)}
              onFocus={() => setCursor(index)}
              onClick={() => {
                close(true);
                onPickSkill(skill);
              }}
            >
              <span className="helm-cursor" aria-hidden>
                {index === cursor ? "▶" : ""}
              </span>
              <span className="helm-value helm-skill">/{skill.invocation}</span>
              <span className="helm-aside">{skill.description ?? ""}</span>
            </button>
          ))}
        </div>
      );
    if (page === "critter") {
      const shown = previewCritter ?? mascot.name;
      return (
        <div className="helm-critter-page">
          <BackRow label="Critter" onBack={() => backToMain("critter")} />
          <div className="helm-critter-stage" aria-hidden>
            <HelmCritter
              key={shown}
              project={critterKey}
              name={shown}
              color={critterColor}
              pose="typing"
              className="helm-critter-preview"
            />
            <span>{projectMascot(critterKey, shown).label}</span>
          </div>
          <div
            className="helm-critter-grid"
            role="radiogroup"
            aria-label="Critter"
          >
            {PROJECT_MASCOTS.map((item, index) => {
              const selected = item.name === mascot.name;
              return (
                <button
                  key={item.name}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={item.label}
                  className="helm-critter-cell"
                  data-helm-item-index={index}
                  data-critter-choice={item.name}
                  data-active={index === cursor || undefined}
                  tabIndex={index === cursor ? 0 : -1}
                  onMouseEnter={() => {
                    setCursor(index);
                    setPreviewCritter(item.name);
                  }}
                  onMouseLeave={() => setPreviewCritter(null)}
                  onFocus={() => setPreviewCritter(item.name)}
                  onClick={() => pickCritter(item.name)}
                >
                  <ProjectMascot
                    project={critterKey}
                    name={item.name}
                    color={critterColor}
                    active={index === cursor && !reduced}
                    className="helm-critter-cell-art"
                  />
                </button>
              );
            })}
          </div>
          <div className="helm-critter-colors" aria-label="Colour">
            <ColorSwatchRow
              colors={TAB_GROUP_COLORS}
              colorIndex={
                inProject
                  ? appearance.customColor != null
                    ? -1
                    : (appearance.colorIndex ?? appearance.automaticColorIndex)
                  : (personal.colorIndex ?? 0)
              }
              customColor={inProject ? appearance.customColor : null}
              customPickerOpen={false}
              onPickIndex={pickColor}
            />
          </div>
          <p className="helm-quiet helm-critter-note">
            {inProject
              ? `${appearance.label}'s critter, everywhere it shows`
              : "Your critter outside projects"}
          </p>
        </div>
      );
    }
    return null;
  };

  const showDialog = !!opened;
  const hintWords =
    hint && !say && !showDialog ? "Point at me for settings" : null;
  const style = {
    "--helm-critter-color": critterColor,
  } as CSSProperties;

  return (
    <div
      ref={(node) => {
        rootRef.current = node;
        perchRef(node);
      }}
      className="composer-helm"
      data-helm
      data-pose={pose}
      data-paused={paused || undefined}
      data-reduced={reduced || undefined}
      data-fit={fit === "full" ? undefined : fit}
      style={style}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (next && rootRef.current?.contains(next)) return;
        if (opened === "keyboard" || opened === "pinned") close(false);
      }}
    >
      {modeChip ? <div className="helm-mode-chip">{modeChip}</div> : null}
      <div className="helm-spacer" />
      <HelmBubble
        say={say}
        run={run}
        stopInBar={stopInBar}
        onStop={onStop}
        fixes={fixes}
        onDismiss={() => {
          if (runSay) dismiss();
          else if (usageWarning) markUsageWarningSeen(usageWarning);
        }}
        hint={hintWords}
      />
      {/* Only something typed (or attached) can be sent; Return sends too. */}
      <button
        type="button"
        className="helm-plane"
        aria-label={sendLabel}
        title={`${sendLabel} (Return)`}
        data-helm-send
        hidden={!hasValue}
        disabled={!hasValue}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onSend}
      >
        <PaperPlane />
      </button>
      <div
        className="helm-perch"
        onPointerEnter={scheduleOpen}
        onPointerLeave={scheduleClose}
      >
        {room ? (
          <span className="helm-perch-room">
            <RoomBar used={ratio ?? 0} />
          </span>
        ) : null}
        <button
          ref={critterRef}
          type="button"
          className="helm-critter-button"
          aria-label={accessibleName}
          aria-haspopup="dialog"
          aria-expanded={showDialog}
          aria-controls={showDialog ? dialogId : undefined}
          aria-keyshortcuts={`${MOD}.`}
          data-helm-critter
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (opened === "pinned" || opened === "keyboard") close(true);
            else {
              setCursor(0);
              setPage("main");
              clearTimer();
              setOpened("pinned");
            }
          }}
          onFocus={(event) => {
            if (event.currentTarget.matches(":focus-visible") && !opened) {
              setCursor(0);
              setPage("main");
              setOpened("keyboard");
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setCursor(0);
              setPage("main");
              setOpened("keyboard");
            }
          }}
        >
          <HelmCritter
            key={hop}
            project={critterKey}
            name={mascot.name}
            color={critterColor}
            pose={pose}
            className={hop ? "helm-critter-hop" : undefined}
          />
        </button>
        {showDialog ? (
          <div
            id={dialogId}
            className="helm-dialog"
            role="dialog"
            aria-label="Message settings"
            data-helm-dialog
            data-page={page}
            // Inside the perch: leaving the dialog for the critter is not
            // leaving the helm.
            onPointerEnter={() => clearTimer()}
            onKeyDown={onDialogKey}
          >
            <div ref={frameRef} className="helm-dialog-frame">
              <div className="helm-dialog-body">
                {page === "main" ? (
                  <div role="menu" aria-label="Message settings">
                    {rows.map((id, index) => row(id, index))}
                  </div>
                ) : (
                  subPage()
                )}
              </div>
            </div>
            <span className="helm-dialog-tail" aria-hidden />
          </div>
        ) : null}
      </div>
      {panel ? (
        <AgentPanel
          anchor={critterRef}
          harness={harness}
          model={model}
          modelSettings={modelSettings}
          runtimeMode={runtimeMode}
          showAccess={showAccess}
          busy={busy}
          focus={panel}
          onModelChange={onModelChange}
          onModelSettingsChange={onModelSettingsChange}
          onRuntimeModeChange={onRuntimeModeChange}
          onDismiss={(restore) => {
            setPanel(null);
            if (restore) onReturnFocus();
          }}
        />
      ) : null}
    </div>
  );
});

/** The model's own words beside its provider's mark: "Opus 5.5", "GPT-5". */
function agentModelWords(name: string, harness: HarnessId): string {
  const app = appName(harness);
  return name.toLowerCase().startsWith(`${app.toLowerCase()} `)
    ? name.slice(app.length + 1)
    : name;
}

function BackRow({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <button
      type="button"
      className="helm-back"
      onClick={onBack}
      aria-label={`Back from ${label}`}
      tabIndex={-1}
    >
      <ChevronLeft aria-hidden className="helm-icon" />
      <PixelLabel text={label} />
    </button>
  );
}

function subscribeVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

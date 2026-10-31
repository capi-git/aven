import {
  memo,
  useCallback,
  useEffect,
  useId,
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
  moveHelmCursor,
  moveMarkCursor,
  OPEN_USAGE_EVENT,
  roomBar,
  saveHelmCritter,
  subscribeHelmCritter,
  type HelmPose,
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
import {
  PROJECT_SIGILS,
  SIGIL_CRITTERS,
  appearanceSigil,
  projectSigil,
} from "../lib/dotSigils";
import {
  MARK_TONES,
  appearanceTone,
  markTone,
  markToneColor,
  markToneIndex,
  saveProjectTone,
} from "../lib/markTones";
import { MOD } from "../lib/platform";
import { hasProjectAppearance } from "../lib/projectAppearance";
import {
  HARNESS_TITLE,
  RUNTIME_MODE_LABEL,
  type HarnessId,
  type RuntimeMode,
} from "../lib/session";
import type { Skill } from "../lib/skills";
import { saveTabGroupMascot } from "../lib/tabGroups";
import { usageAlternatives } from "../lib/usageAlternatives";
import { forecastSentence } from "../lib/usageForecast";
import { markUsageWarningSeen } from "../lib/usageHistory";
import { AgentPanel, useAgentSummary, type AgentPanelFocus } from "./AgentPill";
import { HarnessIcon } from "./HarnessIcon";
import { DotMark, type DotMarkState } from "./DotMark";
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
  MoveUp,
  Zap,
} from "./icons";
import { useModelPickerHotkey } from "./ModelPicker";
import { Popover } from "./Popover";
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
  /** The pane is on screen; a parked one stops its mark. */
  enabled: boolean;
  /** Cmd+. and the Switch Model… command open the dialog. */
  hotkeys: boolean;
  /** The folder whose mark stands here: the chat's project, or a bot's. */
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
  /** The chip of the mode that is on, standing on the box beside the mark. */
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
  critter: "Mark",
};

/** The dialog's width, and its distance above the mark (over its room line). */
const DIALOG_WIDTH = 340;
const DIALOG_GAP = 14;
/** Changes to the popover's placement to wait through for a refused focus. */
const FOCUS_TRIES = 10;

/** Six marks to a row in the picker grid. */
const CRITTER_COLUMNS = 6;

/** What the mark at the helm shows for what the message box is doing. */
const POSE_STATE: Record<HelmPose, DotMarkState> = {
  rest: "still",
  typing: "idle",
  hover: "idle",
  running: "working",
  done: "done",
  error: "error",
};

/** A row's label, in the system font. */
function RowLabel({ text }: { text: string }) {
  return <span className="helm-label">{text}</span>;
}

/** The room left: a thin line, its fill amber then red as room runs out. */
function RoomBar({ used }: { used: number }) {
  const { tone, percentLeft } = roomBar(used);
  return (
    <span className="helm-room" data-tone={tone} aria-hidden>
      <i style={{ transform: `scaleX(${percentLeft / 100})` }} />
    </span>
  );
}

/** Effort as four round dots, as many lit as it thinks. */
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
 * The message box's helm: the project's mark on the box's top-right corner,
 * with the button that sends and its speech bubble. Pointing at it (or
 * focusing it, or Cmd+.) opens a menu above the box with everything the old
 * bottom bar held.
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const [perchRef, perchWidth] = useWidth<HTMLDivElement>();
  const [opened, setOpened] = useState<Opened>(null);
  const [page, setPage] = useState<Page>("main");
  const [cursor, setCursor] = useState(0);
  const [panel, setPanel] = useState<AgentPanelFocus | null>(null);
  const [hop, setHop] = useState(0);
  // The mark or colour under the picker's cursor (its place on the page:
  // the sigils, then the colours), previewed above the grid.
  const [preview, setPreview] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The mark: the project's, or your own outside a project. Both are kept
  // under the critter name each mark stands for.
  const appearance = useProjectAppearance(critterPath);
  const personal = useSyncExternalStore(
    subscribeHelmCritter,
    helmCritterSnapshot,
    helmCritterSnapshot,
  );
  const inProject = hasProjectAppearance(critterPath) && !!appearance;
  const critterKey = inProject ? appearance.key : "aven-helm";
  const mark = inProject
    ? appearanceSigil(appearance)
    : projectSigil(personal.mascot, critterKey);
  // Its colour: the project's (picked, or its own from its name), or the
  // one you picked outside projects, Grey until you do.
  const toneIndex = markToneIndex(inProject ? appearance : personal);
  const tone = inProject ? appearanceTone(appearance) : markTone(personal);

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

  // What the bubble says, and the mark shows.
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
      setPreview(null);
      if (returnFocus) onReturnFocus();
    },
    [onReturnFocus],
  );
  // The dialog and the agent panel live in portals, so a parked pane or a
  // hidden window takes them away; left open, they would float over the
  // chat on screen now and change this one.
  useEffect(() => {
    if (!paused) return;
    close(false);
    setPanel(null);
  }, [paused, close]);
  // With the agent panel open, Cmd+., Switch Model… and the mark close
  // it and hand the keyboard back, as the old agent pill's did.
  const closePanel = useCallback(() => {
    setPanel(null);
    onReturnFocus();
  }, [onReturnFocus]);
  // Cmd+. on a dialog the pointer opened takes the keyboard into it; on one
  // already keyed or clicked open it closes it again.
  const toggleFromKeyboard = useCallback(() => {
    if (panel) closePanel();
    else if (opened === "keyboard" || opened === "pinned") close(true);
    else {
      clearTimer();
      if (!opened) {
        setCursor(0);
        setPage("main");
      }
      setOpened("keyboard");
    }
  }, [panel, opened, close, closePanel]);
  useModelPickerHotkey(
    hotkeys && enabled,
    !!opened || !!panel,
    toggleFromKeyboard,
  );

  const scheduleOpen = () => {
    // Back on the mark from its menu: stay open.
    clearTimer();
    if (opened || panel) return;
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
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (dialogRef.current?.contains(target)) return;
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
        // The picker opens on the mark that stands here now.
        setCursor(
          id === "critter"
            ? Math.max(
                0,
                PROJECT_SIGILS.findIndex((item) => item.key === mark.key),
              )
            : 0,
        );
        setPreview(null);
        setOpened((current) => (current === "hover" ? "pinned" : current));
        return;
    }
  };

  // The keyboard lands on the ▶ row whenever the dialog was keyed open. The
  // popover measures itself in a hidden first pass, and a browser refuses
  // focus to a hidden element, so a refused focus waits for the popover to
  // be placed (its frame's style changes) and lands then. An observer rather
  // than animation frames: a window in the background gets no frames.
  useEffect(() => {
    if (opened !== "keyboard" && opened !== "pinned") return;
    const selector =
      page === "main"
        ? `[data-helm-row-index="${safeCursor}"]`
        : `[data-helm-item-index="${cursor}"]`;
    const land = () => {
      const target = dialogRef.current?.querySelector<HTMLElement>(selector);
      if (!target) return true;
      target.focus({ preventScroll: false });
      return document.activeElement === target;
    };
    const frame = dialogRef.current?.parentElement;
    if (land() || !frame) return;
    let tries = 0;
    const observer = new MutationObserver(() => {
      if (land() || ++tries >= FOCUS_TRIES) observer.disconnect();
    });
    observer.observe(frame, { attributes: true, attributeFilter: ["style"] });
    return () => observer.disconnect();
  }, [opened, page, cursor, safeCursor]);

  const backToMain = (from: Page) => {
    setPage("main");
    setPreview(null);
    setCursor(Math.max(0, rows.indexOf(from as HelmRowId)));
  };

  // ---- the mark picker -------------------------------------------------
  // Saved under the critter name it stands for, as picks were before marks.
  const pickCritter = (key: string) => {
    const name = SIGIL_CRITTERS[key] ?? key;
    if (inProject) saveTabGroupMascot(appearance.key, name);
    else saveHelmCritter({ ...personal, mascot: name });
    setHop((value) => value + 1);
  };
  // The project's colour, or your own outside a project.
  const pickTone = (index: number) => {
    if (inProject) saveProjectTone(appearance, index);
    else saveHelmCritter({ mascot: personal.mascot, colorIndex: index });
    setHop((value) => value + 1);
  };
  const itemCount =
    page === "modes"
      ? modes.length
      : page === "skills"
        ? recentSkills.length
        : page === "critter"
          ? PROJECT_SIGILS.length + MARK_TONES.length
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
    // The dialog sits in a portal at the page's end, so Tab past its first or
    // last control would leave for whatever ends the page. Shift+Tab goes
    // back to the critter, Tab back to the message.
    if (event.key === "Tab") {
      const stops = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>(
          "button, input, select, textarea, [tabindex]",
        ) ?? []),
      ].filter(
        (element) => element.tabIndex >= 0 && !element.matches(":disabled"),
      );
      const edge = event.shiftKey ? stops[0] : stops.at(-1);
      if (stops.length && document.activeElement !== edge) return;
      event.preventDefault();
      if (event.shiftKey) {
        close(false);
        critterRef.current?.focus();
      } else close(true);
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
        ? moveMarkCursor(
            event.key,
            cursor,
            PROJECT_SIGILS.length,
            CRITTER_COLUMNS,
            MARK_TONES.length,
          )
        : moveHelmCursor(event.key, cursor, itemCount);
    if (next !== null) {
      event.preventDefault();
      setCursor(next);
      if (page === "critter") setPreview(next);
    }
  };

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
            <DotMark sigil={mark} tone={tone} className="helm-mini-critter" />
            {mark.label}
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
        tabIndex={active ? 0 : -1}
        onMouseEnter={() => setCursor(index)}
        onFocus={() => setCursor(index)}
        onClick={() => activate(id)}
      >
        <RowLabel text={ROW_LABEL[id]} />
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
              className="helm-row helm-row-skill"
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
              <span className="helm-value helm-skill">/{skill.invocation}</span>
              <span className="helm-aside" title={skill.description}>
                {skill.description ?? ""}
              </span>
            </button>
          ))}
        </div>
      );
    if (page === "critter") {
      const sigilCount = PROJECT_SIGILS.length;
      const shown =
        preview !== null && preview < sigilCount
          ? PROJECT_SIGILS[preview]
          : mark;
      const shownTone =
        MARK_TONES[
          preview !== null && preview >= sigilCount
            ? preview - sigilCount
            : toneIndex
        ];
      // Each row is one stop for Tab: the cell under the cursor, or the
      // chosen one in the row the cursor is not in.
      const sigilStop =
        cursor < sigilCount
          ? cursor
          : Math.max(
              0,
              PROJECT_SIGILS.findIndex((item) => item.key === mark.key),
            );
      const colourStop = cursor >= sigilCount ? cursor : sigilCount + toneIndex;
      return (
        <div className="helm-critter-page">
          <BackRow label="Mark" onBack={() => backToMain("critter")} />
          <div className="helm-critter-stage" aria-hidden>
            <DotMark
              sigil={shown}
              tone={shownTone.tone}
              state="idle"
              className="helm-critter-preview"
            />
            <span>
              {shown.label}
              <span className="helm-critter-stage-tone">{shownTone.label}</span>
            </span>
          </div>
          <div
            className="helm-critter-grid"
            role="radiogroup"
            aria-label="Mark"
          >
            {PROJECT_SIGILS.map((item, index) => {
              const selected = item.key === mark.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={item.label}
                  className="helm-critter-cell"
                  data-helm-item-index={index}
                  data-critter-choice={SIGIL_CRITTERS[item.key]}
                  data-mark-choice={item.key}
                  data-active={index === cursor || undefined}
                  tabIndex={index === sigilStop ? 0 : -1}
                  onMouseEnter={() => {
                    setCursor(index);
                    setPreview(index);
                  }}
                  onMouseLeave={() => setPreview(null)}
                  onFocus={() => {
                    setCursor(index);
                    setPreview(index);
                  }}
                  onClick={() => pickCritter(item.key)}
                >
                  <DotMark
                    sigil={item}
                    tone={tone}
                    className="helm-critter-cell-art"
                  />
                </button>
              );
            })}
          </div>
          <div
            className="helm-colour-row"
            role="radiogroup"
            aria-label="Colour"
          >
            {MARK_TONES.map((item, colour) => {
              const index = sigilCount + colour;
              return (
                <button
                  key={item.tone}
                  type="button"
                  role="radio"
                  aria-checked={colour === toneIndex}
                  aria-label={item.label}
                  className="helm-colour-cell"
                  data-helm-item-index={index}
                  data-mark-tone={item.tone}
                  data-active={index === cursor || undefined}
                  tabIndex={index === colourStop ? 0 : -1}
                  onMouseEnter={() => {
                    setCursor(index);
                    setPreview(index);
                  }}
                  onMouseLeave={() => setPreview(null)}
                  onFocus={() => {
                    setCursor(index);
                    setPreview(index);
                  }}
                  onClick={() => pickTone(colour)}
                >
                  <span
                    className="helm-colour-swatch"
                    style={
                      {
                        "--helm-swatch": markToneColor(item.tone),
                      } as CSSProperties
                    }
                  />
                </button>
              );
            })}
          </div>
          <p className="helm-quiet helm-critter-note">
            {inProject
              ? `${appearance.label}'s mark, everywhere it shows`
              : "Your mark outside projects"}
          </p>
        </div>
      );
    }
    return null;
  };

  const showDialog = !!opened;
  const hintWords =
    hint && !say && !showDialog ? "Point at me for settings" : null;

  return (
    <div
      ref={(node) => {
        rootRef.current = node;
        perchRef(node);
      }}
      className="composer-helm"
      data-helm
      // How the dialog was opened, for the real-app check's diagnostics.
      data-open={opened ?? undefined}
      data-pose={pose}
      data-paused={paused || undefined}
      data-fit={fit === "full" ? undefined : fit}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (next && rootRef.current?.contains(next)) return;
        if (next && dialogRef.current?.contains(next)) return;
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
        <MoveUp aria-hidden className="helm-plane-art" />
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
            if (panel) closePanel();
            else if (opened === "pinned" || opened === "keyboard") close(true);
            else {
              setCursor(0);
              setPage("main");
              clearTimer();
              setOpened("pinned");
            }
          }}
          // Tabbing onto the critter only focuses it. Enter and Space press
          // it (its click), and an arrow key opens the dialog the same way.
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setCursor(0);
              setPage("main");
              setOpened("keyboard");
            }
          }}
        >
          <DotMark
            key={hop}
            sigil={mark}
            tone={tone}
            state={POSE_STATE[pose]}
            frame="square"
            className={`helm-critter${hop ? " helm-critter-hop" : ""}`}
          />
        </button>
        {showDialog ? (
          // In a portal, so a short pane never clips it; always above the
          // mark (never flipped over the words), its body scrolling when
          // the room above is short. Inside the perch in React's tree, so
          // moving between the mark and the menu is not leaving.
          <Popover
            anchor={critterRef}
            side="top"
            align="end"
            gap={DIALOG_GAP}
            width={DIALOG_WIDTH}
            flip={false}
            bare
            ref={dialogRef}
            id={dialogId}
            className="helm-dialog"
            role="dialog"
            aria-label="Message settings"
            data-helm-dialog
            data-page={page}
            onPointerEnter={() => clearTimer()}
            onKeyDown={onDialogKey}
          >
            <div className="helm-dialog-frame">
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
          </Popover>
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
      <RowLabel text={label} />
    </button>
  );
}

function subscribeVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

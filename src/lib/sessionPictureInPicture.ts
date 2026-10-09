import type { ComponentProps } from "react";
import type { SessionPane } from "../surfaces/SessionPane";
import type { Session } from "./session";
import type { RecentProject } from "./recents";
import type { AgentModel } from "./models";
import type { NativeCommand } from "./harness/nativeCommands";
import { sanitizeComposerDraft, type ComposerDraft } from "./composerDrafts";

/** Session state and callbacks shared with detached workspace windows. */
export type SessionPaneProps = ComponentProps<typeof SessionPane>;
export const SESSION_PIP_CALLBACKS = [
  "onCwdChange",
  "onBranchChange",
  "onModelChange",
  "onModelSettingsChange",
  "onRuntimeModeChange",
  "onSubmit",
  "onStop",
  "onCompactContext",
  "onDeleteQueuedMessage",
  "onEditQueuedMessage",
  "onQueuedMessageEditingChange",
  "onSteerQueuedMessage",
  "onResumeQueue",
  "onInboxCardDismiss",
  "onNoteCardDismiss",
  "onHandoffCardDismiss",
  "onApproval",
  "onQuestionReply",
  "onOpenFile",
  "onOpenUrl",
  "onOpenDiff",
  "onOpenPlan",
  "onBuildPlan",
  "onSecondOpinion",
  "onHandoff",
  "onNewTerminal",
] as const satisfies readonly (keyof SessionPaneProps)[];
export type SessionPipCallback = (typeof SESSION_PIP_CALLBACKS)[number];
export type SessionPipTheme = {
  scheme: "dark" | "light";
  variables: Record<string, string>;
};
export type SessionPictureInPictureState = {
  session: Session;
  recents: RecentProject[];
  hideProjectPicker?: boolean;
  reviewUndoLocked?: boolean;
  draft?: ComposerDraft;
  theme?: SessionPipTheme;
  actions?: SessionPipCallback[];
  catalog?: AgentModel[];
  catalogVersion?: number;
  nativeCommands?: NativeCommand[];
};
export type SessionPipAction = { id: string; action: string; args: unknown[] };

const THEME_VARIABLES = [
  "--theme-hue",
  "--theme-saturation",
  "--theme-background-color",
  "--theme-light-surface-color",
  "--theme-content-color",
  "--theme-accent-color",
  "--theme-highlight-color",
  "--color-background-base",
  "--color-content",
  "--color-accent",
  "--color-highlight",
  "--background-lightness",
  "--content-lightness",
  "--link-color",
  "--color-skill",
  "--color-mention",
  "--color-markdown-heading",
  "--personal-frame",
  "--personal-main-surface",
  "--personal-accent",
  "--personal-muted",
  "--personal-line",
  "--personal-hover",
  "--personal-selected",
] as const;

export function captureSessionPipTheme(): SessionPipTheme {
  const style = getComputedStyle(
    document.querySelector(".personal-shell") ?? document.documentElement,
  );
  const variables: Record<string, string> = {};
  for (const name of THEME_VARIABLES) {
    const value = style.getPropertyValue(name).trim();
    if (value) variables[name] = value;
  }
  return {
    scheme: document.documentElement.classList.contains("theme-light")
      ? "light"
      : "dark",
    variables,
  };
}

/** Local view styling only; no appearance preferences or native glass settings are written. */
export function applySessionPipTheme(theme?: SessionPipTheme) {
  if (!theme) return;
  const root = document.documentElement;
  root.classList.toggle("theme-light", theme.scheme === "light");
  for (const name of THEME_VARIABLES) {
    const value = theme.variables?.[name];
    if (
      typeof value === "string" &&
      value.length < 1000 &&
      !/url\s*\(|[;{}]/i.test(value)
    )
      root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }
  window.dispatchEvent(
    new CustomEvent("monocode:schemechange", { detail: theme.scheme }),
  );
}

export function validSessionPipAction(
  value: unknown,
  openIds: ReadonlySet<string>,
): value is SessionPipAction {
  if (!value || typeof value !== "object") return false;
  const action = value as Partial<SessionPipAction>;
  if (
    typeof action.id !== "string" ||
    !openIds.has(action.id) ||
    !Array.isArray(action.args)
  )
    return false;
  if (action.action === "draft" || action.action === "quit")
    return (
      action.args.length <= 1 &&
      (action.args[0] == null || !!sanitizeComposerDraft(action.args[0]))
    );
  if (!SESSION_PIP_CALLBACKS.includes(action.action as SessionPipCallback))
    return false;
  if (action.action === "onOpenFile") return typeof action.args[0] === "string";
  if (action.action === "onOpenUrl")
    return (
      typeof action.args[0] === "string" && /^https?:\/\//i.test(action.args[0])
    );
  if (action.action === "onOpenDiff") {
    const session = action.args[1] as { sessionId?: unknown } | undefined;
    return (
      (action.args[0] == null || typeof action.args[0] === "string") &&
      (session == null || session.sessionId === action.id)
    );
  }
  return action.args[0] === action.id;
}

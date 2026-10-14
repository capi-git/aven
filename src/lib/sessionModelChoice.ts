import { dropContextWindow } from "./contextUsage";
import { planComposerSwitch, type ComposerSwitchPlan } from "./handoff";
import { preferredModelSettings, resolveModel } from "./models";
import {
  formatSessionTitle,
  HARNESS_LABEL,
  sessionDisplayTitle,
  type HarnessId,
  type PlanBuildTarget,
  type Session,
} from "./session";

/**
 * A session switched to another provider or model. A new model's context
 * window no longer applies, and another provider cannot resume this one's
 * conversation.
 */
export function withHarnessChoice(
  session: Session,
  harness: HarnessId,
  model: string,
  modelSettings: Record<string, string>,
): Session {
  return {
    ...session,
    harness,
    model,
    modelSettings,
    title:
      session.blocks.length === 0
        ? HARNESS_LABEL[harness]
        : formatSessionTitle(
            harness,
            sessionDisplayTitle(session.title, session.harness),
          ),
    ...(session.model === model
      ? {}
      : { context: dropContextWindow(session.context) }),
    ...(session.harness === harness ? {} : { providerSessionId: undefined }),
  };
}

/** Apply a provider switch plan from `planComposerSwitch` to `next`. */
export function withComposerSwitch(
  next: Session,
  plan: ComposerSwitchPlan,
): Session {
  if (plan.kind === "arm") {
    return { ...next, pendingSwitch: plan.pending };
  }
  if (plan.kind === "revert") {
    return {
      ...next,
      pendingSwitch: undefined,
      ...(plan.restoreProviderSessionId
        ? { providerSessionId: plan.restoreProviderSessionId }
        : { providerSessionId: undefined }),
    };
  }
  if (plan.kind === "empty") {
    return { ...next, pendingSwitch: undefined };
  }
  return next;
}

/** A plan's build step switches the session to the chosen provider and model. */
export function withPlanBuildTarget(
  session: Session,
  target: PlanBuildTarget,
): Session {
  const resolved = resolveModel(target.harness, target.model);
  const modelSettings = preferredModelSettings(resolved, session.modelSettings);
  const plan = planComposerSwitch(session, target.harness);
  const next = withHarnessChoice(
    session,
    target.harness,
    resolved.id,
    modelSettings,
  );
  return withComposerSwitch(next, plan);
}

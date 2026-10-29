import { useCallback, type Dispatch, type SetStateAction } from "react";
import { isPreparingHandoff, planComposerSwitch } from "../lib/handoff";
import { forgetHarnessSession } from "../lib/harness/registry";
import { teammateHarness } from "../lib/projectBotPermissions";
import {
  preferredModelSettings,
  resolveModel,
  saveLastModelSettings,
} from "../lib/models";
import { saveDefaultRuntimeMode, type RuntimeMode } from "../lib/runtimeMode";
import type { HarnessId, Session } from "../lib/session";
import {
  withComposerSwitch,
  withHarnessChoice,
} from "../lib/sessionModelChoice";

/**
 * The composer's provider, model, model settings and runtime mode controls.
 * The callbacks never change identity; detached windows hold them.
 */
export function useSessionModelControls({
  sessionsRef,
  setSessions,
}: {
  sessionsRef: { readonly current: Session[] };
  setSessions: Dispatch<SetStateAction<Session[]>>;
}) {
  const onModelChange = useCallback(
    (sessionId: string, harness: HarnessId, model: string) => {
      const current = sessionsRef.current.find((s) => s.id === sessionId);
      if (!current) return;
      if (isPreparingHandoff(current)) return;
      // A bot's or crew's chat stays on its own app: only that app enforces
      // its rules (sandbox, deny rules, its copy).
      const own = teammateHarness(sessionId);
      if (own && harness !== own) return;
      const resolved = resolveModel(harness, model);
      if (current.modelSettings) {
        saveLastModelSettings(current.modelSettings, "fill");
      }
      const modelSettings = preferredModelSettings(
        resolved,
        current.modelSettings,
      );
      const plan = planComposerSwitch(current, harness);
      if (plan.kind === "empty") {
        void forgetHarnessSession(plan.forget, sessionId);
      }
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          const next = withHarnessChoice(
            s,
            harness,
            resolved.id,
            modelSettings,
          );
          return withComposerSwitch(next, plan);
        }),
      );
    },
    [sessionsRef, setSessions],
  );

  const onModelSettingsChange = useCallback(
    (sessionId: string, modelSettings: Record<string, string>) => {
      saveLastModelSettings(modelSettings);
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, modelSettings } : s)),
      );
    },
    [setSessions],
  );

  const onRuntimeModeChange = useCallback(
    (sessionId: string, runtimeMode: RuntimeMode) => {
      saveDefaultRuntimeMode(runtimeMode);
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, runtimeMode } : s)),
      );
    },
    [setSessions],
  );

  return { onModelChange, onModelSettingsChange, onRuntimeModeChange };
}

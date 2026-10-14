import { useEffect, useRef } from "react";
import {
  devSmokeConfig,
  finishDevSmoke,
  SMOKE_OVERLAY_EVENT,
  SMOKE_OVERLAY_RESULT_EVENT,
  SMOKE_REPLY,
  waitFor,
  type DevSmokeConfig,
  type SmokeStep,
} from "../lib/devSmoke";
import { errorText } from "../lib/errors";
import { nativeFloatingSidebar } from "../lib/floatingSidebar";
import { resolveClaudeBinary } from "../lib/harness/child";
import { sameProjectPath } from "../lib/recents";
import type { Session } from "../lib/session";

type Options = {
  sessions: Session[];
  /** The macOS floating sidebar's overlay, once attached. */
  floatingSidebarLabel: string | null;
  /** Whether this platform attaches the floating sidebar at all. */
  expectFloatingSidebar: boolean;
  newProjectTask: (path: string) => void;
  submit: (sessionId: string, text: string) => void;
};

/** One run per app, even when React mounts the workspace twice. */
let started = false;

/**
 * Aven Dev's real-app check, run by the workspace only when the debug app was
 * launched by `scripts/dev-aven.py --smoke`: send one turn to a stand-in
 * provider through the normal send path with the floating sidebar attached,
 * then have the floating sidebar open Settings and press Back, then report.
 */
export function useDevSmoke(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    const config = devSmokeConfig();
    if (!config || started) return;
    started = true;
    void runDevSmoke(config, () => latest.current);
  }, []);
}

export async function runDevSmoke(
  config: DevSmokeConfig,
  get: () => Options,
): Promise<void> {
  const steps: SmokeStep[] = [];
  const step = async (
    name: string,
    body: () => Promise<string | void>,
  ): Promise<boolean> => {
    try {
      const detail = await body();
      steps.push({ name, passed: true, ...(detail ? { detail } : {}) });
      return true;
    } catch (error) {
      steps.push({ name, passed: false, detail: errorText(error) });
      return false;
    }
  };

  // Never send anything unless Claude is the stand-in: a real `claude` would
  // reach the developer's own account.
  const safe = await step(
    "stand-in provider is the one Aven found",
    async () => {
      const { path } = await resolveClaudeBinary();
      if (!path.startsWith(`${config.binDir}/`))
        throw new Error(`Claude resolved to ${path}, not the stand-in`);
      return path;
    },
  );

  // 0.1.137 broke every turn only once the floating sidebar attached.
  if (get().expectFloatingSidebar)
    await step("floating sidebar attached", async () => {
      await waitFor(
        () => get().floatingSidebarLabel,
        20_000,
        "the floating sidebar",
      );
    });

  if (safe)
    await step("agent turn through the normal send path", async () => {
      get().newProjectTask(config.projectPath);
      const task = await waitFor(
        () =>
          get().sessions.find(
            (session) =>
              session.harness === "claude" &&
              sameProjectPath(session.cwd, config.projectPath),
          ),
        10_000,
        "a Claude task in the check's project",
      );
      get().submit(task.id, "Reply with the smoke word.");
      try {
        await waitFor(
          () => {
            const current = get().sessions.find((s) => s.id === task.id);
            return (
              current &&
              !current.busy &&
              current.blocks.some(
                (block) =>
                  block.role === "assistant" &&
                  block.text.includes(SMOKE_REPLY),
              )
            );
          },
          60_000,
          "the stand-in's reply",
        );
      } catch (error) {
        // Name what the chat showed instead, such as a provider failure.
        const current = get().sessions.find((s) => s.id === task.id);
        const notes = (current?.blocks ?? [])
          .filter((block) => block.role === "system")
          .map((block) => block.text)
          .slice(-2);
        throw new Error(
          notes.length
            ? `${errorText(error)}: ${notes.join(" | ")}`
            : errorText(error),
        );
      }
    });

  const label = get().floatingSidebarLabel;
  if (label)
    await step("floating sidebar opens Settings and goes Back", async () => {
      let stop: (() => void) | undefined;
      const report = new Promise<{ ok: boolean; error?: string }>((resolve) => {
        void nativeFloatingSidebar
          .listen<{ ok: boolean; error?: string }>(
            SMOKE_OVERLAY_RESULT_EVENT,
            resolve,
          )
          .then((unlisten) => (stop = unlisten));
      });
      try {
        await nativeFloatingSidebar.send(label, SMOKE_OVERLAY_EVENT, {});
        // A frozen sidebar never answers; that is the failure we look for.
        const result = await Promise.race([
          report,
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(new Error("The floating sidebar stopped responding")),
              20_000,
            ),
          ),
        ]);
        if (!result.ok) throw new Error(result.error ?? "Failed");
      } finally {
        stop?.();
      }
    });

  await finishDevSmoke(steps);
}

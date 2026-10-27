import { useEffect, useState } from "react";
import {
  hasXcodeProject,
  iosSimPlatform,
  loadIosSimSupport,
} from "../lib/iosSimulator";

/**
 * Whether a project can open the iPhone pane: "ready" with Xcode installed,
 * "needs-xcode" for an Xcode project on a Mac without it, "none" for other
 * projects and other platforms (where nothing about it is shown).
 */
export type IosSimAvailability = "ready" | "needs-xcode" | "none";

export function iosSimAvailability(
  platform: boolean,
  hasProject: boolean,
  xcode: boolean,
): IosSimAvailability {
  if (!platform || !hasProject) return "none";
  return xcode ? "ready" : "needs-xcode";
}

export function useIosSimAvailability(
  project: string | null | undefined,
): IosSimAvailability {
  const [availability, setAvailability] = useState<IosSimAvailability>("none");
  useEffect(() => {
    const platform = iosSimPlatform();
    if (!platform || !project) {
      setAvailability("none");
      return;
    }
    let cancelled = false;
    void Promise.all([hasXcodeProject(project), loadIosSimSupport()])
      .then(([hasProject, support]) => {
        if (!cancelled)
          setAvailability(
            iosSimAvailability(platform, hasProject, support.xcode),
          );
      })
      .catch(() => {
        if (!cancelled) setAvailability("none");
      });
    return () => {
      cancelled = true;
    };
  }, [project]);
  return availability;
}

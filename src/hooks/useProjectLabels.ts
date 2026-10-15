import { useSyncExternalStore } from "react";
import { projectKey, projectName } from "../lib/paths";
import {
  projectLabelRecords,
  subscribeProjectAppearance,
} from "../lib/projectAppearance";
import { resolveTabGroupLabel } from "../lib/tabGroups";

/** Display metadata only: the original path remains the project identity. */
export function projectDisplayName(
  path: string,
  labels: Record<string, string>,
  fallback = projectName(path),
): string {
  return resolveTabGroupLabel(projectKey(path), labels, fallback);
}

/** Saved project names, parsed once per change and shared by every reader. */
export function useProjectLabels(): Record<string, string> {
  return useSyncExternalStore(
    subscribeProjectAppearance,
    projectLabelRecords,
    projectLabelRecords,
  );
}

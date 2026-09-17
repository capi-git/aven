import { useEffect, useState } from "react";
import { projectKey, projectName } from "../lib/paths";
import {
  loadTabGroupLabels,
  resolveTabGroupLabel,
  subscribeTabGroupLabels,
} from "../lib/tabGroups";

/** Display metadata only: the original path remains the project identity. */
export function projectDisplayName(
  path: string,
  labels: Record<string, string>,
  fallback = projectName(path),
): string {
  return resolveTabGroupLabel(projectKey(path), labels, fallback);
}

export function useProjectLabels(): Record<string, string> {
  const [labels, setLabels] = useState(loadTabGroupLabels);
  useEffect(() => {
    const refresh = () => setLabels(loadTabGroupLabels());
    const unsubscribe = subscribeTabGroupLabels(refresh);
    refresh();
    return unsubscribe;
  }, []);
  return labels;
}

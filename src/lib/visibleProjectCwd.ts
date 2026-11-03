/**
 * The project the sidebar shows, and the one a new chat opens in: the active
 * chat's project, else the focused file tab's, else the chosen project. Any
 * other open chat (the first in the list, an earlier one) has no say: it may
 * belong to another project, and a new chat there would open out of sight.
 */
export function visibleProjectCwd(
  activeCwd: string | undefined,
  focusedFileCwd: string | undefined,
  projectCwd: string,
): string {
  return activeCwd ?? focusedFileCwd ?? projectCwd;
}

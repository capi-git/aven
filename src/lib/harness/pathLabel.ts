/** Display the last provider path segment, including remote Windows paths. */
export function basename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "") || path;
  const parts = trimmed.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? trimmed;
}

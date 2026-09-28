/** Keep pinned tabs and one preview, always including the active known tab. */
export function previewTabIds(
  allIds: readonly string[],
  keptIds: ReadonlySet<string>,
  activeId: string,
  previousPreviewId?: string | null,
): { visibleIds: string[]; previewId: string | null } {
  const available = new Set(allIds);
  const eligible = (id: string | null | undefined): id is string =>
    id != null && available.has(id) && !keptIds.has(id);
  let previewId = eligible(activeId)
    ? activeId
    : eligible(previousPreviewId)
      ? previousPreviewId
      : null;
  if (previewId === null && previousPreviewId !== null) {
    for (let index = allIds.length - 1; index >= 0; index -= 1) {
      if (!keptIds.has(allIds[index])) {
        previewId = allIds[index];
        break;
      }
    }
  }
  return {
    visibleIds: allIds.filter((id) => keptIds.has(id) || id === previewId),
    previewId,
  };
}

/** Reorder visible slots without losing or moving tabs hidden in Recent. */
export function mergePreviewTabOrder(
  allIds: readonly string[],
  reorderedVisibleIds: readonly string[],
): string[] {
  const available = new Set(allIds);
  const reordered = [...new Set(reorderedVisibleIds)].filter((id) =>
    available.has(id),
  );
  const remaining = new Set(reordered);
  let index = 0;
  return allIds.map((id) => {
    // Delete also makes malformed duplicate source IDs safe: replace each
    // requested identity once and preserve every other source entry.
    if (!remaining.delete(id)) return id;
    return reordered[index++];
  });
}

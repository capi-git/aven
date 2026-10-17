import { leafIds, type WorkspaceTab } from "./layout";

/**
 * Both split levels matter: a retained offscreen tab or floating placeholder
 * is not a transcript. A discussion's partner has no tab of its own: the
 * chat that started it shows its replies on its card (`companions`: that
 * chat → its partners), and the open discussion panel shows both chats'
 * (`panel`), so either on screen counts as showing them.
 */
export function visibleActivitySessionIds({
  workspaceVisible,
  visibleSurfaceIds,
  tabs,
  sessionIds,
  floatingSessionIds,
  companions,
  panel = [],
}: {
  workspaceVisible: boolean;
  visibleSurfaceIds: readonly string[];
  tabs: readonly WorkspaceTab[];
  sessionIds: ReadonlySet<string>;
  floatingSessionIds: readonly string[];
  companions?: ReadonlyMap<string, readonly string[]>;
  /** The chats of the discussion open in this window's panel. */
  panel?: readonly string[];
}): Set<string> {
  const visible = new Set<string>();
  if (!workspaceVisible) return visible;
  const surfaces = new Set(visibleSurfaceIds);
  const floating = new Set(floatingSessionIds);
  const show = (id: string) => {
    if (!sessionIds.has(id) || floating.has(id)) return;
    visible.add(id);
    for (const partner of companions?.get(id) ?? [])
      if (sessionIds.has(partner) && !floating.has(partner))
        visible.add(partner);
  };
  for (const tab of tabs) {
    if (!surfaces.has(tab.id)) continue;
    for (const id of leafIds(tab.layout)) show(id);
  }
  for (const id of panel) show(id);
  return visible;
}

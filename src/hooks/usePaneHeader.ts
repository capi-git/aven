import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ExplorerMenuItem } from "../chrome/ExplorerMenu";
import {
  hostPaneHeaderMenu,
  paneHeaderMenu,
  paneHeaderMenuHosted,
  paneHeaderSlot,
  setPaneHeaderMenu,
  setPaneHeaderSlot,
  subscribePaneHeaders,
  type PaneHeaderMenu,
  type PaneHeaderSlot,
} from "../lib/paneHeader";

/** The row a pane's title row offers the content of `id`, if any. */
export function usePaneHeaderSlot(
  id: string | null | undefined,
): PaneHeaderSlot | null {
  return useSyncExternalStore(subscribePaneHeaders, () =>
    id ? paneHeaderSlot(id) : null,
  );
}

/** Whether a title row lists the content of `id`'s actions in its "…". */
export function usePaneHeaderMenuHosted(id: string | null | undefined) {
  return useSyncExternalStore(subscribePaneHeaders, () =>
    id ? paneHeaderMenuHosted(id) : false,
  );
}

/**
 * Lists the content of `id`'s secondary actions in its pane's "…". The
 * latest `items` and `pick` are read when the menu opens and is used.
 */
export function useProvidePaneHeaderMenu(
  id: string | null | undefined,
  items: () => ExplorerMenuItem[],
  pick: (item: string) => void,
  pages?: () => Record<string, ExplorerMenuItem[]>,
) {
  const latest = useRef({ items, pick, pages });
  latest.current = { items, pick, pages };
  useLayoutEffect(() => {
    if (!id) return;
    const menu: PaneHeaderMenu = {
      items: () => latest.current.items(),
      pages: () => latest.current.pages?.() ?? {},
      pick: (item) => latest.current.pick(item),
    };
    setPaneHeaderMenu(id, menu);
    return () => {
      if (paneHeaderMenu(id) === menu) setPaneHeaderMenu(id, null);
    };
  }, [id]);
}

/**
 * A title row's side: it hosts the "…" of the surface `id` in front of it
 * and, with `offer`, gives that surface its row. Returns the ref for the
 * row's slot and the surface's listed actions.
 */
export function useHostPaneHeader(
  id: string | null | undefined,
  { host, offer, names }: { host: boolean; offer: boolean; names: boolean },
) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const slotRef = useCallback(
    (node: HTMLElement | null) => setElement(node),
    [],
  );
  useLayoutEffect(() => {
    if (!id || !host) return;
    return hostPaneHeaderMenu(id);
  }, [id, host]);
  useLayoutEffect(() => {
    if (!id || !offer || !element) return;
    setPaneHeaderSlot(id, { element, names });
    return () => {
      if (paneHeaderSlot(id)?.element === element) setPaneHeaderSlot(id, null);
    };
  }, [id, offer, element, names]);
  const menu = useSyncExternalStore(subscribePaneHeaders, () =>
    id && host ? paneHeaderMenu(id) : null,
  );
  return { slotRef, menu };
}

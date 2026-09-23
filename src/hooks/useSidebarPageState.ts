import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import { SESSION_LIST_PAGE } from "../lib/sessionListWindow";

type PageState = {
  tasksExpanded: boolean;
  taskSearchOpen: boolean;
  searchQuery: string;
  sessionListLimit: number;
};
type SavedPage = PageState & { filtersKey: string; profileId: string };
type ScrollPosition = {
  top: number;
  left: number;
  listKey: string;
  filtersKey: string;
  profileId: string;
};

const INITIAL_PAGE: PageState = {
  tasksExpanded: true,
  taskSearchOpen: false,
  searchQuery: "",
  sessionListLimit: SESSION_LIST_PAGE,
};

/** Retain lightweight sidebar state, not another session or component tree. */
export function useSidebarPageState({
  profileId,
  cwd,
  filtersKey,
  profileIds,
}: {
  profileId: string;
  cwd: string;
  filtersKey: string;
  profileIds: readonly string[];
}) {
  const key = JSON.stringify([profileId, cwd]);
  const [pages, setPages] = useState(() => new Map<string, SavedPage>());
  const positions = useRef(new Map<string, ScrollPosition>());
  const saved = pages.get(key);
  // Select the destination state while rendering, before it replaces its preview.
  // A global filter change invalidates pagination, including on inactive pages.
  const page = saved
    ? saved.filtersKey === filtersKey
      ? saved
      : { ...saved, sessionListLimit: SESSION_LIST_PAGE }
    : INITIAL_PAGE;
  const listKey = JSON.stringify([filtersKey, page.searchQuery]);
  const sessionsScrollRef = useRef<HTMLDivElement | null>(null);
  const binding = useRef<{
    node: HTMLDivElement;
    capture: () => void;
    restore: boolean;
  } | null>(null);

  useLayoutEffect(() => {
    // A changed global filter is a new list, even if the user later toggles
    // back to its old value. Do not resurrect old pagination or scroll then.
    setPages((current) => {
      if (
        [...current.values()].every((entry) => entry.filtersKey === filtersKey)
      )
        return current;
      return new Map(
        [...current].map(([id, entry]) => [
          id,
          {
            ...entry,
            filtersKey,
            sessionListLimit: SESSION_LIST_PAGE,
          },
        ]),
      );
    });
    for (const [id, position] of positions.current) {
      if (position.filtersKey !== filtersKey) positions.current.delete(id);
    }
  }, [filtersKey]);

  const setScroller = useCallback(
    (node: HTMLDivElement | null) => {
      const previous = binding.current;
      if (previous) {
        // React may already have shortened the children before detaching this
        // ref. Keep the last user scroll, not a layout-clamped outgoing offset.
        previous.node.removeEventListener("scroll", previous.capture);
      }
      sessionsScrollRef.current = node;
      binding.current = null;
      if (!node) return;
      const capture = () => {
        positions.current.set(key, {
          top: node.scrollTop,
          left: node.scrollLeft,
          listKey,
          filtersKey,
          profileId,
        });
      };
      node.addEventListener("scroll", capture, { passive: true });
      binding.current = { node, capture, restore: true };
    },
    [key, listKey, profileId, filtersKey],
  );

  useLayoutEffect(() => {
    const current = binding.current;
    if (!current?.restore) return;
    current.restore = false;
    const position = positions.current.get(key);
    const retained = position?.listKey === listKey ? position : undefined;
    current.node.scrollTop = retained?.top ?? 0;
    current.node.scrollLeft = retained?.left ?? 0;
    current.capture();
  });

  const update = useCallback(
    <K extends keyof PageState>(
      field: K,
      action: SetStateAction<PageState[K]>,
    ) => {
      setPages((current) => {
        const old = current.get(key);
        const previous = old
          ? old.filtersKey === filtersKey
            ? old
            : { ...old, sessionListLimit: SESSION_LIST_PAGE }
          : INITIAL_PAGE;
        const value =
          typeof action === "function"
            ? (action as (value: PageState[K]) => PageState[K])(previous[field])
            : action;
        if (old?.filtersKey === filtersKey && Object.is(previous[field], value))
          return current;
        const next: SavedPage = {
          ...previous,
          [field]: value,
          filtersKey,
          profileId,
        };
        if (field === "searchQuery" && value !== previous.searchQuery)
          next.sessionListLimit = SESSION_LIST_PAGE;
        return new Map(current).set(key, next);
      });
    },
    [key, filtersKey, profileId],
  );

  const setTasksExpanded = useCallback(
    (value: SetStateAction<boolean>) => update("tasksExpanded", value),
    [update],
  );
  const setTaskSearchOpen = useCallback(
    (value: SetStateAction<boolean>) => update("taskSearchOpen", value),
    [update],
  );
  const setSearchQuery = useCallback(
    (value: SetStateAction<string>) => update("searchQuery", value),
    [update],
  );
  const setSessionListLimit = useCallback(
    (value: SetStateAction<number>) => update("sessionListLimit", value),
    [update],
  );
  const captureScroll = useCallback(() => binding.current?.capture(), []);

  const profileIdentity = profileIds.join("\0");
  useEffect(() => {
    const available = new Set(profileIds);
    setPages((current) => {
      const kept = [...current].filter(([, entry]) =>
        available.has(entry.profileId),
      );
      return kept.length === current.size ? current : new Map(kept);
    });
    for (const [id, position] of positions.current) {
      if (!available.has(position.profileId)) positions.current.delete(id);
    }
  }, [profileIdentity]);

  return {
    ...page,
    setTasksExpanded,
    setTaskSearchOpen,
    setSearchQuery,
    setSessionListLimit,
    sessionsScrollRef,
    setScroller,
    captureScroll,
  };
}

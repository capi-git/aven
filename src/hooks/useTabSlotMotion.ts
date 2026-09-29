import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

/** MonoCode's tab motion: 180ms, eased out. Keep in step with TitleBar.css. */
export const TAB_SLOT_MOTION_MS = 180;

/** A just-closed tab's space, collapsing where the tab used to be. */
export type TabSlotGhost = {
  id: string;
  /** The surviving item it followed, or null at the start of the strip. */
  after: string | null;
  width: number;
};

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Opening and closing motion for a strip of fixed-width tabs, adapted from
 * MonoCode's TabWidthMotion. New items grow in; a closed item leaves a ghost
 * of its last width that collapses, so neighbours slide instead of jumping.
 * Items mark themselves with `data-motion-slot={id}` inside the strip.
 */
export function useTabSlotMotion(
  ids: readonly string[],
  strip: RefObject<HTMLElement | null>,
) {
  const widths = useRef(new Map<string, number>());
  const previous = useRef<readonly string[] | null>(null);
  const [opening, setOpening] = useState<ReadonlySet<string>>(() => new Set());
  const [ghosts, setGhosts] = useState<readonly TabSlotGhost[]>([]);
  const timers = useRef(new Set<number>());
  const key = ids.join("\n");
  useEffect(
    () => () => {
      for (const timer of timers.current) window.clearTimeout(timer);
    },
    [],
  );

  const measure = () => {
    for (const node of strip.current?.querySelectorAll<HTMLElement>(
      "[data-motion-slot]",
    ) ?? []) {
      const id = node.dataset.motionSlot;
      const width = node.getBoundingClientRect().width;
      if (id && width > 1) widths.current.set(id, width);
    }
  };
  // Widths shift with the window and neighbours, so keep them current; a
  // closed tab's DOM is gone by the time it needs one.
  useLayoutEffect(measure);

  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = ids;
    if (!before) return;
    const now = new Set(ids);
    const was = new Set(before);
    const added = ids.filter((id) => !was.has(id));
    const removed = before.filter((id) => !now.has(id));
    // Switching project or window replaces every tab: no motion for that.
    const replaced =
      before.length > 0 && ids.length > 0 && ids.every((id) => !was.has(id));
    if (replaced || reducedMotion() || (!added.length && !removed.length)) {
      for (const id of removed) widths.current.delete(id);
      return;
    }
    if (added.length)
      setOpening((current) => new Set([...current, ...added]));
    // Read widths now: the updater runs later, after they are forgotten.
    const leaving = removed.map((id): TabSlotGhost => {
      const index = before.indexOf(id);
      let after: string | null = null;
      for (let i = index - 1; i >= 0; i--)
        if (now.has(before[i])) {
          after = before[i];
          break;
        }
      return { id, after, width: widths.current.get(id) ?? 0 };
    });
    if (leaving.length)
      setGhosts((current) => [
        ...current.filter((ghost) => !now.has(ghost.id)),
        ...leaving,
      ]);
    for (const id of removed) widths.current.delete(id);
    // Each change settles on its own; a quick second change must not strand
    // the first one's ghost or opening state.
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      setOpening((current) => {
        const next = new Set(current);
        for (const id of added) next.delete(id);
        return next;
      });
      setGhosts((current) =>
        current.filter((ghost) => !removed.includes(ghost.id)),
      );
    }, TAB_SLOT_MOTION_MS);
    timers.current.add(timer);
    // `key` captures every change to `ids`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { opening, ghosts };
}

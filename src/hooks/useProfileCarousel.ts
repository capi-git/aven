import { useLayoutEffect, useRef, type RefObject } from "react";
import type { WorkspaceProfile } from "../lib/workspaceProfiles";

type Options = {
  viewport: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  profiles: readonly WorkspaceProfile[];
  activeProfileId: string;
  onSelectProfile?: (id: string) => void;
};

const DRAG_EXCLUDED =
  "button,a,input,textarea,select,[contenteditable],[draggable=true],[role=slider],[role=separator]";

/**
 * The browser owns wheel movement, momentum and snapping. The workspace
 * changes once the pages come to rest on one, never while they glide:
 * switching workspaces changes the project and its tab, a long frame (about
 * 200 ms with long chats open, measured), which mid-glide froze the swipe.
 * The switch is not forced through inside the scroll event either, so the
 * frame the pages arrive in is drawn first.
 */
export function useProfileCarousel(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const sync = useRef<() => void>(() => {});
  const identity = options.profiles.map((profile) => profile.id).join("\0");

  useLayoutEffect(() => {
    const viewport = latest.current.viewport.current;
    if (!viewport || !options.enabled) return;
    const nativeScrollEnd = Reflect.has(viewport, "onscrollend");
    let timer: ReturnType<typeof setTimeout> | undefined;
    let requested: string | undefined;
    let alignmentTarget: string | undefined;
    const pendingSelections = new Set<string>();
    let rendered = latest.current.activeProfileId;
    // Unknown until the ResizeObserver's first report, which also aligns the
    // selected page; reading clientWidth here would force a layout while the
    // sidebar opens.
    let width = -1;
    let pointer:
      | { id: number; x: number; y: number; left: number; dragging: boolean }
      | undefined;
    const reducedMotion = () =>
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const indexOf = (id: string) =>
      Math.max(
        0,
        latest.current.profiles.findIndex((profile) => profile.id === id),
      );
    const nearest = () => {
      const count = latest.current.profiles.length;
      if (!viewport.clientWidth || !count) return 0;
      // WebKit rubber band offsets can extend beyond either end of the strip.
      const left = Math.max(
        0,
        Math.min(viewport.scrollLeft, (count - 1) * viewport.clientWidth),
      );
      return Math.round(left / viewport.clientWidth);
    };
    const align = (id: string, animated: boolean) => {
      const left = indexOf(id) * viewport.clientWidth;
      const smooth = animated && !reducedMotion();
      // Explicit navigation can animate across intermediate workspace pages.
      // Keep its destination until arrival or the browser ends an interruption.
      alignmentTarget =
        smooth && Math.abs(viewport.scrollLeft - left) > 1 ? id : undefined;
      viewport.scrollTo({
        left,
        behavior: smooth ? "smooth" : "instant",
      });
    };
    const atSnapPoint = () => {
      const width = viewport.clientWidth;
      const left = viewport.scrollLeft;
      return (
        width > 0 &&
        left >= 0 &&
        left <= (latest.current.profiles.length - 1) * width &&
        Math.abs(left - nearest() * width) <= 1
      );
    };
    /** The pages rest on one: make its workspace the current one. */
    const commit = () => {
      clearTimeout(timer);
      if (pointer?.dragging || viewport.clientWidth <= 0) return;
      const current = latest.current;
      const target = current.profiles[nearest()];
      // Use the requested identity while React is still acknowledging a swipe.
      const selected = requested ?? current.activeProfileId;
      if (!target || target.id === selected) return;
      requested = target.id;
      pendingSelections.add(target.id);
      // Outside React's own events this renders after the frame is drawn.
      current.onSelectProfile?.(target.id);
    };
    const onScrollEnd = () => {
      alignmentTarget = undefined;
      commit();
    };
    const onScroll = () => {
      clearTimeout(timer);
      if (
        atSnapPoint() &&
        (!alignmentTarget ||
          latest.current.profiles[nearest()]?.id === alignmentTarget)
      ) {
        alignmentTarget = undefined;
        commit();
        return;
      }
      if (nativeScrollEnd) return;
      // Older WebKit lacks scrollend. Only a snapped page can finish an
      // interrupted explicit navigation; a pause between pages is not arrival.
      timer = setTimeout(() => {
        if (atSnapPoint()) onScrollEnd();
      }, 120);
    };
    sync.current = () => {
      const id = latest.current.activeProfileId;
      if (id === requested) {
        requested = undefined;
        pendingSelections.clear();
        rendered = id;
        return;
      }
      if (id === rendered) return;
      rendered = id;
      if (pendingSelections.has(id)) {
        pendingSelections.delete(id);
        return; // Do not reset scrollLeft or cancel a following swipe.
      }
      requested = undefined;
      pendingSelections.clear();
      clearTimeout(timer);
      align(id, true);
    };
    const observer = new ResizeObserver(() => {
      const nextWidth = viewport.clientWidth;
      if (nextWidth === width) return;
      width = nextWidth;
      clearTimeout(timer);
      // A hidden scroller can lose its offset. Remember the zero-width state
      // so showing it at its previous width still restores the selected page.
      if (nextWidth <= 0) return;
      align(requested ?? latest.current.activeProfileId, false);
    });
    observer.observe(viewport);

    // Mouse dragging remains available on blank space. Trackpad/touch scroll
    // stays entirely native, including when the editor or browser has focus.
    const down = (event: PointerEvent) => {
      if (
        event.button !== 0 ||
        event.pointerType === "touch" ||
        (event.target instanceof Element && event.target.closest(DRAG_EXCLUDED))
      )
        return;
      pointer = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: viewport.scrollLeft,
        dragging: false,
      };
    };
    const move = (event: PointerEvent) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      const dx = event.clientX - pointer.x,
        dy = event.clientY - pointer.y;
      if (!pointer.dragging) {
        if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
          pointer = undefined;
          return;
        }
        if (Math.abs(dx) <= 8 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        pointer.dragging = true;
        viewport.setPointerCapture(event.pointerId);
        viewport.dataset.profileDragging = "true";
      }
      event.preventDefault();
      viewport.scrollLeft = pointer.left - dx;
    };
    const up = (event: PointerEvent) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      const dragged = pointer.dragging;
      pointer = undefined;
      delete viewport.dataset.profileDragging;
      if (viewport.hasPointerCapture(event.pointerId))
        viewport.releasePointerCapture(event.pointerId);
      if (dragged) {
        // Released on a page: no scroll follows, so it is the destination.
        if (atSnapPoint()) {
          commit();
          return;
        }
        // Otherwise the pages glide to the nearest one, which becomes the
        // workspace when they arrive (see onScroll).
        viewport.scrollTo({
          left: nearest() * viewport.clientWidth,
          behavior: reducedMotion() ? "instant" : "smooth",
        });
      }
    };
    const cancelDrag = () => {
      const id = pointer?.id;
      pointer = undefined;
      delete viewport.dataset.profileDragging;
      if (id !== undefined && viewport.hasPointerCapture(id))
        viewport.releasePointerCapture(id);
    };
    window.addEventListener("blur", cancelDrag);
    viewport.addEventListener("scroll", onScroll, { passive: true });
    viewport.addEventListener("scrollend", onScrollEnd);
    viewport.addEventListener("pointerdown", down);
    viewport.addEventListener("pointermove", move);
    viewport.addEventListener("pointerup", up);
    viewport.addEventListener("pointercancel", up);
    viewport.addEventListener("lostpointercapture", up);
    return () => {
      clearTimeout(timer);
      sync.current = () => {};
      observer.disconnect();
      window.removeEventListener("blur", cancelDrag);
      viewport.removeEventListener("scroll", onScroll);
      viewport.removeEventListener("scrollend", onScrollEnd);
      viewport.removeEventListener("pointerdown", down);
      viewport.removeEventListener("pointermove", move);
      viewport.removeEventListener("pointerup", up);
      viewport.removeEventListener("pointercancel", up);
      viewport.removeEventListener("lostpointercapture", up);
      if (pointer && viewport.hasPointerCapture(pointer.id))
        viewport.releasePointerCapture(pointer.id);
      pointer = undefined;
      delete viewport.dataset.profileDragging;
    };
  }, [options.enabled, identity]);

  useLayoutEffect(() => sync.current());
}

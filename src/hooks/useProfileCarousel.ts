import { useLayoutEffect, useRef, type RefObject } from "react";
import { flushSync } from "react-dom";
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

/** The browser owns wheel movement, momentum and snapping. Adopt the dominant
 * page during a swipe, rather than waiting for its slow final snap. */
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
    let width = viewport.clientWidth;
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
    const commit = (dominant = false) => {
      clearTimeout(timer);
      if (pointer?.dragging || viewport.clientWidth <= 0) return;
      const current = latest.current;
      const target = current.profiles[nearest()];
      const selected = requested ?? current.activeProfileId;
      if (!target || target.id === selected) return;
      // Cross 60% to adopt the next page; reversing must cross 40%. The small
      // dead band prevents workspace/theme churn while hovering at halfway.
      // Use the requested identity while React is still acknowledging a swipe.
      if (
        dominant &&
        Math.abs(
          viewport.scrollLeft / viewport.clientWidth - indexOf(selected),
        ) < 0.6
      )
        return;
      requested = target.id;
      pendingSelections.add(target.id);
      // Make the dominant workspace interactive before the next native scroll
      // frame. Flush only the identity handoff, never individual frames.
      flushSync(() => {
        current.onSelectProfile?.(target.id);
      });
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
      if (!alignmentTarget) commit(true);
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
        const left = nearest() * viewport.clientWidth;
        // The destination is decided on release. Activate it before the native
        // snap's easing tail, including when no final scroll event is emitted.
        commit();
        viewport.scrollTo({
          left,
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
    align(rendered, false);
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

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type SyntheticEvent,
} from "react";

export type ImageZoom = number | "fit";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 16;

function clampImageZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

type Anchor = { x: number; y: number; clientX: number; clientY: number };

/**
 * Fit-or-actual-size zoom for one image in a scrolling flex box, shared by
 * the image tab and the image popup. A click toggles between fitting the box and
 * the image's own pixels; when that makes it larger than the box, the box
 * scrolls, and the spot that was clicked stays under the pointer.
 */
export function useImageZoom() {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState<ImageZoom>("fit");
  const scrollerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const anchor = useRef<Anchor | null>(null);

  useLayoutEffect(() => {
    const point = anchor.current;
    anchor.current = null;
    const scroller = scrollerRef.current;
    const image = imageRef.current;
    if (!point || !scroller || !image) return;
    const box = image.getBoundingClientRect();
    if (!box.width || !box.height) return;
    scroller.scrollLeft += box.left + point.x * box.width - point.clientX;
    scroller.scrollTop += box.top + point.y * box.height - point.clientY;
  }, [zoom]);

  const toggle = useCallback((event?: MouseEvent<HTMLImageElement>) => {
    if (event) {
      const box = event.currentTarget.getBoundingClientRect();
      anchor.current =
        box.width && box.height
          ? {
              x: (event.clientX - box.left) / box.width,
              y: (event.clientY - box.top) / box.height,
              clientX: event.clientX,
              clientY: event.clientY,
            }
          : null;
    }
    setZoom((value) => (value === "fit" ? 1 : "fit"));
  }, []);

  const zoomIn = useCallback(
    () =>
      setZoom((value) => clampImageZoom((value === "fit" ? 1 : value) * 1.5)),
    [],
  );
  const zoomOut = useCallback(
    () =>
      setZoom((value) => clampImageZoom((value === "fit" ? 1 : value) / 1.5)),
    [],
  );

  const onLoad = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    setNatural({
      w: event.currentTarget.naturalWidth,
      h: event.currentTarget.naturalHeight,
    });
  }, []);

  const style: CSSProperties | undefined =
    zoom === "fit" || !natural
      ? undefined
      : { width: natural.w * zoom, height: natural.h * zoom };

  return {
    natural,
    zoom,
    setZoom,
    toggle,
    zoomIn,
    zoomOut,
    scrollerRef,
    imageProps: {
      ref: imageRef,
      onLoad,
      onClick: toggle,
      // For a flex box with a definite height: auto margins centre a
      // smaller image and fall to zero for a larger one, so it scrolls to
      // every edge, and a fitted image's max-height resolves against the box.
      className:
        zoom === "fit"
          ? "m-auto flex-none max-h-full max-w-full object-contain"
          : "m-auto flex-none max-w-none object-contain",
      style,
    },
  };
}

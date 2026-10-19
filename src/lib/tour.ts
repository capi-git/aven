/**
 * The short guided tour over the real app. Each stop points at an element
 * tagged `data-tour="…"`; a stop whose element is not on screen is skipped.
 */
export type TourStopId =
  "composer" | "sidebar" | "browser" | "changes" | "board" | "memory";

export type TourStop = {
  id: TourStopId;
  /** `data-tour` values to point at, in order of preference. */
  anchors: readonly string[];
  title: string;
  body: string;
};

export const TOUR_STOPS: readonly TourStop[] = [
  {
    id: "composer",
    anchors: ["composer"],
    title: "Ask your agent",
    body: "Type what you want built. The + menu adds Plan mode, Orchestrator, Discuss and Race. The pill picks the agent and model.",
  },
  {
    id: "sidebar",
    anchors: ["projects"],
    title: "Projects and chats",
    body: "Each project keeps its chats here. A word on a chat says where it stands: Working, Needs you, Review or Shipped.",
  },
  {
    id: "browser",
    anchors: ["browser-pane", "browser-button"],
    title: "Preview it",
    body: "Preview your app beside the chat. Mark up lets you draw on the page and send the picture to the chat.",
  },
  {
    id: "changes",
    anchors: ["changes"],
    title: "Review and ship",
    body: "The side panel's Changes shows what your agents changed. Ship it commits the change, with a message written for you.",
  },
  {
    id: "board",
    anchors: ["board", "activity"],
    title: "Board and Activity",
    body: "The board holds features you want. Build hands one to an agent, and it moves to Shipped by itself. Activity lists what finished and what needs you.",
  },
  {
    id: "memory",
    anchors: ["project-active", "project"],
    title: "Project memory",
    body: "Open a project's menu and choose Project memory to write down what every agent in it should know first.",
  },
];

/** Ask the workspace to run the tour again (Help menu, Settings). */
export const TOUR_START_EVENT = "aven:start-tour";

export function startTour(): void {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(TOUR_START_EVENT));
}

export type TourRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};
export type TourSize = { width: number; height: number };
export type TourSide = "top" | "bottom" | "left" | "right";
export type TourPlacement = { left: number; top: number; side: TourSide };

/** Space kept between the popover and the window's edge. */
export const TOUR_EDGE = 12;
/** Space between the spotlight and the popover. */
export const TOUR_GAP = 14;

/** Is any part of `rect` inside the window, and big enough to point at? */
export function tourRectOnScreen(rect: TourRect, viewport: TourSize): boolean {
  return (
    rect.width >= 4 &&
    rect.height >= 4 &&
    rect.left < viewport.width &&
    rect.top < viewport.height &&
    rect.left + rect.width > 0 &&
    rect.top + rect.height > 0
  );
}

/** The part of `rect` inside the window. */
export function clipTourRect(rect: TourRect, viewport: TourSize): TourRect {
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(viewport.width, rect.left + rect.width);
  const bottom = Math.min(viewport.height, rect.top + rect.height);
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Where the popover goes beside its spotlight: the first side that fits it
 * (beside a tall target, above or below a wide one), centred on the target
 * and kept inside the window. A
 * target that fills the window (nothing fits beside it) gets the popover
 * inside its bottom edge.
 */
export function placeTourPopover(
  target: TourRect,
  popover: TourSize,
  viewport: TourSize,
  gap = TOUR_GAP,
): TourPlacement {
  const room: Record<TourSide, number> = {
    top: target.top - gap - TOUR_EDGE,
    bottom: viewport.height - (target.top + target.height) - gap - TOUR_EDGE,
    left: target.left - gap - TOUR_EDGE,
    right: viewport.width - (target.left + target.width) - gap - TOUR_EDGE,
  };
  const fits = (side: TourSide) =>
    side === "top" || side === "bottom"
      ? room[side] >= popover.height
      : room[side] >= popover.width;
  // Beside a tall target (the sidebar), above or below a wide one.
  const order: TourSide[] =
    target.height > target.width
      ? ["right", "left", "bottom", "top"]
      : ["top", "bottom", "right", "left"];
  const side = order.find(fits) ?? null;
  const centreX = target.left + target.width / 2 - popover.width / 2;
  const centreY = target.top + target.height / 2 - popover.height / 2;
  const maxLeft = viewport.width - popover.width - TOUR_EDGE;
  const maxTop = viewport.height - popover.height - TOUR_EDGE;
  if (!side) {
    return {
      side: "bottom",
      left: clamp(centreX, TOUR_EDGE, maxLeft),
      top: clamp(
        target.top + target.height - popover.height - gap,
        TOUR_EDGE,
        maxTop,
      ),
    };
  }
  switch (side) {
    case "top":
      return {
        side,
        left: clamp(centreX, TOUR_EDGE, maxLeft),
        top: target.top - gap - popover.height,
      };
    case "bottom":
      return {
        side,
        left: clamp(centreX, TOUR_EDGE, maxLeft),
        top: target.top + target.height + gap,
      };
    case "left":
      return {
        side,
        left: target.left - gap - popover.width,
        top: clamp(centreY, TOUR_EDGE, maxTop),
      };
    case "right":
      return {
        side,
        left: target.left + target.width + gap,
        top: clamp(centreY, TOUR_EDGE, maxTop),
      };
  }
}

/**
 * The next stop to show from `from` going `direction`, skipping the ones
 * `available` rejects; null when there is none that way.
 */
export function nextTourIndex(
  count: number,
  from: number,
  direction: 1 | -1,
  available: (index: number) => boolean,
): number | null {
  for (
    let index = from + direction;
    index >= 0 && index < count;
    index += direction
  ) {
    if (available(index)) return index;
  }
  return null;
}

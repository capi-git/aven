import { isRailed, type LayoutNode } from "./layout";

/**
 * Native browser pages in layout motions. A Chromium page is a native view
 * above the HTML workspace: WebKit cannot move, scale or fade it, so a pane
 * gliding to a new place would leave its page behind and the page would
 * jump. For a motion (a pane expanding or restoring, a split opening, a
 * switch between strip entries) each page involved is captured as an image,
 * the image stands in its pane and moves with it, and the live page comes
 * back at its final bounds once the motion ends.
 *
 * Capture takes a native round trip. A page that is not held by the
 * deadline is left live, so a motion never waits long for one. A page that
 * is not showing (a pane coming into view) uses the last image taken of it,
 * when there is one.
 */

/** How long a motion waits for its pages to be captured and held. */
export const MOTION_CAPTURE_DEADLINE_MS = 80;
/** Last images kept for pages that come back into view. */
const IMAGE_CACHE_SIZE = 6;

export type MotionPage = {
  /** A picture of the live page now, or null when it is not showing. */
  capture(): Promise<string | null>;
  /**
   * Put the picture in the page's place and hide the live page, unless the
   * motion has stopped waiting for it (`wanted`) by then.
   */
  hold(src: string, wanted: () => boolean): Promise<boolean>;
  /**
   * Put the picture beneath the live page, unseen, unless it is no longer
   * `wanted` by then. Resolves true once it is painted there.
   */
  layBeneath(src: string, wanted: () => boolean): Promise<boolean>;
  /** Show the picture laid beneath in the page's place, the page unmoved. */
  cutOut(): void;
  /** Show the live page at its final bounds, then drop the picture. */
  release(): Promise<void>;
};

const pages = new Map<string, MotionPage>();
const images = new Map<string, string>();
/**
 * The motion each held page is held for: a second motion takes over a page
 * still held, and the first one's timer no longer lets it go mid-motion.
 */
const holds = new Map<string, number>();
let lastHold = 0;

/** A browser pane offers its page for motions while it is mounted. */
export function registerMotionPage(id: string, page: MotionPage): () => void {
  pages.set(id, page);
  return () => {
    if (pages.get(id) !== page) return;
    pages.delete(id);
    images.delete(id);
    holds.delete(id);
  };
}

/** The page changed: the picture of it no longer stands for it. */
export function forgetMotionImage(id: string) {
  images.delete(id);
}

function remember(id: string, src: string) {
  images.delete(id);
  images.set(id, src);
  while (images.size > IMAGE_CACHE_SIZE) {
    const oldest = images.keys().next().value;
    if (oldest === undefined) break;
    images.delete(oldest);
  }
}

/** The last image taken of a page, if any. */
export function lastMotionImage(id: string): string | undefined {
  return images.get(id);
}

/**
 * Hold pages still for a motion: `live` pages are captured now, `incoming`
 * pages (not showing yet) use their last image. A page a motion still holds
 * stays held for this one, on the picture it has. Resolves with the pages
 * held by the deadline; any finishing later are let go at once.
 */
export async function holdMotionPages(
  live: readonly string[],
  incoming: readonly string[] = [],
  deadline = MOTION_CAPTURE_DEADLINE_MS,
): Promise<string[]> {
  const hold = ++lastHold;
  const held: string[] = [];
  let open = true;
  const taken = [...new Set([...live, ...incoming])].filter(
    (id) => holds.has(id) && pages.has(id),
  );
  for (const id of taken) {
    holds.set(id, hold);
    held.push(id);
  }
  const free = (id: string) => !taken.includes(id);
  const keep = async (id: string, page: MotionPage, src: string) => {
    const ok = await page.hold(src, () => open).catch(() => false);
    if (!ok) return;
    if (!open) {
      void page.release();
      return;
    }
    holds.set(id, hold);
    held.push(id);
    remember(id, src);
  };
  const tasks = [
    ...[...new Set(live)].filter(free).map(async (id) => {
      const page = pages.get(id);
      if (!page) return;
      const src = await page.capture().catch(() => null);
      if (src && open) await keep(id, page, src);
    }),
    ...[...new Set(incoming)]
      .filter((id) => !live.includes(id) && free(id))
      .map(async (id) => {
        const page = pages.get(id);
        const src = images.get(id);
        if (page && src) await keep(id, page, src);
      }),
  ];
  if (!tasks.length) return held;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all(tasks),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, deadline);
    }),
  ]);
  clearTimeout(timer);
  open = false;
  return [...held];
}

/** Held pages go back live this long after their motion should end. */
export const MOTION_RELEASE_SLACK_MS = 30;

/** Hand held pages back live once a motion of `ms` has run. */
export function releaseMotionPagesAfter(ids: readonly string[], ms: number) {
  if (!ids.length) return;
  const heldFor = ids.map((id) => holds.get(id));
  setTimeout(
    () =>
      // One that a later motion took over is that motion's to let go.
      releaseMotionPages(ids.filter((id, at) => holds.get(id) === heldFor[at])),
    ms + MOTION_RELEASE_SLACK_MS,
  );
}

/** Hand held pages back live. */
export function releaseMotionPages(ids: readonly string[]) {
  for (const id of ids) {
    holds.delete(id);
    void pages.get(id)?.release();
  }
}

/**
 * Hold the pages showing for a drag that moves them on each frame: all of them
 * for a panel's edge, or just those in `only`, for a drag that leaves the rest
 * where they are. A live page takes its new place a frame apart from the
 * workspace around it and draws at its new width a frame after that, so it
 * would shake against the workspace until the drag ends. The pictures are laid
 * beneath the pages on press, ready for the first move; a press that never
 * moves shows none of them. The pages stay live underneath, at the size they
 * will come back at, so they come back drawn.
 */
export function holdPagesForDrag(only?: readonly string[]): {
  moved(): void;
  end(): void;
} {
  const hold = ++lastHold;
  const ready: string[] = [];
  let dragging = true;
  let moving = false;
  for (const [id, page] of pages) {
    if (holds.has(id) || (only && !only.includes(id))) continue;
    void (async () => {
      const src = await page.capture();
      if (!src || !dragging) return;
      const laid = await page.layBeneath(src, () => dragging);
      if (!laid) return;
      if (!dragging) {
        void page.release();
        return;
      }
      holds.set(id, hold);
      ready.push(id);
      remember(id, src);
      if (moving) page.cutOut();
    })().catch(() => {});
  }
  return {
    moved() {
      if (moving) return;
      moving = true;
      for (const id of ready) pages.get(id)?.cutOut();
    },
    end() {
      dragging = false;
      releaseMotionPages(ready.filter((id) => holds.get(id) === hold));
    },
  };
}

type Box = { left: number; top: number; width: number; height: number };

/** Each open pane's share of the stage; rails take no place of their own. */
function paneBoxes(
  node: LayoutNode,
  box: Box = { left: 0, top: 0, width: 1, height: 1 },
  boxes = new Map<string, Box>(),
) {
  if (isRailed(node)) return boxes;
  if (node.type === "leaf") {
    boxes.set(node.id, box);
    return boxes;
  }
  const total = node.sizes.reduce((sum, size) => sum + size, 0) || 1;
  let start = 0;
  node.children.forEach((child, index) => {
    const share = (node.sizes[index] ?? 0) / total;
    paneBoxes(
      child,
      node.dir === "right"
        ? {
            ...box,
            left: box.left + box.width * start,
            width: box.width * share,
          }
        : {
            ...box,
            top: box.top + box.height * start,
            height: box.height * share,
          },
      boxes,
    );
    start += share;
  });
  return boxes;
}

/**
 * The panes a layout change moves or resizes. A pane that keeps its place is
 * left alone, so its page stays live and sharp through the change.
 */
export function panesMoved(before: LayoutNode, after: LayoutNode): Set<string> {
  const was = paneBoxes(before);
  const moved = new Set<string>();
  for (const [id, box] of paneBoxes(after)) {
    const from = was.get(id);
    if (
      !from ||
      Math.abs(from.left - box.left) > 1e-4 ||
      Math.abs(from.top - box.top) > 1e-4 ||
      Math.abs(from.width - box.width) > 1e-4 ||
      Math.abs(from.height - box.height) > 1e-4
    )
      moved.add(id);
  }
  return moved;
}

/** Test-only reset. */
export function resetMotionPages() {
  pages.clear();
  images.clear();
  holds.clear();
  lastHold = 0;
}

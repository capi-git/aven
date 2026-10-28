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
  /** Put the picture in the page's place and hide the live page. */
  hold(src: string): Promise<boolean>;
  /** Show the live page at its final bounds, then drop the picture. */
  release(): Promise<void>;
};

const pages = new Map<string, MotionPage>();
const images = new Map<string, string>();

/** A browser pane offers its page for motions while it is mounted. */
export function registerMotionPage(id: string, page: MotionPage): () => void {
  pages.set(id, page);
  return () => {
    if (pages.get(id) !== page) return;
    pages.delete(id);
    images.delete(id);
  };
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
 * pages (not showing yet) use their last image. Resolves with the pages
 * held by the deadline; any finishing later are let go at once.
 */
export async function holdMotionPages(
  live: readonly string[],
  incoming: readonly string[] = [],
  deadline = MOTION_CAPTURE_DEADLINE_MS,
): Promise<string[]> {
  const held: string[] = [];
  let open = true;
  const keep = async (id: string, page: MotionPage, src: string) => {
    const ok = await page.hold(src).catch(() => false);
    if (!ok) return;
    if (!open) {
      void page.release();
      return;
    }
    held.push(id);
    remember(id, src);
  };
  const tasks = [
    ...[...new Set(live)].map(async (id) => {
      const page = pages.get(id);
      if (!page) return;
      const src = await page.capture().catch(() => null);
      if (src && open) await keep(id, page, src);
    }),
    ...[...new Set(incoming)]
      .filter((id) => !live.includes(id))
      .map(async (id) => {
        const page = pages.get(id);
        const src = images.get(id);
        if (page && src) await keep(id, page, src);
      }),
  ];
  if (!tasks.length) return [];
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
  setTimeout(() => releaseMotionPages(ids), ms + MOTION_RELEASE_SLACK_MS);
}

/** Hand held pages back live. */
export function releaseMotionPages(ids: readonly string[]) {
  for (const id of ids) void pages.get(id)?.release();
}

/** Test-only reset. */
export function resetMotionPages() {
  pages.clear();
  images.clear();
}

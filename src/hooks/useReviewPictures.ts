import { useEffect, useState } from "react";
import { tryCrewBatch } from "../lib/crewActions";
import { devPreviewsSnapshot, liveServersFor } from "../lib/devPreviews";
import {
  pageAddress,
  takePagePicture,
  type PagePicture,
  type PictureSize,
} from "../lib/pagePictures";

/**
 * Before and after pictures of the pages Avos changed, for its Review's
 * Look tab: after from Avos's copy, run for it (see `tryCrewBatch`) only
 * once you've asked for it (`run`), and before from your own app, when it
 * is running. Taken once per change, page and size, and kept while Aven
 * runs.
 */

/** A picture, or null when it couldn't be taken. */
export type ReviewPair = {
  before: PagePicture | null;
  after: PagePicture | null;
};

export type ReviewPictures = {
  /**
   * `idle` waits for you to run Avos's version; `starting` while it starts,
   * `working` while the pictures are taken.
   */
  status: "idle" | "starting" | "working" | "ready" | "failed";
  /** Why there are no pictures (Avos's copy didn't run, say). */
  problem?: string;
  /** Your app isn't running, so there's nothing to picture as before. */
  noBefore?: boolean;
  /** Each page's pair, by page, once taken. */
  pairs: Readonly<Record<string, ReviewPair>>;
};

const kept = new Map<string, ReviewPair>();
const KEPT_MAX = 60;

function keep(key: string, pair: ReviewPair) {
  kept.delete(key);
  kept.set(key, pair);
  while (kept.size > KEPT_MAX) kept.delete(kept.keys().next().value!);
}

/** Your own app's address for `project`, when it is running in Aven. */
export function ownAppAddress(project: string): string | undefined {
  return liveServersFor(devPreviewsSnapshot(), { cwd: project, project })[0]
    ?.url;
}

export function useReviewPictures(input: {
  project: string;
  /** Only while the Look tab shows, and the change shown is the one read. */
  active: boolean;
  /** You asked to run Avos's version of this change: never started without. */
  run: boolean;
  to: string | undefined;
  hash: string | undefined;
  pages: readonly string[];
  /** Each page's spots to find (selectors), from its Builder. */
  marks?: Readonly<Record<string, readonly string[]>>;
  size: PictureSize;
}): ReviewPictures {
  const { project, active, run, to, hash, size } = input;
  const pages = input.pages.join("\n");
  const marks = JSON.stringify(input.marks ?? {});
  const [state, setState] = useState<ReviewPictures>({
    status: "idle",
    pairs: {},
  });
  useEffect(() => {
    if (!active || !to || !hash || !pages) return;
    let live = true;
    const list = pages.split("\n");
    const spots = JSON.parse(marks) as Record<string, string[]>;
    const own = ownAppAddress(project);
    const key = (page: string) =>
      `${to}\n${size}\n${page}\n${own ?? ""}\n${(spots[page] ?? []).join("\n")}`;
    const known = () =>
      Object.fromEntries(
        list.flatMap((page) => {
          const pair = kept.get(key(page));
          return pair ? [[page, pair] as const] : [];
        }),
      );
    if (list.every((page) => kept.has(key(page)))) {
      setState({ status: "ready", noBefore: !own, pairs: known() });
      return;
    }
    if (!run) {
      setState({ status: "idle", noBefore: !own, pairs: known() });
      return;
    }
    setState({ status: "starting", noBefore: !own, pairs: known() });
    void (async () => {
      const tried = await tryCrewBatch(project, { to, hash });
      if (!live) return;
      if ("error" in tried) {
        setState({ status: "failed", problem: tried.error, pairs: {} });
        return;
      }
      setState((current) => ({ ...current, status: "working" }));
      for (const page of list) {
        if (kept.has(key(page))) continue;
        const after = await takePagePicture(
          pageAddress(tried.url, page),
          size,
          spots[page] ?? [],
        ).catch(() => null);
        const before = own
          ? await takePagePicture(pageAddress(own, page), size).catch(
              () => null,
            )
          : null;
        keep(key(page), { before, after });
        if (!live) return;
        setState((current) => ({
          ...current,
          pairs: { ...current.pairs, [page]: { before, after } },
        }));
      }
      if (live)
        setState((current) => ({
          ...current,
          status: "ready",
          noBefore: !own,
        }));
    })();
    return () => {
      live = false;
    };
  }, [active, run, to, hash, pages, marks, size, project]);
  return state;
}

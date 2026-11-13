import {
  nativeBrowserPresentation,
  type BrowserPresentationAdapter,
} from "./browserPresentation";
import { round, spread, type Spread } from "./devPerf";

/** What a page's pane asked of its native page, and when (ms, page clock). */
export type PageEvent =
  | {
      kind: "layout";
      asked: number;
      answered: number;
      visible: boolean;
      holes: number;
      shaded: boolean;
    }
  | {
      kind: "still";
      asked: number;
      answered: number;
      kB: number;
      failed: boolean;
    }
  /** The still picture beneath the page came or went. */
  | { kind: "picture"; at: number; shown: boolean; scale?: number };

const PICTURE = ".browser-page-snapshot";

/**
 * Record what every page's pane sends its native page, and when a still
 * picture stands in for it. The speed test's "popups over a web page"
 * reads these: a popup is only whole on screen once the page above the
 * interface is hidden, cut or shaded for it.
 */
export function recordPageEvents(
  adapter: BrowserPresentationAdapter = nativeBrowserPresentation,
) {
  const events: PageEvent[] = [];
  const original = { layout: adapter.layout, snapshot: adapter.snapshot };
  let inFlight = 0;
  let lastAt = performance.now();
  adapter.layout = async (id, bounds, visible) => {
    const asked = performance.now();
    inFlight += 1;
    try {
      await original.layout(id, bounds, visible);
    } finally {
      inFlight -= 1;
      lastAt = performance.now();
      events.push({
        kind: "layout",
        asked,
        answered: lastAt,
        visible,
        holes: bounds.holes?.length ?? 0,
        shaded: !!bounds.shade,
      });
    }
  };
  adapter.snapshot = async (id) => {
    const asked = performance.now();
    inFlight += 1;
    let src = "";
    try {
      src = await original.snapshot(id);
      return src;
    } finally {
      inFlight -= 1;
      lastAt = performance.now();
      events.push({
        kind: "still",
        asked,
        answered: lastAt,
        kB: Math.round(src.length / 1024),
        failed: !src,
      });
    }
  };
  let shown = !!document.querySelector(PICTURE);
  const pictures = new MutationObserver(() => {
    const picture = document.querySelector<HTMLImageElement>(PICTURE);
    if (!!picture === shown) return;
    shown = !!picture;
    lastAt = performance.now();
    // Below 1, the picture has fewer pixels than the page it stands in for.
    const scale =
      picture && picture.naturalWidth && picture.offsetWidth
        ? round(
            picture.naturalWidth /
              (picture.offsetWidth * window.devicePixelRatio),
            2,
          )
        : undefined;
    events.push({ kind: "picture", at: lastAt, shown, scale });
  });
  pictures.observe(document.body, { childList: true, subtree: true });
  return {
    /** Nothing asked and nothing answered for `quietMs`. */
    quiet: (quietMs: number) =>
      inFlight === 0 && performance.now() - lastAt >= quietMs,
    /** The events so far, removed from the record. */
    take: () => events.splice(0),
    stop() {
      pictures.disconnect();
      adapter.layout = original.layout;
      adapter.snapshot = original.snapshot;
    },
  };
}

/** One popup opened and closed over a page. */
export type PagePopupRound = {
  /** Input until the page first made room for the popup. */
  openMs: number | null;
  /** Input until the live page was whole again. */
  closeMs: number | null;
  /** How it made room: the page was hidden, cut around the popup, or shaded. */
  how: "hidden" | "cut" | "shaded" | "nothing";
  /** Still pictures taken of the page, and how long the slowest took. */
  stills: number;
  stillMs: number;
  stillKB: number;
  /** The page was hidden with no picture beneath it for this long. */
  blankMs: number;
  /** Picture pixels per page pixel, when a picture stood in. */
  pictureScale?: number;
};

/** Read one open and one close out of what the page's pane did. */
export function pagePopupRound(
  opened: number,
  openEvents: PageEvent[],
  closed: number,
  closeEvents: PageEvent[],
): PagePopupRound {
  const layouts = (events: PageEvent[]) =>
    events.filter((event) => event.kind === "layout");
  const made = layouts(openEvents).find(
    (event) => !event.visible || event.holes > 0 || event.shaded,
  );
  const whole = layouts(closeEvents).find(
    (event) => event.visible && event.holes === 0 && !event.shaded,
  );
  const stills = [...openEvents, ...closeEvents].filter(
    (event) => event.kind === "still",
  );
  const hidden = layouts(openEvents).find((event) => !event.visible);
  let blankMs = 0;
  if (hidden) {
    const all = [...openEvents, ...closeEvents];
    const pictureAt = (at: number) =>
      all
        .filter((event) => event.kind === "picture" && event.at <= at)
        .at(-1) as Extract<PageEvent, { kind: "picture" }> | undefined;
    if (!pictureAt(hidden.answered)?.shown) {
      const next = all.find(
        (event) =>
          (event.kind === "picture" &&
            event.shown &&
            event.at > hidden.answered) ||
          (event.kind === "layout" &&
            event.visible &&
            event.answered > hidden.answered),
      );
      const until =
        next?.kind === "picture"
          ? next.at
          : next?.kind === "layout"
            ? next.answered
            : hidden.answered;
      blankMs = until - hidden.answered;
    }
  }
  const picture = [...openEvents, ...closeEvents].find(
    (event) => event.kind === "picture" && event.shown,
  ) as Extract<PageEvent, { kind: "picture" }> | undefined;
  return {
    openMs: made ? round(made.answered - opened) : null,
    closeMs: whole ? round(whole.answered - closed) : null,
    how: !made
      ? "nothing"
      : !made.visible
        ? "hidden"
        : made.shaded
          ? "shaded"
          : "cut",
    stills: stills.length,
    stillMs: round(
      Math.max(0, ...stills.map((still) => still.answered - still.asked)),
    ),
    stillKB: Math.max(
      0,
      ...stills.map((still) => (still.kind === "still" ? still.kB : 0)),
    ),
    blankMs: round(blankMs),
    ...(picture?.scale ? { pictureScale: picture.scale } : {}),
  };
}

/** A popup's rounds, summed up for the report. */
export type PagePopupResult = {
  popup: string;
  rounds: number;
  how: string;
  openMs?: Spread;
  closeMs?: Spread;
  stills: number;
  stillMs?: Spread;
  stillKB: number;
  blankMs?: Spread;
  pictureScale?: number;
};

export function pagePopupResult(
  popup: string,
  rounds: PagePopupRound[],
): PagePopupResult {
  const numbers = (values: (number | null)[]) =>
    values.filter((value): value is number => value !== null);
  const some = (values: number[]) =>
    values.length ? spread(values) : undefined;
  const taken = rounds.filter((round) => round.stills > 0);
  return {
    popup,
    rounds: rounds.length,
    how: [...new Set(rounds.map((round) => round.how))].join(", "),
    openMs: some(numbers(rounds.map((round) => round.openMs))),
    closeMs: some(numbers(rounds.map((round) => round.closeMs))),
    stills: rounds.reduce((sum, round) => sum + round.stills, 0),
    stillMs: some(taken.map((round) => round.stillMs)),
    stillKB: Math.max(0, ...rounds.map((round) => round.stillKB)),
    blankMs: some(
      rounds.filter((round) => round.how === "hidden").map((r) => r.blankMs),
    ),
    pictureScale: rounds.find((round) => round.pictureScale)?.pictureScale,
  };
}

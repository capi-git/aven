import { invoke } from "@tauri-apps/api/core";
import { waitFor } from "./devSmoke";
import { viewportRect } from "./drag";
import { loadUiScale } from "./uiScale";

/**
 * Aven Dev's real-app check of a lone tab's header (0.1.155 left a page
 * alone in a pane of a split with nothing to move it by): a page alone in
 * one pane of two is clicked and dragged by its title, as a person would.
 *
 * The mouse is the Mac's own: the workspace's web view gets AppKit mouse
 * events (`dev_smoke_pointer`, debug builds only), so WebKit makes trusted
 * pointer and mouse events with their default actions, a press focusing a
 * field unless the page prevents it. Events made by script are never
 * trusted and have no default actions, so they could not show that the
 * address keeps its focus behaviour.
 */
export type SmokeLoneTab = {
  /** Bring a tab to the front, as its strip tab does. */
  select: (id: string) => void;
  /** Split the tab `id` off beside the pane `beside`, at its `edge`. */
  split: (id: string, edge: "left" | "right", beside: string) => void;
  /** The panes on screen, each as the tabs it holds. */
  panes: () => string[][];
  /** The window strip's entries: a single tab, or a split's tabs. */
  strip: () => Array<{ id: string } | { split: string[] }>;
  /** Close a page. */
  closePage: (id: string) => void;
};

type LoneTabOptions = {
  newProjectTask: (path: string) => void;
  openWebLink?: (url: string) => void | Promise<void>;
  focusedSurfaceId?: string;
  loneTab?: SmokeLoneTab;
};

type Point = { x: number; y: number };

/**
 * The middle of an element in the viewport's pixels, where a press at it
 * lands (`dev_smoke_pointer` and `elementFromPoint` take these), on either
 * kind of CSS zoom: older WebKit reports the rects of the window strip,
 * which cancels the interface zoom with CSS zoom, divided by that zoom.
 */
export function pressPoint(element: HTMLElement): Point {
  const box = viewportRect(element, element.getBoundingClientRect());
  return { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
}

/**
 * The points a hand passes through from `from` to `to`: a first step past
 * the drag threshold, then even steps, ending on `to`.
 */
export function dragPath(from: Point, to: Point, steps = 10): Point[] {
  const points: Point[] = [{ x: from.x + 8, y: from.y + 2 }];
  for (let step = 1; step <= steps; step += 1) {
    const share = step / steps;
    points.push({
      x: from.x + (to.x - from.x) * share,
      y: from.y + (to.y - from.y) * share,
    });
  }
  return points;
}

/** Why `page` is not in the pane that holds `chat`, or null. */
export function joinedProblem(
  panes: readonly (readonly string[])[],
  chat: string,
  page: string,
): string | null {
  const holder = panes.find((pane) => pane.includes(chat));
  if (!holder) return "the chat's pane is gone";
  if (!holder.includes(page))
    return `the page is not in the chat's pane (panes: ${JSON.stringify(panes)})`;
  return null;
}

/** Why `page` does not stand alone on the window strip, or null. */
export function strippedProblem(
  strip: ReturnType<SmokeLoneTab["strip"]>,
  page: string,
): string | null {
  if (strip.some((entry) => "id" in entry && entry.id === page)) return null;
  if (strip.some((entry) => "split" in entry && entry.split.includes(page)))
    return "the page is still in a split on the strip";
  return "the page is not on the strip";
}

const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
/**
 * A painted frame, or 100 ms: WebKit paints none for a window that is
 * hidden, covered or on another Space, and the check must not wait forever.
 */
export const frame = () =>
  Promise.race([
    new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    pause(100),
  ]);

/**
 * One press, move or release of the Mac's own mouse at `at`, client pixels.
 * With `settle` false it returns as soon as the event is posted, so the
 * next one follows at once (a release with no rest before it).
 */
export async function smokeMouse(
  kind: "down" | "drag" | "up",
  at: Point,
  { settle = true }: { settle?: boolean } = {},
) {
  await invoke("dev_smoke_pointer", {
    kind,
    x: at.x,
    y: at.y,
    zoom: loadUiScale(),
  });
  if (!settle) return;
  // Let WebKit deliver it and the drag's frame run.
  await frame();
  await frame();
}

/**
 * Where along the strip `box` a tab let go stands after its last entry
 * (`entries`, in order): in the room after it, or else just inside its far
 * edge, in the band that moves a tab rather than combining with it.
 */
export function slotAfterLast(
  box: { left: number; right: number },
  entries: readonly { left: number; right: number }[],
): number {
  const last = entries.at(-1);
  if (!last) return (box.left + box.right) / 2;
  const end = Math.min(last.right, box.right);
  if (box.right - end >= 24) return (end + box.right) / 2;
  return end - 4;
}

/** Where the strip holds `id`: alone, in a split, or nowhere (null). */
export function stripPlace(
  strip: ReturnType<SmokeLoneTab["strip"]>,
  id: string,
): "alone" | "split" | null {
  for (const entry of strip) {
    if ("id" in entry && entry.id === id) return "alone";
    if ("split" in entry && entry.split.includes(id)) return "split";
  }
  return null;
}

/** The notice after a move, while it is up. */
const LAYOUT_NOTICE = "[data-layout-notice]";

/**
 * Put away the notice after a move, if one is up, as its cross does. It
 * stays a few seconds and is cut out of any page beneath it.
 */
export async function dismissLayoutNotice(): Promise<void> {
  const notice = document.querySelector<HTMLElement>(LAYOUT_NOTICE);
  if (!notice) return;
  notice
    .querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')
    ?.click();
  await waitFor(
    () => !document.querySelector(LAYOUT_NOTICE),
    2_000,
    "the notice to go",
  ).catch(() => {});
}

/**
 * Close a check's page as its step ends, and wait until it has gone: the
 * next step starts at once, and must find the workspace as it is, not as
 * last drawn (0.1.160's trial: the divider step took the page still
 * closing behind it for its own, and split nothing). A page
 * closed out of a split leaves a notice saying what stayed, cut out of any
 * page beneath it for a few seconds; it is put away too, so the next step's
 * page is drawn whole. Never throws: it runs as a step's cleanup.
 */
export async function closeCheckPage(
  get: () => { loneTab?: SmokeLoneTab },
  page: string,
): Promise<void> {
  const loneTab = get().loneTab;
  if (!loneTab) return;
  const split = stripPlace(loneTab.strip(), page) === "split";
  loneTab.closePage(page);
  await waitFor(
    () =>
      !stripPlace(get().loneTab?.strip() ?? [], page) &&
      !document.querySelector(`[data-browser-pane="${CSS.escape(page)}"]`),
    5_000,
    "the check's page to close",
  ).catch(() => {});
  // The notice follows a moment after the split comes apart.
  if (split)
    await waitFor(
      () => document.querySelector(LAYOUT_NOTICE),
      1_000,
      "the notice that the split came apart",
    ).catch(() => {});
  await dismissLayoutNotice();
}

/** Why the strip holds no split of exactly `a` and `b`, or null. */
export function combinedProblem(
  strip: ReturnType<SmokeLoneTab["strip"]>,
  a: string,
  b: string,
): string | null {
  const split = strip.find(
    (entry): entry is { split: string[] } =>
      "split" in entry && entry.split.includes(a),
  );
  if (!split)
    return `no split on the strip holds the first tab (strip: ${JSON.stringify(strip)})`;
  if (!split.split.includes(b) || split.split.length !== 2)
    return `the split holds ${JSON.stringify(split.split)}, not just the two tabs`;
  return null;
}

/**
 * Press at `from`, move through `path`, and let go at its end; let go
 * wherever it got to if a move fails, so no press is left held.
 */
async function drag(from: Point, path: readonly Point[]) {
  await smokeMouse("down", from);
  let at = from;
  try {
    for (const point of path) {
      await smokeMouse("drag", point);
      at = point;
    }
    await pause(80);
  } finally {
    await smokeMouse("up", at);
  }
}

/** The address field in the page's header while it names the page. */
function titleField(page: string): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(
    `[data-workspace-header="${CSS.escape(page)}"] [data-pane-header-slot] input[data-pane-grab="face"]`,
  );
}

/** Why `page` is not alone in a pane left of `chat`'s, or null. */
export function splitLeftProblem(
  panes: readonly (readonly string[])[],
  chat: string,
  page: string,
): string | null {
  const own = panes.findIndex((pane) => pane.length === 1 && pane[0] === page);
  const other = panes.findIndex((pane) => pane.includes(chat));
  if (own < 0)
    return `the page is not alone in a pane (panes: ${JSON.stringify(panes)})`;
  if (other < 0) return "the chat's pane is gone";
  return own < other ? null : "the page's pane is not left of the chat's";
}

export async function checkLoneTabDrag(
  projectPath: string,
  pageUrl: string,
  get: () => LoneTabOptions,
): Promise<string> {
  const { loneTab, openWebLink } = get();
  if (!loneTab || !openWebLink)
    throw new Error("the workspace offers no pages to move");
  const panes = () => get().loneTab?.panes() ?? [];
  // Trusted presses on the headers prove the Mac's own mouse reached them.
  const presses: boolean[] = [];
  const onPress = (event: PointerEvent) => {
    if ((event.target as Element | null)?.closest?.("[data-workspace-header]"))
      presses.push(event.isTrusted);
  };
  // The address must never take focus from a drag.
  let focusedByDrag = false;
  let dragging = false;
  const onFocus = (event: FocusEvent) => {
    if (
      dragging &&
      (event.target as Element | null)?.getAttribute?.("aria-label") ===
        "Preview address"
    )
      focusedByDrag = true;
  };
  window.addEventListener("pointerdown", onPress, true);
  document.addEventListener("focusin", onFocus, true);
  let page: string | null = null;
  try {
    // A page, then a chat, each in front in turn.
    await openWebLink(pageUrl);
    page = await waitFor(
      () => {
        const id = get().focusedSurfaceId;
        return id &&
          document.querySelector(`[data-browser-pane="${CSS.escape(id)}"]`)
          ? id
          : null;
      },
      15_000,
      "the check's page in front",
    );
    const pageId = page;
    get().newProjectTask(projectPath);
    const chat = await waitFor(
      () => {
        const id = get().focusedSurfaceId;
        return id && id !== pageId ? id : null;
      },
      10_000,
      "a new chat in front",
    );
    const chatBody = () =>
      document.querySelector<HTMLElement>(
        `[data-workspace-surface="${CSS.escape(chat)}"] > [data-workspace-body]`,
      );
    /** The page alone in a pane right of the chat: its header is its toolbar. */
    const splitRight = async () => {
      // From the chat in front, as its pane's "…" splits it.
      get().loneTab?.select(chat);
      await waitFor(
        () => get().focusedSurfaceId === chat,
        5_000,
        "the chat in front",
      );
      get().loneTab?.split(pageId, "right", chat);
      await waitFor(
        () => !splitLeftProblem([...panes()].reverse(), chat, pageId),
        10_000,
        "the page alone in a pane right of the chat",
      );
      const field = await waitFor(
        () => titleField(pageId),
        15_000,
        "the page's title in its pane's header",
      );
      await pause(400);
      return titleField(pageId) ?? field;
    };
    /** Drag the page by its title to `to`; the address never takes focus. */
    const dragTitle = async (to: Point) => {
      const field = await waitFor(
        () => titleField(pageId),
        5_000,
        "the page's title in its pane's header",
      );
      const from = pressPoint(field);
      dragging = true;
      try {
        await drag(from, dragPath(from, to));
        await pause(400);
      } finally {
        dragging = false;
      }
      if (focusedByDrag)
        throw new Error("dragging the page's title focused its address");
    };

    let field = await splitRight();
    // Its own title once loaded; its host until then names it as well.
    await waitFor(
      () => titleField(pageId)?.value === "Aven check page",
      10_000,
      "the page's title",
    ).catch(() => {});

    // A click that never moves edits the address, as before.
    field = titleField(pageId) ?? field;
    const atTitle = pressPoint(field);
    await drag(atTitle, []);
    await waitFor(
      () =>
        document.activeElement instanceof HTMLInputElement &&
        document.activeElement.getAttribute("aria-label") ===
          "Preview address" &&
        document.activeElement.closest(
          `[data-workspace-header="${CSS.escape(pageId)}"]`,
        ),
      5_000,
      "a click on the page's title to focus its address",
    );
    (document.activeElement as HTMLElement).blur();
    await waitFor(() => titleField(pageId), 5_000, "the page's title again");
    await pause(300);

    // By its title to the chat's left edge: a pane of its own, now left.
    let body = chatBody();
    if (!body) throw new Error("the chat's pane is not on screen");
    const box = body.getBoundingClientRect();
    await dragTitle({ x: box.left + 12, y: box.top + box.height / 2 });
    await waitFor(
      () => !splitLeftProblem(panes(), chat, pageId),
      5_000,
      "the page to split the chat's pane on its left",
    ).catch(() => {
      throw new Error(splitLeftProblem(panes(), chat, pageId) ?? "no split");
    });

    // By its title into the middle of the chat's pane: they share it.
    body = chatBody();
    if (!body) throw new Error("the chat's pane is not on screen");
    await dragTitle(pressPoint(body));
    await waitFor(
      () => !joinedProblem(panes(), chat, pageId),
      5_000,
      "the page to join the chat's pane",
    ).catch(() => {
      throw new Error(joinedProblem(panes(), chat, pageId) ?? "no join");
    });

    // Split again, then by its title onto the window's strip: it stands
    // there alone.
    await splitRight();
    const strip = document.querySelector<HTMLElement>(
      '.workspace-status-strip-content [aria-label="Workspace tabs"]',
    );
    if (!strip) throw new Error("the window's strip is not on screen");
    // A slot, never a tab's middle (which would combine with that tab):
    // after the last entry. In the viewport's pixels: the strip is
    // CSS-zoomed at any interface zoom but 100%.
    const onStrip = viewportRect(strip, strip.getBoundingClientRect());
    const entries = [
      ...strip.querySelectorAll<HTMLElement>(":scope > [data-motion-slot]"),
    ].map((entry) => viewportRect(entry, entry.getBoundingClientRect()));
    await dragTitle({
      x: slotAfterLast(onStrip, entries),
      y: (onStrip.top + onStrip.bottom) / 2,
    });
    await waitFor(
      () => !strippedProblem(get().loneTab?.strip() ?? [], pageId),
      5_000,
      "the page on the strip",
    ).catch(() => {
      throw new Error(
        strippedProblem(get().loneTab?.strip() ?? [], pageId) ?? "not moved",
      );
    });
    if (presses.length < 4 || presses.some((trusted) => !trusted))
      throw new Error(
        `the presses on the headers were not the Mac's own (${JSON.stringify(presses)})`,
      );

    // Its strip tab let go on the middle of the chat's, with no rest before
    // the release: the two make a split.
    const stripTab = (id: string) =>
      strip.querySelector<HTMLElement>(
        `[data-surface-tab-id="${CSS.escape(id)}"]`,
      );
    const [pageTab, chatTab] = await waitFor(
      () => {
        const both = [stripTab(pageId), stripTab(chat)];
        return both.every((tab) => tab && tab.getClientRects().length > 0)
          ? (both as HTMLElement[])
          : null;
      },
      5_000,
      "the page's and the chat's tabs on the strip",
    );
    await pause(300);
    const from = pressPoint(pageTab);
    const onto = pressPoint(chatTab);
    await smokeMouse("down", from);
    let at = from;
    try {
      for (const point of dragPath(from, onto, 4)) {
        await smokeMouse("drag", point);
        at = point;
      }
    } finally {
      // At once, where the last move left it.
      await smokeMouse("up", at, { settle: false });
    }
    await waitFor(
      () => !combinedProblem(get().loneTab?.strip() ?? [], chat, pageId),
      5_000,
      "the page let go on the chat's tab to make a split with it",
    ).catch(() => {
      throw new Error(
        combinedProblem(get().loneTab?.strip() ?? [], chat, pageId) ??
          "no split",
      );
    });
    return `${presses.length} presses with the Mac's own mouse on the page's header: a click on its title focused the address; dragged by its title, the page split the chat's pane, joined it and stood alone on the strip, and the address never took focus; its strip tab let go on the chat's at once made a split of the two`;
  } finally {
    window.removeEventListener("pointerdown", onPress, true);
    document.removeEventListener("focusin", onFocus, true);
    if (page) await closeCheckPage(get, page);
  }
}

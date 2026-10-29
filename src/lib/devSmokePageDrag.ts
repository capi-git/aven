import type { BrowserBounds } from "./browser";
import {
  browserLayoutRecord,
  type BrowserLayoutRecord,
} from "./browserPresentation";
import { waitFor } from "./devSmoke";
import { viewportRect } from "./drag";
import { dragPath, smokeMouse, type SmokeLoneTab } from "./devSmokeLoneTab";
import { applyUiScale, loadUiScale, saveUiScale } from "./uiScale";

/**
 * Aven Dev's real-app check of a tab dragged over a live page (0.1.156: at
 * 80% interface zoom a strip tab dragged over Google left a tab-sized band
 * of the window's background in the page, away from the tab, and the tab
 * itself vanished under the page).
 *
 * The native page is a layer above the workspace's web view, so the check
 * reads it through what its pane last sent it: the page must stay shown at
 * its own frame for the whole drag, and anything cut out of it must lie
 * under the tab's copy, over a still image of the whole page, and the copy
 * must be under the pointer. It drags over a page alone in front and over
 * one in a split, at three zooms, across the page's own strip tab long
 * enough to arm a combine on the way; Escape (also mid-move, while the
 * still image may be painting) and a drop each give the page back whole
 * (the unit tests cover a pointer cancel and a lost focus). Where the copy
 * is drawn is read in the viewport's pixels on either kind of CSS zoom.
 */
type Point = { x: number; y: number };
type Box = { left: number; top: number; right: number; bottom: number };
type LoneTabOptions = {
  newProjectTask: (path: string) => void;
  openWebLink?: (url: string) => void | Promise<void>;
  focusedSurfaceId?: string;
  loneTab?: SmokeLoneTab;
};

/**
 * Interface zooms to drag at: the report's 80%, where the strip's
 * counter-zoom showed it, 100%, and 120% (zoom goes in tenths).
 */
export const PAGE_DRAG_ZOOMS = [0.8, 1, 1.2] as const;
/** How far (px) the pointer may be from the copy held under it. */
const POINTER_SLOP = 48;
/** How far (px) a cut-out may stand from the copy it was cut for. */
const CUT_TOLERANCE = 2;

/** The dragged tab's copy as drawn now: its floating face, or null. */
export function drawnCopy(root: ParentNode = document): Box | null {
  const rects = [
    ...root.querySelectorAll<HTMLElement>(
      '[data-sortable-preview] [data-sortable-layer="face"] > *',
    ),
  ]
    .map((piece) => ({ piece, rect: piece.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width > 0 && rect.height > 0)
    // In the viewport's pixels, as the pointer is, on either kind of engine.
    .map(({ piece, rect }) => viewportRect(piece, rect));
  if (!rects.length) return null;
  return {
    left: Math.min(...rects.map((rect) => rect.left)),
    top: Math.min(...rects.map((rect) => rect.top)),
    right: Math.max(...rects.map((rect) => rect.right)),
    bottom: Math.max(...rects.map((rect) => rect.bottom)),
  };
}

const near = (a: number, b: number, slop = 0.5) => Math.abs(a - b) <= slop;

/**
 * Why what a page was last sent is wrong while a tab's copy is over it, or
 * null. `placed` asks also that each cut-out lie under the copy, which only
 * holds once the copy has stopped moving: a moving copy's cut-out may trail
 * it by a frame, over the still image.
 */
export function pageDragProblem(
  record: BrowserLayoutRecord | undefined,
  frame: BrowserBounds,
  copy: Box | null,
  still: { width: number; height: number } | null,
  placed: boolean,
): string | null {
  if (!record) return "the page has no layout";
  if (!record.visible) return "the page was hidden";
  const bounds = record.bounds;
  for (const key of ["x", "y", "width", "height"] as const)
    if (!near(bounds[key], frame[key]))
      return `the page's frame changed (${key} ${frame[key]} to ${bounds[key]})`;
  if (
    !near(bounds.clipLeft ?? 0, frame.clipLeft ?? 0) ||
    !near(bounds.clipRight ?? 0, frame.clipRight ?? 0)
  )
    return "the page's clip changed";
  const holes = bounds.holes ?? [];
  if (!holes.length) return null;
  if (placed) {
    if (!copy) return `${holes.length} cut-out(s) with no tab copy on screen`;
    for (const hole of holes) {
      const left = bounds.x + hole.x;
      const top = bounds.y + hole.y;
      if (
        left < copy.left - CUT_TOLERANCE ||
        top < copy.top - CUT_TOLERANCE ||
        left + hole.width > copy.right + CUT_TOLERANCE ||
        top + hole.height > copy.bottom + CUT_TOLERANCE
      )
        return `a ${Math.round(hole.width)}×${Math.round(hole.height)} cut-out at (${Math.round(left)}, ${Math.round(top)}) lies outside the tab's copy at (${Math.round(copy.left)}, ${Math.round(copy.top)})–(${Math.round(copy.right)}, ${Math.round(copy.bottom)})`;
    }
  }
  if (!still) return "a cut-out with no still image of the page beneath it";
  if (
    !near(still.width, bounds.width, 1) ||
    !near(still.height, bounds.height, 1)
  )
    return `the still image beneath is ${Math.round(still.width)}×${Math.round(still.height)}, not the page's ${Math.round(bounds.width)}×${Math.round(bounds.height)}`;
  return null;
}

/** Why the page is not back whole and live at its pane, or null. */
export function pageBackProblem(
  record: BrowserLayoutRecord | undefined,
  pane: Pick<DOMRect, "x" | "y" | "width" | "height"> | null,
  stills: number,
): string | null {
  if (!record || !pane) return "the page is gone";
  if (!record.visible) return "the page is still hidden";
  if (record.bounds.holes?.length)
    return `the page still has ${record.bounds.holes.length} cut-out(s)`;
  for (const key of ["x", "y", "width", "height"] as const)
    if (!near(record.bounds[key], pane[key], 1))
      return `the page is not at its pane (${key} ${record.bounds[key]}, pane ${pane[key]})`;
  if (stills) return "a still image of the page was left behind";
  return null;
}

const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function centre(element: Element): Point {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** Why the copy is not under the pointer, or null. */
export function copyAtPointerProblem(
  copy: Box | null,
  pointer: Point,
): string | null {
  if (!copy) return "the tab's copy is not drawn";
  if (
    pointer.x < copy.left - POINTER_SLOP ||
    pointer.x > copy.right + POINTER_SLOP ||
    pointer.y < copy.top - POINTER_SLOP ||
    pointer.y > copy.bottom + POINTER_SLOP
  )
    return `the tab's copy stayed at (${Math.round(copy.left)}, ${Math.round(copy.top)}), away from the pointer at (${Math.round(pointer.x)}, ${Math.round(pointer.y)})`;
  return null;
}

/** A painted frame within 100 ms, or not. */
const painted = () =>
  Promise.race([
    new Promise<boolean>((resolve) =>
      requestAnimationFrame(() => resolve(true)),
    ),
    pause(100).then(() => false),
  ]);

export async function checkPageDragCutOut(
  projectPath: string,
  pageUrl: string,
  get: () => LoneTabOptions,
): Promise<string> {
  const { loneTab, openWebLink } = get();
  if (!loneTab || !openWebLink)
    throw new Error("the workspace offers no pages to drag over");
  const scale = loadUiScale();
  const notes: string[] = [];
  try {
    for (const zoom of PAGE_DRAG_ZOOMS) {
      saveUiScale(zoom);
      await applyUiScale(zoom);
      try {
        notes.push(await dragOverPage(projectPath, pageUrl, get));
      } catch (error) {
        throw new Error(
          `at ${Math.round(zoom * 100)}%: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } finally {
    saveUiScale(scale);
    await applyUiScale(scale);
  }
  return `${notes.join("; ")}. Each time the page stayed shown at its own frame, every cut-out lay under the tab's copy over a still image of the whole page, the copy stayed under the pointer, and after Escape and after a drop the page was whole and live at its pane`;
}

async function dragOverPage(
  projectPath: string,
  pageUrl: string,
  get: () => LoneTabOptions,
): Promise<string> {
  const zoom = loadUiScale();
  const newChat = async () => {
    const before = get().focusedSurfaceId;
    get().newProjectTask(projectPath);
    return waitFor(
      () => {
        const id = get().focusedSurfaceId;
        return id && id !== before ? id : null;
      },
      10_000,
      "a new chat in front",
    );
  };
  let page: string | null = null;
  try {
    // A chat, then a page opened from it: both on the window's strip, the
    // page alone in front.
    const chat = await newChat();
    await get().openWebLink?.(pageUrl);
    page = await waitFor(
      () => {
        const id = get().focusedSurfaceId;
        return id &&
          id !== chat &&
          document.querySelector(`[data-browser-pane="${CSS.escape(id)}"]`)
          ? id
          : null;
      },
      15_000,
      "the check's page in front",
    );
    const pageId = page;
    const host = () =>
      document.querySelector<HTMLElement>(
        `[data-browser-pane="${CSS.escape(pageId)}"] .browser-native-host`,
      );
    const stills = () =>
      [
        ...(host()?.querySelectorAll<HTMLImageElement>(
          ".browser-page-snapshot, .browser-motion-image",
        ) ?? []),
      ].filter((image) => image.getClientRects().length > 0);
    const backProblem = () =>
      pageBackProblem(
        browserLayoutRecord(pageId),
        host()?.getBoundingClientRect() ?? null,
        stills().length,
      );
    const shownAtPane = () =>
      backProblem() ? null : browserLayoutRecord(pageId);
    const back = (what: string) =>
      waitFor(
        () =>
          !document.querySelector("[data-sortable-preview]") && shownAtPane(),
        5_000,
        what,
      ).catch(() => {
        throw new Error(
          `${what}: ${backProblem() ?? "the tab's copy is still out"}`,
        );
      });
    const stripTab = (id: string) =>
      document.querySelector<HTMLElement>(
        `.workspace-status-strip-content [data-surface-tab-id="${CSS.escape(id)}"]`,
      );
    await back("the page drawn live in front");
    // Loaded, as a page a person drags over usually is.
    await waitFor(
      () => stripTab(pageId)?.textContent?.includes("Aven check page"),
      10_000,
      "the page's title",
    ).catch(() => {});
    await pause(300);

    let cuts = 0;
    let starved = 0;
    /**
     * Press `dragged`'s strip tab, carry it over the page (across the
     * page's own strip tab first, resting there, when `cross`), hold it
     * there (unless `rest` is false: then it ends mid-move, before or as a
     * still image paints), then press Escape or let go.
     */
    const carry = async (
      dragged: string,
      end: "Escape" | "drop",
      cross: boolean,
      rest = true,
    ) => {
      const what = `${end}${cross ? " after crossing the page's tab" : ""}${rest ? "" : " mid-move"}`;
      // On the window's strip, or in another pane's row of tabs.
      const handle = await waitFor(
        () =>
          stripTab(dragged) ??
          [
            ...document.querySelectorAll<HTMLElement>(
              `[data-surface-tab-id="${CSS.escape(dragged)}"]`,
            ),
          ].find((tab) => tab.getClientRects().length > 0),
        3_000,
        `the dragged tab (${what})`,
      );
      const frame = (await back(`the page live before a drag (${what})`))
        .bounds;
      const pane = host()!.getBoundingClientRect();
      const from = centre(handle);
      // Well inside the page's right edge zone: a split to its right.
      const to = {
        x: pane.left + pane.width * 0.88,
        y: pane.top + pane.height * 0.5,
      };
      const over = stripTab(pageId);
      const via = cross && over ? centre(over) : null;
      const below = { x: (via ?? from).x, y: pane.top + 80 };
      // Every problem is noted and the drag carries on, so it can be seen.
      const problems = new Set<string>();
      let at = from;
      const sample = (placed: boolean) => {
        const record = browserLayoutRecord(pageId);
        if (placed && record?.bounds.holes?.length) cuts += 1;
        const still = stills()[0]?.getBoundingClientRect() ?? null;
        const problem =
          pageDragProblem(record, frame, drawnCopy(), still, placed) ??
          (placed ? copyAtPointerProblem(drawnCopy(), at) : null);
        if (problem) problems.add(problem);
      };
      const moveThrough = async (path: readonly Point[]) => {
        for (const point of path) {
          await smokeMouse("drag", point);
          at = point;
          sample(false);
        }
      };
      // What, other than this check, ends the drag early.
      const ended: string[] = [];
      const note = (event: Event) => {
        if (ended.length < 3)
          ended.push(
            `${event.type}${event.target instanceof Element ? ` on ${event.target.tagName.toLowerCase()}${event.target.className ? `.${String(event.target.className).split(" ")[0]}` : ""}` : ""}`,
          );
      };
      const kinds = ["blur", "pointercancel", "lostpointercapture"] as const;
      for (const kind of kinds) window.addEventListener(kind, note, true);
      await smokeMouse("down", from);
      try {
        if (via) {
          await moveThrough(dragPath(from, via, 4));
          // Resting on the page's own tab arms a combine with it.
          await pause(350);
          await smokeMouse("drag", { x: via.x + 1, y: via.y });
        }
        await moveThrough(dragPath(at, below, 6).slice(1));
        await moveThrough(dragPath(below, to, rest ? 10 : 3).slice(1));
        if (rest) {
          // About the drop zone, then still: the cut-out follows the copy.
          for (let step = 0; step < 10; step += 1)
            await moveThrough([
              {
                x: to.x + Math.sin(step) * 24,
                y: to.y + Math.cos(step) * 40,
              },
            ]);
          await smokeMouse("drag", to);
          at = to;
          await pause(300);
          const until = Date.now() + 1_000;
          while (Date.now() < until) {
            sample(true);
            if (!(await painted())) starved += 1;
            await pause(40);
          }
        }
      } finally {
        for (const kind of kinds) window.removeEventListener(kind, note, true);
        if (end === "Escape")
          window.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
          );
        await smokeMouse("up", at);
      }
      if (ended.length)
        problems.add(`the drag was ended by ${ended.join(", ")}`);
      if (problems.size)
        throw new Error(
          `while dragging (${what}): ${[...problems].slice(0, 3).join("; ")}`,
        );
    };
    const panes = () => JSON.stringify(get().loneTab?.panes() ?? []);

    // Alone in front: Escape gives it back as it was.
    let before = panes();
    await carry(chat, "Escape", false);
    await back("the page back whole after Escape");
    if (panes() !== before)
      throw new Error(`Escape still moved the tab (${before} to ${panes()})`);
    if (!cuts) throw new Error("the tab's copy was never cut out of the page");
    // Let go mid-move, while its still image may be painting.
    await carry(chat, "Escape", false, false);
    await back("the page back whole after Escape mid-move");
    if (panes() !== before)
      throw new Error(
        `Escape mid-move still moved the tab (${before} to ${panes()})`,
      );
    // Across the page's own tab, then dropped beside it: a split.
    await carry(chat, "drop", true);
    await waitFor(
      () => {
        const now = get().loneTab?.panes() ?? [];
        // Side by side, each in a pane of its own.
        const chatPane = now.findIndex((pane) => pane.includes(chat));
        const pagePane = now.findIndex((pane) => pane.includes(pageId));
        return chatPane >= 0 && pagePane >= 0 && chatPane !== pagePane;
      },
      5_000,
      "the chat to split the page's pane",
    ).catch(() => {
      throw new Error(`the drop did not split the page's pane (${panes()})`);
    });
    // The panes glide; the page comes back live at its new frame.
    await back("the page back whole beside the chat");
    // Over the page in a split: another chat, a tab in the chat's pane,
    // then Escape.
    const other = await newChat();
    get().loneTab?.select(pageId);
    await waitFor(
      () => get().focusedSurfaceId === pageId,
      5_000,
      "the split in front",
    );
    await back("the page live in its split");
    before = panes();
    await carry(other, "Escape", false);
    await back("the page in its split back whole after Escape");
    if (panes() !== before)
      throw new Error(
        `Escape still moved the tab in a split (${before} to ${panes()})`,
      );
    return `${Math.round(zoom * 100)}%: ${cuts} cut-outs${starved ? `, ${starved} frames late` : ""}`;
  } finally {
    if (page) get().loneTab?.closePage(page);
  }
}

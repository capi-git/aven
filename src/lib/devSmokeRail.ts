import { waitFor } from "./devSmoke";
import {
  closeCheckPage,
  dragPath,
  frame,
  pressPoint,
  smokeMouse,
  splitLeftProblem,
  type SmokeLoneTab,
} from "./devSmokeLoneTab";
import { viewportRect } from "./drag";

/**
 * Aven Dev's real-app check of a divider dragged to the edge (0.1.159 let a
 * pane be squeezed to a sliver, or hid it whole with only a chevron to show
 * it had been there): a page beside a chat is folded by its divider, with
 * the Mac's own mouse, and must stand as a rail of its own; one click on
 * the rail opens it at its size again.
 */
type RailOptions = {
  newProjectTask: (path: string) => void;
  openWebLink?: (url: string) => void | Promise<void>;
  focusedSurfaceId?: string;
  loneTab?: SmokeLoneTab;
};

/** A pane's place on screen, in CSS pixels of the stage. */
export type PaneBox = { width: number; hidden: boolean };

/**
 * Why the page is not folded to a rail beside the chat, or null: its rail
 * on screen at about 28px, its pane hidden, and the chat with the room.
 */
export function railProblem(
  rail: PaneBox | null,
  page: PaneBox,
  chat: PaneBox,
  stage: number,
): string | null {
  if (!rail) return "the page has no rail";
  if (rail.hidden) return "the page's rail is hidden";
  if (rail.width < 20 || rail.width > 40)
    return `the rail is ${Math.round(rail.width)}px wide, not about 28px`;
  if (!page.hidden) return "the page's pane is still on screen";
  if (chat.width < stage - 48)
    return `the chat has ${Math.round(chat.width)}px of ${Math.round(stage)}px`;
  return null;
}

/** Why the page is not open again at about the room it had, or null. */
export function reopenedProblem(
  rail: PaneBox | null,
  page: PaneBox,
  stage: number,
): string | null {
  if (rail && !rail.hidden) return "the page's rail is still there";
  if (page.hidden) return "the page's pane is not on screen";
  const share = page.width / stage;
  if (share < 0.3 || share > 0.7)
    return `the page came back at ${Math.round(share * 100)}% of the stage, not about half`;
  return null;
}

const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function checkDividerRail(
  projectPath: string,
  pageUrl: string,
  get: () => RailOptions,
): Promise<string> {
  const { loneTab, openWebLink } = get();
  if (!loneTab || !openWebLink)
    throw new Error("the workspace offers no pages to fold");
  const panes = () => get().loneTab?.panes() ?? [];
  // Trusted presses prove the Mac's own mouse reached the divider and rail.
  const presses: boolean[] = [];
  const onPress = (event: PointerEvent) => {
    const target = event.target as Element | null;
    if (target?.closest?.(".workspace-stage-sash, [data-pane-rail]"))
      presses.push(event.isTrusted);
  };
  window.addEventListener("pointerdown", onPress, true);
  let page: string | null = null;
  try {
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
    ).catch((error: unknown) => {
      const problem = splitLeftProblem([...panes()].reverse(), chat, pageId);
      throw problem
        ? new Error(`the page did not split right of the chat: ${problem}`)
        : error;
    });
    const surface = (id: string) =>
      document.querySelector<HTMLElement>(
        `[data-workspace-surface="${CSS.escape(id)}"]`,
      );
    const box = (element: HTMLElement | null): PaneBox => ({
      width: element?.offsetWidth ?? 0,
      hidden: !element || element.hidden || element.offsetWidth === 0,
    });
    const rail = () =>
      document.querySelector<HTMLElement>(
        `[data-pane-rail="${CSS.escape(pageId)}"]`,
      );
    // The divider at the page's left edge, on the stage that holds them.
    const divider = await waitFor(
      () => {
        const pane = surface(pageId);
        const stage = pane?.closest<HTMLElement>("[data-workspace-stage]");
        if (!pane || !stage || pane.hidden) return null;
        const left = pane.getBoundingClientRect().left;
        return (
          [
            ...stage.querySelectorAll<HTMLElement>(
              ':scope > .workspace-stage-sash[data-direction="right"]',
            ),
          ].find((sash) => {
            const rect = sash.getBoundingClientRect();
            return Math.abs((rect.left + rect.right) / 2 - left) < 6;
          }) ?? null
        );
      },
      10_000,
      "the divider between the chat and the page",
    );
    const stage = divider.closest<HTMLElement>("[data-workspace-stage]")!;
    await pause(400);

    // Drag the divider to the stage's right edge, past the page's minimum.
    const from = pressPoint(divider);
    const edge = viewportRect(stage, stage.getBoundingClientRect());
    const to = { x: edge.right - 4, y: from.y };
    await smokeMouse("down", from);
    let at = from;
    try {
      for (const point of dragPath(from, to)) {
        await smokeMouse("drag", point);
        at = point;
      }
      await pause(80);
    } finally {
      await smokeMouse("up", at);
    }
    await waitFor(
      () =>
        !railProblem(
          rail() && box(rail()),
          box(surface(pageId)),
          box(surface(chat)),
          stage.offsetWidth,
        ),
      5_000,
      "the page folded to a rail beside the chat",
    ).catch(() => {
      throw new Error(
        railProblem(
          rail() && box(rail()),
          box(surface(pageId)),
          box(surface(chat)),
          stage.offsetWidth,
        ) ?? "no rail",
      );
    });
    await pause(300);

    // One click on the rail opens the page at the room it had.
    const onRail = pressPoint(rail()!);
    await smokeMouse("down", onRail);
    await smokeMouse("up", onRail);
    await frame();
    await waitFor(
      () =>
        !reopenedProblem(
          rail() && box(rail()),
          box(surface(pageId)),
          stage.offsetWidth,
        ),
      5_000,
      "the page open again from its rail",
    ).catch(() => {
      throw new Error(
        reopenedProblem(
          rail() && box(rail()),
          box(surface(pageId)),
          stage.offsetWidth,
        ) ?? "not open",
      );
    });
    if (presses.length < 2 || presses.some((trusted) => !trusted))
      throw new Error(
        `the presses on the divider and rail were not the Mac's own (${JSON.stringify(presses)})`,
      );
    const width = Math.round(
      (box(surface(pageId)).width / stage.offsetWidth) * 100,
    );
    return `dragged to the edge with the Mac's own mouse, the page folded to a 28px rail beside the chat; one click on it opened the page at ${width}% again`;
  } finally {
    window.removeEventListener("pointerdown", onPress, true);
    if (page) await closeCheckPage(get, page);
  }
}

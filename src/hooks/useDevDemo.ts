// LOCAL ONLY (not for commit): drives Aven Dev through a scripted tour for
// filming, inside the real-app check's throwaway profile. It runs only when
// the runner put demo.json beside the check's project.
import {
  crewWorkspace,
  requestCrewReview,
  setAvosReadAccess,
  setCrewQuietHours,
} from "../lib/crewActions";
import { ensureCrewSaved, getCrew } from "../lib/crews";
import { reportDevServer } from "../lib/devPreviews";
import { type DevSmokeConfig, waitFor } from "../lib/devSmoke";
import { dragPath, pressPoint, smokeMouse } from "../lib/devSmokeLoneTab";
import { readTextFile, writeTextFile } from "../lib/fs";
import { parentPath, projectName } from "../lib/paths";
import { setTeamView } from "../lib/teamView";
import { loadUiScale } from "../lib/uiScale";

type Point = { x: number; y: number };
type Mark = {
  name: string;
  at: number;
  rect?: { x: number; y: number; w: number; h: number };
  point?: Point;
};

const CHAT_REQUEST = "Write a short README for the Juniper site";
const AVOS_REQUEST = "Make the sign-up button the clear next step on the home page";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const onScreen = (el: Element | null | undefined): el is HTMLElement =>
  !!el && el.getClientRects().length > 0;

export async function isDemo(config: DevSmokeConfig): Promise<boolean> {
  try {
    await readTextFile(`${parentPath(config.projectPath)}/demo.json`);
    return true;
  } catch {
    return false;
  }
}

export async function runDevDemo(
  config: DevSmokeConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get: () => any,
): Promise<void> {
  const root = parentPath(config.projectPath);
  const marks: Mark[] = [];
  const save = () =>
    writeTextFile(`${root}/marks.json`, JSON.stringify({ uiScale: loadUiScale(), marks }, null, 1));
  const mark = async (name: string, el?: Element | null, point?: Point) => {
    const r = el?.getBoundingClientRect();
    marks.push({
      name,
      at: Date.now() / 1000,
      ...(r ? { rect: { x: r.left, y: r.top, w: r.width, h: r.height } } : {}),
      ...(point ? { point } : {}),
    });
    await save();
  };
  /** A real click with the test mouse, marked for the pointer drawn later. */
  const click = async (name: string, el: HTMLElement, lead = 900) => {
    const at = pressPoint(el);
    await mark(`aim:${name}`, el, at);
    await sleep(lead);
    await mark(`click:${name}`, el, at);
    await smokeMouse("down", at);
    await smokeMouse("up", at);
  };
  /** A real drag with the test mouse; every point is marked. */
  const drag = async (name: string, from: Point, to: Point, { steps = 14, hold = 0 } = {}) => {
    await mark(`aim:${name}`, null, from);
    await sleep(800);
    await mark(`down:${name}`, null, from);
    await smokeMouse("down", from);
    let at = from;
    try {
      for (const point of dragPath(from, to, steps)) {
        await smokeMouse("drag", point);
        await mark(`move:${name}`, null, point);
        at = point;
        await sleep(22);
      }
      if (hold) await sleep(hold);
    } finally {
      await mark(`up:${name}`, null, at);
      await smokeMouse("up", at, { settle: false });
    }
  };
  const typeInto = async (field: HTMLTextAreaElement, text: string) => {
    field.focus();
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await mark("type-start", field);
    for (let i = 1; i <= text.length; i++) {
      setValue.call(field, text.slice(0, i));
      field.dispatchEvent(new InputEvent("input", { bubbles: true, data: text[i - 1] }));
      await sleep(36 + Math.random() * 28);
    }
    await mark("type-end", field);
  };
  const sendFrom = async (scope: HTMLElement, field: HTMLTextAreaElement) => {
    const send = [
      ...scope.querySelectorAll<HTMLButtonElement>('button[type="submit"], button[aria-label^="Send"]'),
    ].find((b) => onScreen(b) && !b.disabled);
    if (send) await click("send", send, 600);
    else {
      await mark("send-key", field);
      field.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }),
      );
    }
  };
  const surface = (id: string) =>
    document.querySelector<HTMLElement>(`[data-workspace-surface="${CSS.escape(id)}"]`);
  const hideTestLabels = () => {
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (el.children.length) continue;
      const words = el.textContent?.trim();
      if (words === "Development" || words === "Usage unavailable") {
        const box = (words === "Usage unavailable" ? el.parentElement : el) ?? el;
        box.style.visibility = "hidden";
      }
    }
  };
  const hider = setInterval(hideTestLabels, 400);

  try {
    const settings = JSON.parse(await readTextFile(`${root}/demo.json`)) as {
      project: string;
      siteUrl: string;
    };
    const project = settings.project;
    const crew = ensureCrewSaved(project);
    setCrewQuietHours(project, { ...crew.limits.quiet, on: false });
    await setAvosReadAccess(project, true);
    const off = await get().crew.turnOn(project);
    if (off) throw new Error(`Avos didn't turn on: ${off}`);
    const url = new URL(settings.siteUrl);
    reportDevServer({
      project,
      cwd: project,
      address: { url: url.href, port: Number(url.port), label: url.host, strength: "strong" },
      source: "terminal",
      sourceId: "demo-site",
      placement: "terminal",
      run: "npm run dev",
    });

    // ---- Scene 1: a chat with an agent ----
    const before = get().focusedSurfaceId;
    get().newProjectTask(project);
    const chatId: string = await waitFor(
      () => {
        const id = get().focusedSurfaceId;
        return id && id !== before ? id : null;
      },
      15_000,
      "a new chat",
    );
    const chatSurface = await waitFor(
      () => (onScreen(surface(chatId)) ? surface(chatId) : null),
      15_000,
      "the chat",
    );
    hideTestLabels();
    await sleep(1500);
    await mark("ready");
    for (let i = 0; i < 200; i++) {
      try {
        await readTextFile(`${root}/recording`);
        break;
      } catch {
        await sleep(100);
      }
    }
    await sleep(1500);
    await mark("scene:chat");
    const chatField = await waitFor(
      () => chatSurface.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]'),
      10_000,
      "the chat's box",
    );
    await click("chat-box", chatField, 800);
    await typeInto(chatField, CHAT_REQUEST);
    await sleep(500);
    await mark("send-key", chatField);
    chatField.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }),
    );
    await mark("chat-sent");
    await waitFor(
      () => (chatSurface.textContent ?? "").includes("where the home page lives") || null,
      60_000,
      "the agent's answer",
    );
    await mark("chat-answered");
    await sleep(2500);

    // ---- Scene 2: what changed ----
    await mark("scene:changes");
    get().motion?.showChanges();
    await sleep(3800);
    get().motion?.hideChanges();
    await sleep(800);

    // ---- Scene 3: the built-in browser ----
    await mark("scene:browser");
    await get().openWebLink(settings.siteUrl);
    const pageId: string = await waitFor(
      () => {
        const id = get().focusedSurfaceId;
        return id && id !== chatId && document.querySelector(`[data-browser-pane="${CSS.escape(id)}"]`)
          ? id
          : null;
      },
      15_000,
      "the site in a browser tab",
    );
    await sleep(2600);
    const star = await waitFor(
      () =>
        [...document.querySelectorAll<HTMLButtonElement>('button[aria-label^="Bookmark in"]')].find(onScreen) ??
        null,
      8_000,
      "the bookmark star",
    ).catch(() => null);
    if (star) {
      await click("star", star, 900);
      await sleep(1800);
    }

    // ---- Scene 4: tabs ----
    await mark("scene:tabs");
    // The page beside the chat, as its "…" menu's split does.
    get().loneTab?.select(chatId);
    await sleep(500);
    get().loneTab?.split(pageId, "right", chatId);
    await mark("split");
    const titleOf = () =>
      document.querySelector<HTMLInputElement>(
        `[data-workspace-header="${CSS.escape(pageId)}"] [data-pane-header-slot] input[data-pane-grab="face"]`,
      );
    const title = await waitFor(titleOf, 10_000, "the page's title").catch(() => null);
    await sleep(2600);
    const chatBody = () =>
      document.querySelector<HTMLElement>(
        `[data-workspace-surface="${CSS.escape(chatId)}"] > [data-workspace-body]`,
      );
    const edgeOf = (body: HTMLElement, side: "left" | "right") => {
      const box = body.getBoundingClientRect();
      const middle = pressPoint(body);
      const scale = middle.x / ((box.left + box.right) / 2) || 1;
      return { x: (side === "left" ? box.left + 14 : box.right - 14) * scale, y: middle.y };
    };
    const body = chatBody();
    if (title && body) {
      // By its title to the chat's left edge: the page moves to the left.
      await drag("move-left", pressPoint(title), edgeOf(body, "left"), { steps: 20, hold: 350 });
      await mark("moved-left");
      await sleep(2400);
      // And back to the right.
      const again = titleOf();
      const body2 = chatBody();
      if (again && body2) {
        await drag("move-right", pressPoint(again), edgeOf(body2, "right"), { steps: 20, hold: 350 });
        await mark("moved-right");
        await sleep(2200);
      }
    } else await mark(`skipped moves: ${title ? "no chat body" : "no title"}`);

    // Close the page: Avos gets the whole window.
    get().loneTab?.closePage(pageId);
    await sleep(900);

    // ---- Scene 5: Avos ----
    await mark("scene:avos");
    setTeamView(project, "chat");
    crewWorkspace()?.openCrew(project);
    const avos = await waitFor(
      () =>
        [...document.querySelectorAll<HTMLElement>("[data-team-chat]")].find(
          (el) => onScreen(el) && (el.dataset.teamChat ?? "").endsWith(projectName(project)),
        ) ?? null,
      20_000,
      "Avos's chat",
    );
    await sleep(1800);
    const avosField = await waitFor(
      () => avos.querySelector<HTMLTextAreaElement>("textarea"),
      10_000,
      "Avos's box",
    );
    await click("avos-box", avosField, 800);
    await typeInto(avosField, AVOS_REQUEST);
    await sleep(500);
    await sendFrom(avos, avosField);
    await mark("avos-sent");
    await waitFor(
      () => getCrew(project)?.cards.find((card) => card.stage === "ready") ?? null,
      240_000,
      "the card to be ready",
    );
    await mark("avos-ready");
    await sleep(3200);
    const lookAtIt = await waitFor(
      () =>
        [...document.querySelectorAll<HTMLButtonElement>(".avos-notice-items button")].find(
          (b) => onScreen(b) && b.textContent?.trim() === "Look at it",
        ) ?? null,
      6_000,
      "Look at it",
    ).catch(() => null);
    const reviewButton =
      lookAtIt ??
      [...avos.querySelectorAll<HTMLButtonElement>("button")].find(
        (b) => onScreen(b) && b.textContent?.trim() === "Review",
      );
    if (reviewButton) await click("review", reviewButton, 900);
    else requestCrewReview(project);
    const review = await waitFor(
      () => {
        const found = document.querySelector<HTMLElement>("[data-avos-review]");
        return onScreen(found) ? found : null;
      },
      15_000,
      "Avos's Review",
    );
    await mark("review-open", review);
    for (const close of document.querySelectorAll<HTMLButtonElement>(".avos-notice-close")) close.click();
    await sleep(1600);
    const run = await waitFor(
      () => review.querySelector<HTMLButtonElement>("[data-avos-review-run]:not(:disabled)"),
      3_000,
      "Run Avos's version",
    ).catch(() => null);
    if (run) await click("run", run, 800);
    const look = () => review.querySelector<HTMLElement>("[data-avos-review-look]");
    await waitFor(
      () => {
        const said = look()?.querySelector("[role='status']")?.textContent ?? "";
        if (said.startsWith("No pictures")) throw new Error(said);
        return look()?.querySelector<HTMLElement>("[data-avos-review-spot='1']") ?? null;
      },
      240_000,
      "the pictures",
    );
    await sleep(300);
    await mark("pictured", look());
    await sleep(6000);
    const apply = await waitFor(
      () => review.querySelector<HTMLButtonElement>("[data-avos-review-apply]:not(:disabled)"),
      10_000,
      "Apply",
    );
    await click("apply", apply, 900);
    await mark("applied");
    await sleep(3200);

    // ---- Scene 6: the site again, with the change ----
    await mark("scene:result");
    await get().openWebLink(settings.siteUrl);
    await waitFor(
      () => {
        const id = get().focusedSurfaceId;
        return id && document.querySelector(`[data-browser-pane="${CSS.escape(id)}"]`) ? id : null;
      },
      15_000,
      "the site again",
    ).catch(() => null);
    await mark("result-open");
    await sleep(4200);

    // ---- Scene 7: the rest of Aven ----
    await mark("scene:home");
    get().motion?.openHome();
    await sleep(1600);
    // The sidebar: projects, Avos and chats.
    const sidebarToggle = [
      ...document.querySelectorAll<HTMLButtonElement>('button[aria-label="Toggle workspace sidebar"]'),
    ].find(onScreen);
    if (sidebarToggle) {
      await click("sidebar", sidebarToggle, 700);
      await mark("sidebar-open");
      await sleep(3200);
      await click("sidebar-close", sidebarToggle, 500);
      await sleep(700);
    } else await sleep(1200);
    await mark("scene:search");
    get().utilities?.openSearch();
    await sleep(700);
    const query = document.activeElement;
    if (query instanceof HTMLInputElement) {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      for (const [i, letter] of [..."juniper"].entries()) {
        setValue.call(query, "juniper".slice(0, i + 1));
        query.dispatchEvent(new InputEvent("input", { bubbles: true, data: letter }));
        await sleep(90);
      }
      await mark("searched", query);
    } else await mark("search: no field");
    await sleep(2400);
    await mark("scene:automations");
    get().utilities?.openAutomations();
    await sleep(2400);
    await mark("scene:settings");
    get().utilities?.openSettings();
    await sleep(2600);
    get().utilities?.closeSettings();
    await sleep(600);
    get().motion?.showWorkspace?.();
    await sleep(1500);
    await mark("end");
  } catch (error) {
    await mark(`error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearInterval(hider);
  }
}

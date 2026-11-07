import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetMotionImage,
  holdMotionPages,
  lastMotionImage,
  panesMoved,
  refreshMotionImages,
  registerMotionPage,
  releaseMotionPages,
  releaseMotionPagesAfter,
  resetMotionPages,
  type MotionPage,
} from "./browserMotion";
import type { LayoutNode } from "./layout";

function fakePage(capture: () => Promise<string | null>) {
  const log: string[] = [];
  const page: MotionPage = {
    capture,
    hold: async (src) => {
      log.push(`hold ${src}`);
      return true;
    },
    release: async () => {
      log.push("release");
    },
  };
  return { page, log };
}

describe("browser pages in motions", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    resetMotionPages();
    vi.useRealTimers();
  });

  it("keeps a picture of a live page without holding it", async () => {
    const web = fakePage(async () => "data:now");
    registerMotionPage("web", web.page);
    await refreshMotionImages(["web", "missing"]);
    expect(lastMotionImage("web")).toBe("data:now");
    expect(web.log).toEqual([]);
  });

  it("leaves a held page's picture alone", async () => {
    let shot = "data:held";
    const web = fakePage(async () => shot);
    registerMotionPage("web", web.page);
    await holdMotionPages(["web"]);
    shot = "data:later";
    await refreshMotionImages(["web"]);
    expect(lastMotionImage("web")).toBe("data:held");
  });

  it("keeps a page held by a later motion past the first one's timer", async () => {
    const web = fakePage(async () => "data:web");
    registerMotionPage("web", web.page);
    const first = await holdMotionPages(["web"]);
    releaseMotionPagesAfter(first, 200);
    await vi.advanceTimersByTimeAsync(100);
    const second = await holdMotionPages(["web"]);
    expect(second).toEqual(["web"]);
    releaseMotionPagesAfter(second, 200);
    // The first motion's time is up: the second one still has the page.
    await vi.advanceTimersByTimeAsync(140);
    expect(web.log).toEqual(["hold data:web"]);
    await vi.advanceTimersByTimeAsync(100);
    expect(web.log).toEqual(["hold data:web", "release"]);
  });

  it("does not capture a page already held", async () => {
    const capture = vi.fn(async () => "data:web");
    const web = fakePage(capture);
    registerMotionPage("web", web.page);
    await holdMotionPages(["web"]);
    await holdMotionPages(["web"]);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(web.log).toEqual(["hold data:web"]);
  });

  it("tells a hold when the motion has stopped waiting for it", async () => {
    let wanted: (() => boolean) | undefined;
    registerMotionPage("web", {
      capture: async () => "data:web",
      hold: (_src, stillWanted) => {
        wanted = stillWanted;
        return new Promise(() => {});
      },
      release: async () => {},
    });
    const holding = holdMotionPages(["web"], [], 80);
    await vi.advanceTimersByTimeAsync(0);
    expect(wanted?.()).toBe(true);
    await vi.advanceTimersByTimeAsync(80);
    expect(await holding).toEqual([]);
    expect(wanted?.()).toBe(false);
  });

  it("forgets a page's picture when the page changes", async () => {
    const web = fakePage(async () => "data:web");
    registerMotionPage("web", web.page);
    releaseMotionPages(await holdMotionPages(["web"]));
    forgetMotionImage("web");
    expect(lastMotionImage("web")).toBeUndefined();
  });

  it("names only the panes a layout change moves", () => {
    const pane = (id: string) => ({ type: "leaf" as const, id });
    const split = (
      id: string,
      dir: "right" | "down",
      children: LayoutNode[],
      sizes: number[],
    ): LayoutNode => ({ type: "split", id, dir, children, sizes });
    const before = split("s", "right", [pane("a"), pane("b")], [1, 1]);
    // The right half splits: the left pane keeps its place.
    const after = split(
      "s",
      "right",
      [pane("a"), split("t", "down", [pane("b"), pane("c")], [1, 1])],
      [1, 1],
    );
    expect([...panesMoved(before, after)].sort()).toEqual(["b", "c"]);
    expect(panesMoved(before, before).size).toBe(0);
    // Sizes count as shares, however they are written.
    expect(
      panesMoved(before, split("s", "right", [pane("a"), pane("b")], [50, 50]))
        .size,
    ).toBe(0);
    expect(
      [
        ...panesMoved(
          before,
          split("s", "right", [pane("b"), pane("a")], [1, 1]),
        ),
      ].sort(),
    ).toEqual(["a", "b"]);
  });

  it("captures live pages, holds them with their picture and remembers it", async () => {
    const web = fakePage(async () => "data:web");
    registerMotionPage("web", web.page);
    const held = await holdMotionPages(["web", "missing"]);
    expect(held).toEqual(["web"]);
    expect(web.log).toEqual(["hold data:web"]);
    expect(lastMotionImage("web")).toBe("data:web");
    releaseMotionPages(held);
    await Promise.resolve();
    expect(web.log).toEqual(["hold data:web", "release"]);
  });

  it("holds a page coming into view with the last picture of it", async () => {
    const web = fakePage(async () => "data:first");
    registerMotionPage("web", web.page);
    releaseMotionPages(await holdMotionPages(["web"]));
    web.log.length = 0;
    expect(await holdMotionPages([], ["web"])).toEqual(["web"]);
    expect(web.log).toEqual(["hold data:first"]);
    // A page never pictured is not held: it simply appears.
    const other = fakePage(async () => "data:other");
    registerMotionPage("other", other.page);
    expect(await holdMotionPages([], ["other"])).toEqual([]);
  });

  it("leaves a page live when its capture misses the deadline", async () => {
    let finish!: (src: string) => void;
    const slow = fakePage(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    registerMotionPage("slow", slow.page);
    const pending = holdMotionPages(["slow"], [], 80);
    await vi.advanceTimersByTimeAsync(80);
    expect(await pending).toEqual([]);
    // Arriving late, its picture is not used: the page stays live.
    finish("data:late");
    await vi.advanceTimersByTimeAsync(0);
    expect(slow.log).toEqual([]);
  });

  it("lets a page go at once when hiding it finishes after the deadline", async () => {
    const log: string[] = [];
    let hidden!: (ok: boolean) => void;
    registerMotionPage("web", {
      capture: async () => "data:web",
      hold: () =>
        new Promise<boolean>((resolve) => {
          log.push("hold");
          hidden = resolve;
        }),
      release: async () => {
        log.push("release");
      },
    });
    const pending = holdMotionPages(["web"], [], 80);
    await vi.advanceTimersByTimeAsync(80);
    expect(await pending).toEqual([]);
    hidden(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(["hold", "release"]);
  });

  it("skips a page that is not showing and has no picture", async () => {
    const hidden = fakePage(async () => null);
    registerMotionPage("hidden", hidden.page);
    expect(await holdMotionPages(["hidden"])).toEqual([]);
    expect(hidden.log).toEqual([]);
  });

  it("forgets a page and its picture once its pane goes", async () => {
    const web = fakePage(async () => "data:web");
    const unregister = registerMotionPage("web", web.page);
    await holdMotionPages(["web"]);
    unregister();
    expect(lastMotionImage("web")).toBeUndefined();
    expect(await holdMotionPages(["web"])).toEqual([]);
  });
});

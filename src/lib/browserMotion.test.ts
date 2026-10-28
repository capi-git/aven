import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  holdMotionPages,
  lastMotionImage,
  registerMotionPage,
  releaseMotionPages,
  resetMotionPages,
  type MotionPage,
} from "./browserMotion";

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

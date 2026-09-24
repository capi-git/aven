import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BrowserMemoryPool,
  BROWSER_LEAN_SLEEP_AFTER_MS,
  BROWSER_SLEEP_AFTER_MS,
} from "./browserMemory";

describe("balanced browser memory", () => {
  let pool: BrowserMemoryPool;
  let dispose: Array<() => void>;
  beforeEach(() => {
    vi.useFakeTimers();
    pool = new BrowserMemoryPool();
    dispose = [];
  });
  afterEach(() => {
    dispose.forEach((stop) => stop());
    vi.useRealTimers();
  });
  function add(id: string, visible = false, protectedPage = false) {
    const sleep = vi.fn().mockResolvedValue(true);
    const registration = pool.register(id, {
      visible,
      protected: protectedPage,
      sleep,
    });
    dispose.push(registration.dispose);
    return { ...registration, sleep };
  }
  it("keeps the three recent pages ready and only sleeps an older page after five inactive minutes", async () => {
    const pages = [add("a"), add("b"), add("c"), add("d", true)];
    await vi.advanceTimersByTimeAsync(BROWSER_SLEEP_AFTER_MS - 1);
    pages.forEach(({ sleep }) => expect(sleep).not.toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(1);
    expect(pages[0].sleep).toHaveBeenCalledOnce();
    pages.slice(1).forEach(({ sleep }) => expect(sleep).not.toHaveBeenCalled());
  });
  it("promotes a revisited tab and restarts its idle grace period", async () => {
    const a = add("a");
    const b = add("b");
    add("c");
    add("d");
    await vi.advanceTimersByTimeAsync(BROWSER_SLEEP_AFTER_MS - 30_000);
    a.update({ visible: true, protected: false });
    a.update({ visible: false, protected: false });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(a.sleep).not.toHaveBeenCalled();
    expect(b.sleep).toHaveBeenCalledOnce();
  });
  it("never sleeps visible or protected pages", async () => {
    const visible = add("visible", true);
    const protectedPage = add("protected", false, true);
    add("a");
    add("b");
    add("c");
    await vi.advanceTimersByTimeAsync(BROWSER_SLEEP_AFTER_MS);
    expect(visible.sleep).not.toHaveBeenCalled();
    expect(protectedPage.sleep).not.toHaveBeenCalled();
  });
  it("honors the off switch and stops its timer when the last page leaves", async () => {
    const a = add("a");
    add("b");
    add("c");
    add("d");
    pool.enabled = false;
    await vi.advanceTimersByTimeAsync(BROWSER_SLEEP_AFTER_MS);
    expect(a.sleep).not.toHaveBeenCalled();
    dispose.forEach((stop) => stop());
    expect(vi.getTimerCount()).toBe(0);
  });
  it("serializes probes and rechecks recency and visibility after an awaited close", async () => {
    const a = add("a");
    const b = add("b");
    add("c");
    add("d");
    add("e");
    let finish!: (value: boolean) => void;
    a.sleep.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await vi.advanceTimersByTimeAsync(BROWSER_SLEEP_AFTER_MS);
    expect(a.sleep).toHaveBeenCalledOnce();
    b.update({ visible: true, protected: false });
    await pool.check();
    expect(a.sleep).toHaveBeenCalledOnce();
    finish(true);
    await Promise.resolve();
    expect(b.sleep).not.toHaveBeenCalled();
  });
  it("keeps one ready tab and sleeps sooner in lightweight mode", async () => {
    pool.lean = true;
    const [a, b, visible] = [add("a"), add("b"), add("visible", true)];
    await vi.advanceTimersByTimeAsync(BROWSER_LEAN_SLEEP_AFTER_MS - 1);
    expect(a.sleep).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(a.sleep).toHaveBeenCalledOnce();
    expect(b.sleep).toHaveBeenCalledOnce();
    expect(visible.sleep).not.toHaveBeenCalled();
  });

  it("sleeps hidden pages immediately under memory pressure", async () => {
    const [a, b, c, visible, protectedPage] = [
      add("a"),
      add("b"),
      add("c"),
      add("visible", true),
      add("protected", false, true),
    ];
    await pool.relieve("warn");
    expect(a.sleep).toHaveBeenCalledOnce();
    expect(b.sleep).toHaveBeenCalledOnce();
    expect(c.sleep).not.toHaveBeenCalled();
    expect(visible.sleep).not.toHaveBeenCalled();
    expect(protectedPage.sleep).not.toHaveBeenCalled();
    await pool.relieve("critical");
    expect(c.sleep).toHaveBeenCalledOnce();
    expect(visible.sleep).not.toHaveBeenCalled();
    expect(protectedPage.sleep).not.toHaveBeenCalled();
    pool.enabled = false;
    const late = add("late");
    await pool.relieve("critical");
    expect(late.sleep).not.toHaveBeenCalled();
  });
  it("a stale cleanup does not remove a replacement page", async () => {
    const old = add("a");
    const current = add("a");
    add("b");
    add("c");
    add("d");
    old.dispose();
    await vi.advanceTimersByTimeAsync(BROWSER_SLEEP_AFTER_MS);
    expect(current.sleep).toHaveBeenCalledOnce();
    expect(old.sleep).not.toHaveBeenCalled();
  });
});

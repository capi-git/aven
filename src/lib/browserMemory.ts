import {
  loadBrowserLowMemory,
  loadBrowserMemorySaver,
  subscribeBrowserLowMemory,
  subscribeBrowserMemorySaver,
} from "./settings";
import {
  subscribeMemoryPressure,
  type MemoryPressureLevel,
} from "./memoryPressure";

export const BROWSER_SLEEP_AFTER_MS = 5 * 60_000;
export const BROWSER_RECENT_TABS = 3;
/** With the Lightweight browser setting, fewer tabs stay ready for less time. */
export const BROWSER_LEAN_SLEEP_AFTER_MS = 2 * 60_000;
export const BROWSER_LEAN_RECENT_TABS = 1;
const CHECK_INTERVAL_MS = 30_000;

type Page = {
  visible: boolean;
  protected: boolean;
  sleep(): Promise<boolean>;
};
type Entry = Page & {
  lastUsed: number;
  hiddenAt: number;
  pending: boolean;
};

/** One inexpensive sweep per window, rather than a timer for every retained tab. */
export class BrowserMemoryPool {
  private pages = new Map<string, Entry>();
  private order = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private checking = false;
  private active = true;
  /** A pressure notice that arrived while a sweep was running. */
  private pendingRelief: {
    level: MemoryPressureLevel;
    done: Promise<void>;
    finish: () => void;
  } | null = null;
  /** Lightweight browser mode: keep fewer tabs ready and sleep them sooner. */
  lean = false;

  get enabled() {
    return this.active;
  }
  set enabled(value: boolean) {
    this.active = value;
    this.syncTimer();
  }

  private syncTimer() {
    const ready = this.lean ? BROWSER_LEAN_RECENT_TABS : BROWSER_RECENT_TABS;
    if (this.active && this.pages.size > ready) {
      if (!this.timer)
        this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
    } else if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  get size() {
    return this.pages.size;
  }

  register(id: string, page: Page) {
    const entry: Entry = {
      ...page,
      lastUsed: ++this.order,
      hiddenAt: Date.now(),
      pending: false,
    };
    this.pages.set(id, entry);
    this.syncTimer();
    return {
      update: (next: Pick<Page, "visible" | "protected">) => {
        if (this.pages.get(id) !== entry) return;
        if (next.visible && !entry.visible) entry.lastUsed = ++this.order;
        if (next.visible !== entry.visible) entry.hiddenAt = Date.now();
        Object.assign(entry, next);
      },
      dispose: () => {
        if (this.pages.get(id) !== entry) return;
        this.pages.delete(id);
        this.syncTimer();
      },
    };
  }

  /**
   * The system is short of memory: sleep every hidden page now rather than
   * after its grace period. The most recent hidden page stays ready under
   * ordinary pressure; a critical notice releases it too.
   */
  async relieve(level: MemoryPressureLevel): Promise<void> {
    if (this.checking) {
      // The running sweep finishes first; the stronger notice wins.
      if (!this.pendingRelief) {
        let finish!: () => void;
        const done = new Promise<void>((resolve) => (finish = resolve));
        this.pendingRelief = { level, done, finish };
      } else if (level === "critical") this.pendingRelief.level = level;
      return this.pendingRelief.done;
    }
    await this.check({
      keepRecent: level === "critical" ? 0 : 1,
      graceMs: 0,
      hiddenOnly: true,
    });
  }

  async check(
    { keepRecent, graceMs, hiddenOnly } = {
      keepRecent: this.lean ? BROWSER_LEAN_RECENT_TABS : BROWSER_RECENT_TABS,
      graceMs: this.lean ? BROWSER_LEAN_SLEEP_AFTER_MS : BROWSER_SLEEP_AFTER_MS,
      // The ordinary sweep counts visible tabs among the recent ones, so three
      // ready tabs may include the visible one. Lightweight mode promises the
      // most recent inactive tab, so it counts hidden tabs only.
      hiddenOnly: this.lean,
    },
  ) {
    if (!this.enabled || this.checking) return;
    this.checking = true;
    try {
      const candidates = [...this.pages.entries()].sort(
        ([, a], [, b]) => a.lastUsed - b.lastUsed,
      );
      for (const [id, entry] of candidates) {
        // Recompute after each await: another tab may have become recent.
        const recent = [...this.pages.values()]
          .filter((page) => !hiddenOnly || (!page.visible && !page.protected))
          .sort((a, b) => b.lastUsed - a.lastUsed)
          .slice(0, keepRecent);
        if (
          !this.enabled ||
          this.pages.get(id) !== entry ||
          entry.visible ||
          entry.protected ||
          entry.pending ||
          recent.includes(entry) ||
          Date.now() - entry.hiddenAt < graceMs
        )
          continue;
        entry.pending = true;
        try {
          await entry.sleep();
        } catch {
          // Eligibility failures leave the page intact; try on a later sweep.
        } finally {
          entry.pending = false;
        }
      }
    } finally {
      this.checking = false;
    }
    const pending = this.pendingRelief;
    this.pendingRelief = null;
    if (pending) {
      try {
        await this.relieve(pending.level);
      } finally {
        pending.finish();
      }
    }
  }
}

const pool = new BrowserMemoryPool();
let unsubscribe: (() => void) | undefined;

export function registerBrowserMemoryPage(id: string, page: Page) {
  if (!unsubscribe) {
    const update = () => {
      pool.lean = loadBrowserLowMemory();
      pool.enabled = loadBrowserMemorySaver();
    };
    update();
    const unsubscribeSaver = subscribeBrowserMemorySaver(update);
    const unsubscribeLean = subscribeBrowserLowMemory(update);
    const unsubscribeSetting = () => {
      unsubscribeSaver();
      unsubscribeLean();
    };
    const unsubscribePressure = subscribeMemoryPressure(
      (level) => void pool.relieve(level),
    );
    unsubscribe = () => {
      unsubscribeSetting();
      unsubscribePressure();
    };
  }
  const registration = pool.register(id, page);
  return {
    update: registration.update,
    dispose() {
      registration.dispose();
      if (!pool.size) {
        unsubscribe?.();
        unsubscribe = undefined;
      }
    },
  };
}

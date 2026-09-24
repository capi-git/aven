import {
  loadBrowserMemorySaver,
  subscribeBrowserMemorySaver,
} from "./settings";

export const BROWSER_SLEEP_AFTER_MS = 5 * 60_000;
export const BROWSER_RECENT_TABS = 3;
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

  get enabled() {
    return this.active;
  }
  set enabled(value: boolean) {
    this.active = value;
    this.syncTimer();
  }

  private syncTimer() {
    if (this.active && this.pages.size > BROWSER_RECENT_TABS) {
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

  async check() {
    if (!this.enabled || this.checking) return;
    this.checking = true;
    try {
      const candidates = [...this.pages.entries()].sort(
        ([, a], [, b]) => a.lastUsed - b.lastUsed,
      );
      for (const [id, entry] of candidates) {
        // Recompute after each await: another tab may have become recent.
        const recent = [...this.pages.values()]
          .sort((a, b) => b.lastUsed - a.lastUsed)
          .slice(0, BROWSER_RECENT_TABS);
        if (
          !this.enabled ||
          this.pages.get(id) !== entry ||
          entry.visible ||
          entry.protected ||
          entry.pending ||
          recent.includes(entry) ||
          Date.now() - entry.hiddenAt < BROWSER_SLEEP_AFTER_MS
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
  }
}

const pool = new BrowserMemoryPool();
let unsubscribe: (() => void) | undefined;

export function registerBrowserMemoryPage(id: string, page: Page) {
  if (!unsubscribe) {
    const update = () => {
      pool.enabled = loadBrowserMemorySaver();
    };
    update();
    unsubscribe = subscribeBrowserMemorySaver(update);
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

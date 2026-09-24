import { listen } from "@tauri-apps/api/event";
import {
  loadBrowserMemorySaver,
  subscribeBrowserMemorySaver,
} from "./settings";

/** Published by the host when macOS reports memory pressure. */
export const MEMORY_PRESSURE_EVENT = "aven:memory-pressure";
export type MemoryPressureLevel = "warn" | "critical";

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

  /**
   * The system is short of memory: sleep every hidden page now rather than
   * after its grace period. The most recent hidden page stays ready under
   * ordinary pressure; a critical notice releases it too.
   */
  relieve(level: MemoryPressureLevel) {
    return this.check({
      keepRecent: level === "critical" ? 0 : 1,
      graceMs: 0,
      hiddenOnly: true,
    });
  }

  async check(
    { keepRecent, graceMs, hiddenOnly } = {
      keepRecent: BROWSER_RECENT_TABS,
      graceMs: BROWSER_SLEEP_AFTER_MS,
      // The ordinary sweep counts visible tabs among the recent ones.
      hiddenOnly: false,
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
    const unsubscribeSetting = subscribeBrowserMemorySaver(update);
    let disposed = false;
    let unlistenPressure: (() => void) | undefined;
    void listen<{ level: MemoryPressureLevel }>(
      MEMORY_PRESSURE_EVENT,
      (event) => void pool.relieve(event.payload.level),
    )
      .then((unlisten) => {
        if (disposed) unlisten();
        else unlistenPressure = unlisten;
      })
      .catch(() => {
        // Browser previews have no host events.
      });
    unsubscribe = () => {
      disposed = true;
      unsubscribeSetting();
      unlistenPressure?.();
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

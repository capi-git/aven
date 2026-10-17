/**
 * A small saved record per chat, keyed by its id: what its last turn left to
 * review, or how it shipped. Every window reads the same records from local
 * storage; another window's write arrives as a `storage` event. Records are
 * plain data and few (the newest `limit`), so reading them is cheap.
 */
export type ChatRecord = { sessionId: string; at: number };

export type ChatRecordStore<T extends ChatRecord> = {
  /** Every record by chat id; the same object until a record changes. */
  snapshot(): Readonly<Record<string, T>>;
  subscribe(listener: () => void): () => void;
  /**
   * Replace records: `change` gets the current ones and returns the next, or
   * the same object to change nothing.
   */
  update(
    change: (
      current: Readonly<Record<string, T>>,
    ) => Readonly<Record<string, T>>,
  ): void;
};

const NONE: Readonly<Record<string, never>> = Object.freeze({});

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function createChatRecordStore<T extends ChatRecord>({
  key,
  limit,
  parse,
}: {
  key: string;
  /** Records kept, newest first. */
  limit: number;
  /** A saved record, checked; null drops it. */
  parse: (value: unknown) => T | null;
}): ChatRecordStore<T> {
  let cache: {
    raw: string | null;
    records: Readonly<Record<string, T>>;
  } | null = null;
  const listeners = new Set<() => void>();

  const read = (): Readonly<Record<string, T>> => {
    let raw: string | null = null;
    try {
      raw = storage()?.getItem(key) ?? null;
    } catch {
      raw = null;
    }
    if (cache && cache.raw === raw) return cache.records;
    let records: Record<string, T> = {};
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      const list =
        parsed &&
        typeof parsed === "object" &&
        (parsed as { version?: unknown }).version === 1 &&
        Array.isArray((parsed as { records?: unknown }).records)
          ? ((parsed as { records: unknown[] }).records ?? [])
          : [];
      for (const entry of list) {
        const record = parse(entry);
        if (record) records[record.sessionId] = record;
      }
    } catch {
      records = {};
    }
    cache = {
      raw,
      records: Object.keys(records).length
        ? records
        : (NONE as Record<string, T>),
    };
    return cache.records;
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== key) return;
    cache = null;
    for (const listener of [...listeners]) listener();
  };

  return {
    snapshot: read,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1 && typeof window !== "undefined")
        window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && typeof window !== "undefined")
          window.removeEventListener("storage", onStorage);
      };
    },
    update(change) {
      const current = read();
      const next = change(current);
      if (next === current) return;
      const kept = Object.values(next)
        .sort((a, b) => b.at - a.at)
        .slice(0, limit);
      const raw = JSON.stringify({ version: 1, records: kept });
      let saved: string | null = null;
      try {
        storage()?.setItem(key, raw);
        saved = storage()?.getItem(key) ?? null;
      } catch {
        // Storage full or unavailable: the records still work this session,
        // kept against what storage still holds.
        try {
          saved = storage()?.getItem(key) ?? null;
        } catch {
          saved = null;
        }
      }
      const records: Record<string, T> = {};
      for (const record of kept) records[record.sessionId] = record;
      cache = {
        raw: saved,
        records: kept.length ? records : (NONE as Record<string, T>),
      };
      for (const listener of [...listeners]) listener();
    },
  };
}

export function finiteTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function shortText(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value ? value.slice(0, max) : undefined;
}

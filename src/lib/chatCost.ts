/**
 * Money spent per chat per day, for the bottom bar's cost button.
 *
 * Only Claude reports a price: every turn's `result` carries
 * `total_cost_usd`, the running total of the CLI process. A turn's cost is
 * the rise since the last total. Other providers report no price, so their
 * chats add nothing here and the button hides when nothing is known.
 */

export const CHAT_COST_KEY = "aven.chatCost";
/** Days kept: enough for this week and last. */
const KEEP_DAYS = 14;

export type CostLedger = {
  /** Local day (YYYY-MM-DD) to chat id to dollars spent that day. */
  days: Record<string, Record<string, number>>;
  /** The last running total each chat's CLI reported. */
  totals: Record<string, number>;
};

export type CostSummary = {
  today: number;
  /** Today's chats, most spent first. */
  byChat: { chatId: string; usd: number }[];
  /** Since Monday, today included. */
  week: number;
};

export const emptyLedger = (): CostLedger => ({ days: {}, totals: {} });

export function dayKey(time: number): string {
  const date = new Date(time);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const validUsd = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/**
 * What one turn cost, from the CLI's running total.
 *
 * `processLast` is the total this CLI process reported before; `savedLast` is
 * the chat's last total from any process. A new process may start from zero
 * or carry on from the total it saved, so its first total counts in full
 * only when it is below the saved one (a fresh start).
 */
export function turnCost(
  total: number,
  processLast: number | undefined,
  savedLast: number | undefined,
): number {
  if (!validUsd(total)) return 0;
  const before = processLast ?? savedLast;
  if (before == null || total < before) return total;
  return total - before;
}

/** Adds a turn's cost to a chat's day, and forgets days past keeping. */
export function addCost(
  ledger: CostLedger,
  chatId: string,
  usd: number,
  at: number,
  total?: number,
): CostLedger {
  const key = dayKey(at);
  const days = { ...ledger.days };
  if (validUsd(usd) && usd > 0) {
    const day = { ...days[key] };
    day[chatId] = (day[chatId] ?? 0) + usd;
    days[key] = day;
  }
  const oldest = dayKey(at - (KEEP_DAYS - 1) * 86_400_000);
  for (const day of Object.keys(days)) if (day < oldest) delete days[day];
  const totals =
    total != null && validUsd(total)
      ? { ...ledger.totals, [chatId]: total }
      : ledger.totals;
  return { days, totals };
}

/** Monday of the week holding `now`, local time. */
function weekStart(now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.getTime();
}

export function costSummary(ledger: CostLedger, now: number): CostSummary {
  const today = ledger.days[dayKey(now)] ?? {};
  const byChat = Object.entries(today)
    .filter(([, usd]) => validUsd(usd) && usd > 0)
    .map(([chatId, usd]) => ({ chatId, usd }))
    .sort((a, b) => b.usd - a.usd);
  const monday = dayKey(weekStart(now));
  const tomorrow = dayKey(now + 86_400_000);
  let week = 0;
  for (const [day, chats] of Object.entries(ledger.days)) {
    if (day < monday || day >= tomorrow) continue;
    for (const usd of Object.values(chats)) if (validUsd(usd)) week += usd;
  }
  return {
    today: byChat.reduce((sum, row) => sum + row.usd, 0),
    byChat,
    week,
  };
}

/** $1.77, $0.04, and under a cent as <$0.01. */
export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0.00";
  if (usd < 0.01) return "<$0.01";
  if (usd >= 1000) return `$${Math.round(usd).toLocaleString("en-GB")}`;
  return `$${usd.toFixed(2)}`;
}

// --- Saved ledger -----------------------------------------------------------

function parse(raw: string | null): CostLedger {
  try {
    const value = JSON.parse(raw ?? "null") as Partial<CostLedger> | null;
    if (!value || typeof value !== "object") return emptyLedger();
    const days = value.days && typeof value.days === "object" ? value.days : {};
    const totals =
      value.totals && typeof value.totals === "object" ? value.totals : {};
    return { days, totals };
  } catch {
    return emptyLedger();
  }
}

function read(): CostLedger {
  try {
    return parse(localStorage.getItem(CHAT_COST_KEY));
  } catch {
    return emptyLedger();
  }
}

let cached: CostLedger | null = null;
let version = 0;
const listeners = new Set<() => void>();

function changed(next: CostLedger) {
  cached = next;
  version += 1;
  for (const listener of listeners) listener();
}

export function loadCostLedger(): CostLedger {
  cached ??= read();
  return cached;
}

/** Changes whenever a cost is recorded here or in another window. */
export function costLedgerVersion(): number {
  return version;
}

export function subscribeCostLedger(listener: () => void): () => void {
  if (!listeners.size && typeof window !== "undefined")
    window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && typeof window !== "undefined")
      window.removeEventListener("storage", onStorage);
  };
}

function onStorage(event: StorageEvent) {
  if (event.key === CHAT_COST_KEY) changed(parse(event.newValue));
}

/**
 * Records a Claude turn's running total for a chat and returns it, for the
 * caller to keep as this process's last total. Each window runs its own
 * chats, so the saved ledger is read again before writing.
 */
export function recordClaudeCost(
  chatId: string,
  total: unknown,
  processLast: number | undefined,
  at = Date.now(),
): number | undefined {
  if (!validUsd(total)) return processLast;
  const ledger = read();
  const usd = turnCost(total, processLast, ledger.totals[chatId]);
  const next = addCost(ledger, chatId, usd, at, total);
  try {
    localStorage.setItem(CHAT_COST_KEY, JSON.stringify(next));
  } catch {
    /* A full quota keeps the cost for this window only. */
  }
  changed(next);
  return total;
}

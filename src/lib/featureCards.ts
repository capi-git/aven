import { invoke, isTauri } from "@tauri-apps/api/core";
import { errorText, logError } from "./errors";
import { projectKey } from "./paths";
import { memoryProjectFor } from "./projectMemory";
import { normalizeProjectPath } from "./recents";

/**
 * The project board's cards: features you want built. A card starts as an
 * idea, links to the chats that build it, and moves through Building and
 * Review to Shipped by itself as those chats work (see `workBoard`), or by
 * hand. Cards are kept in Aven's own data per project (native storage, beside
 * project memory), never in the project's files.
 */
export type FeatureColumn = "idea" | "building" | "review" | "shipped";

export const FEATURE_COLUMNS: readonly FeatureColumn[] = [
  "idea",
  "building",
  "review",
  "shipped",
];

export type FeatureCard = {
  id: string;
  title: string;
  note?: string;
  column: FeatureColumn;
  /** The chats building it, oldest first. */
  chatIds: string[];
  createdAt: number;
  updatedAt: number;
  /** When it entered its column. */
  movedAt: number;
  shippedAt?: number;
  /** Where it came from, such as a GitHub issue. */
  sourceUrl?: string;
  /**
   * Its chats' state when its column was last decided, by hand or by itself
   * (see `cardBasis`). A card follows its chats again once this changes, so
   * a move by hand holds until the next real change.
   */
  basis?: string;
};

/** Counted in characters; native storage enforces the same limits. */
export const FEATURE_TITLE_MAX = 200;
export const FEATURE_NOTE_MAX = 4_000;
const CHATS_KEPT = 50;

/** Where cards are kept. */
export type FeatureCardBackend = {
  list(key: string): Promise<FeatureCard[]>;
  put(key: string, path: string, card: FeatureCard): Promise<FeatureCard>;
  remove(key: string, id: string): Promise<void>;
  clear(key: string): Promise<void>;
};

const nativeBackend: FeatureCardBackend = {
  list: (key) => invoke<FeatureCard[]>("feature_cards_list", { key }),
  put: (key, path, card) =>
    invoke<FeatureCard>("feature_card_put", { key, path, card }),
  remove: (key, id) => invoke("feature_card_delete", { key, id }),
  clear: (key) => invoke("feature_cards_clear", { key }),
};

/** Cards kept for as long as the page: a browser preview, or a test. */
export function memoryFeatureCardBackend(): FeatureCardBackend {
  const rows = new Map<string, Map<string, FeatureCard>>();
  const of = (key: string) => {
    let cards = rows.get(key);
    if (!cards) rows.set(key, (cards = new Map()));
    return cards;
  };
  return {
    list: async (key) =>
      [...of(key).values()]
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
        .map((card) => ({ ...card, chatIds: [...card.chatIds] })),
    put: async (key, _path, card) => {
      const saved = { ...card, chatIds: [...card.chatIds] };
      of(key).set(card.id, saved);
      return { ...saved, chatIds: [...saved.chatIds] };
    },
    remove: async (key, id) => {
      of(key).delete(id);
    },
    clear: async (key) => {
      rows.delete(key);
    },
  };
}

/** One project's board as drawn: its cards once read, and a failed save. */
export type FeatureBoardState = {
  readonly cards: readonly FeatureCard[];
  readonly loaded: boolean;
  /** Why the last read or save failed, in plain words. */
  readonly error?: string;
};

type Entry = {
  key: string;
  path: string;
  state: FeatureBoardState;
  loading: Promise<void> | null;
  /** Bumped by each local change, so a read that started before it is dropped. */
  revision: number;
  /** Saves not yet confirmed; a read while one is out could miss it. */
  writes: number;
  /** What the shown error came from: a read clears only its own. */
  failed: "read" | "save" | null;
};

const NOT_LOADED: FeatureBoardState = Object.freeze({
  cards: Object.freeze([]) as readonly FeatureCard[],
  loaded: false,
});

let backend: FeatureCardBackend | null = null;
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

function currentBackend(): FeatureCardBackend {
  return (backend ??= isTauri() ? nativeBackend : memoryFeatureCardBackend());
}

/** Swap where cards are kept, forgetting what was read (tests). */
export function setFeatureCardBackend(next: FeatureCardBackend | null): void {
  backend = next;
  entries.clear();
  notify();
}

function notify() {
  for (const listener of [...listeners]) listener();
}

export function subscribeFeatureCards(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The key a project's cards are saved under, like its other data. */
export function featureCardsKey(project: string): string {
  return projectKey(normalizeProjectPath(project));
}

function entryFor(project: string): Entry {
  const key = featureCardsKey(project);
  let entry = entries.get(key);
  if (!entry) {
    entry = {
      key,
      path: normalizeProjectPath(project),
      state: NOT_LOADED,
      loading: null,
      revision: 0,
      writes: 0,
      failed: null,
    };
    entries.set(key, entry);
  }
  return entry;
}

function setState(entry: Entry, next: Partial<FeatureBoardState>) {
  entry.state = Object.freeze({ ...entry.state, ...next });
  notify();
}

/** The board's cards as last read or changed here; the same object until one changes. */
export function featureBoardState(project: string): FeatureBoardState {
  return entries.get(featureCardsKey(project))?.state ?? NOT_LOADED;
}

/**
 * Read a project's cards from storage. `refresh` reads again even when they
 * were read before, as a board does when it comes on screen, so a card
 * added from another window shows. A read never undoes a change made here
 * while it was out.
 */
export function loadFeatureCards(
  project: string,
  { refresh = false }: { refresh?: boolean } = {},
): Promise<void> {
  const entry = entryFor(project);
  if (entry.loading) return entry.loading;
  if (entry.state.loaded && !refresh) return Promise.resolve();
  const revision = entry.revision;
  const loading = currentBackend()
    .list(entry.key)
    .then(
      (cards) => {
        if (entry.revision !== revision || entry.writes) {
          if (!entry.state.loaded) setState(entry, { loaded: true });
          return;
        }
        const known = entry.state.cards;
        const same =
          entry.state.loaded &&
          known.length === cards.length &&
          known.every((card, index) => sameCard(card, cards[index]));
        const cleared = entry.failed === "read" ? { error: undefined } : {};
        if (entry.failed === "read") entry.failed = null;
        if (same) {
          if ("error" in cleared) setState(entry, cleared);
          return;
        }
        setState(entry, {
          cards: Object.freeze(cards.map(cleanCard)),
          loaded: true,
          ...cleared,
        });
      },
      (error) => {
        logError("Board", error);
        entry.failed = "read";
        setState(entry, {
          loaded: true,
          error: `Couldn't read the board: ${errorText(error)}`,
        });
      },
    )
    .finally(() => {
      entry.loading = null;
    });
  entry.loading = loading;
  return loading;
}

/** One line of plain text, at most `max` characters. */
function oneLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

function cleanNote(text: string | undefined): string | undefined {
  const note = (text ?? "").replace(/\r\n?/g, "\n").trim();
  return note ? note.slice(0, FEATURE_NOTE_MAX) : undefined;
}

/** Whether two cards read the same, whatever order their fields came in. */
function sameCard(a: FeatureCard, b: FeatureCard | undefined): boolean {
  if (!b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const left = a[key as keyof FeatureCard];
    const right = b[key as keyof FeatureCard];
    if (Array.isArray(left) || Array.isArray(right)) {
      if (
        !Array.isArray(left) ||
        !Array.isArray(right) ||
        left.join("\n") !== right.join("\n")
      )
        return false;
    } else if (left !== right) return false;
  }
  return true;
}

/** A read card in the shape this build keeps. */
function cleanCard(card: FeatureCard): FeatureCard {
  return {
    ...card,
    chatIds: Array.isArray(card.chatIds) ? card.chatIds : [],
  };
}

const now = () => Math.round(Date.now());

/**
 * Apply a change to the project's cards here at once, then save the cards it
 * touched. A failed save says so on the board and reads the board again.
 */
async function change(
  project: string,
  edit: (cards: readonly FeatureCard[]) => {
    cards: readonly FeatureCard[];
    saved?: readonly FeatureCard[];
    removed?: readonly string[];
  } | null,
): Promise<boolean> {
  const entry = entryFor(project);
  await loadFeatureCards(project);
  const result = edit(entry.state.cards);
  if (!result) return false;
  entry.revision += 1;
  setState(entry, { cards: Object.freeze([...result.cards]) });
  const store = currentBackend();
  entry.writes += 1;
  let failure: unknown = null;
  try {
    await Promise.all([
      ...(result.saved ?? []).map((card) =>
        store.put(entry.key, entry.path, card),
      ),
      ...(result.removed ?? []).map((id) => store.remove(entry.key, id)),
    ]);
  } catch (error) {
    failure = error ?? "Unknown error";
  } finally {
    entry.writes -= 1;
  }
  if (failure === null) {
    entry.failed = null;
    if (entry.state.error) setState(entry, { error: undefined });
    return true;
  }
  logError("Board", failure);
  entry.failed = "save";
  setState(entry, { error: `Couldn't save the board: ${errorText(failure)}` });
  // Show what storage really holds, after any read already out.
  entry.revision += 1;
  if (entry.loading) await entry.loading;
  await loadFeatureCards(project, { refresh: true });
  return false;
}

export type FeatureCardDraft = {
  title: string;
  note?: string;
  sourceUrl?: string;
  column?: FeatureColumn;
  chatIds?: readonly string[];
  /** Its chats' state as its column was decided; see `cardBasis`. */
  basis?: string;
};

function newCard(draft: FeatureCardDraft, at: number): FeatureCard | null {
  const title = oneLine(draft.title, FEATURE_TITLE_MAX);
  if (!title) return null;
  const note = cleanNote(draft.note);
  const sourceUrl = draft.sourceUrl?.trim();
  const column = draft.column ?? "idea";
  return {
    id: crypto.randomUUID(),
    title,
    ...(note ? { note } : {}),
    column,
    chatIds: [...new Set(draft.chatIds ?? [])].slice(-CHATS_KEPT),
    createdAt: at,
    updatedAt: at,
    movedAt: at,
    ...(column === "shipped" ? { shippedAt: at } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(draft.basis !== undefined ? { basis: draft.basis } : {}),
  };
}

/** Add cards; blank titles are skipped. Returns the cards added. */
export async function addFeatureCards(
  project: string,
  drafts: readonly FeatureCardDraft[],
): Promise<FeatureCard[]> {
  const at = now();
  const added = drafts
    .map((draft) => newCard(draft, at))
    .filter((card): card is FeatureCard => !!card);
  if (!added.length) return [];
  const saved = await change(project, (cards) => ({
    cards: [...cards, ...added],
    saved: added,
  }));
  return saved ? added : [];
}

/**
 * Add to board: a card per chat, titled from it, in the column its state
 * implies. A chat already on a card in the project adds nothing.
 */
export async function addChatsToBoard(
  project: string,
  drafts: readonly FeatureCardDraft[],
): Promise<FeatureCard[]> {
  await loadFeatureCards(project);
  const linked = new Set(
    featureBoardState(project).cards.flatMap((card) => card.chatIds),
  );
  return addFeatureCards(
    project,
    drafts.filter((draft) => !draft.chatIds?.some((id) => linked.has(id))),
  );
}

/**
 * The project whose board a chat in `cwd` goes on: a race lane's own
 * project; none for a scratch chat or a home folder.
 */
export function boardProjectFor(cwd: string | undefined): string | null {
  return memoryProjectFor(cwd);
}

/** Write down an idea: a new card in Ideas. */
export async function addFeatureIdea(
  project: string,
  draft: Pick<FeatureCardDraft, "title" | "note" | "sourceUrl">,
): Promise<FeatureCard | null> {
  return (await addFeatureCards(project, [draft]))[0] ?? null;
}

function replace(
  cards: readonly FeatureCard[],
  id: string,
  update: (card: FeatureCard) => FeatureCard | null,
) {
  const index = cards.findIndex((card) => card.id === id);
  if (index < 0) return null;
  const next = update(cards[index]);
  if (!next || next === cards[index]) return null;
  const all = [...cards];
  all[index] = next;
  return { cards: all, saved: [next] };
}

/** Change a card's title or note. A blank title keeps the old one. */
export function editFeatureCard(
  project: string,
  id: string,
  patch: { title?: string; note?: string },
): Promise<boolean> {
  return change(project, (cards) =>
    replace(cards, id, (card) => {
      const title =
        patch.title === undefined
          ? card.title
          : oneLine(patch.title, FEATURE_TITLE_MAX) || card.title;
      const note = patch.note === undefined ? card.note : cleanNote(patch.note);
      if (title === card.title && note === card.note) return null;
      const edited: FeatureCard = { ...card, title, updatedAt: now() };
      if (note) edited.note = note;
      else delete edited.note;
      return edited;
    }),
  );
}

function inColumn(
  card: FeatureCard,
  column: FeatureColumn,
  at: number,
  shippedAt?: number,
): FeatureCard {
  if (card.column === column) return card;
  const moved: FeatureCard = { ...card, column, movedAt: at };
  if (column === "shipped") moved.shippedAt = shippedAt ?? at;
  else delete moved.shippedAt;
  return moved;
}

/**
 * Move a card by hand. `basis` is its chats' state now, so it stays where it
 * was put until one of them really changes.
 */
export function moveFeatureCard(
  project: string,
  id: string,
  column: FeatureColumn,
  basis?: string,
): Promise<boolean> {
  return change(project, (cards) =>
    replace(cards, id, (card) => {
      if (card.column === column && card.basis === basis) return null;
      const at = now();
      const moved = inColumn(card, column, at);
      return {
        ...moved,
        updatedAt: at,
        ...(basis !== undefined ? { basis } : {}),
      };
    }),
  );
}

/**
 * Link a chat to a card (Build, Open as draft), optionally moving it as by
 * hand with its chats' state then.
 */
export function linkFeatureChat(
  project: string,
  id: string,
  chatId: string,
  move?: { column: FeatureColumn; basis?: string },
): Promise<boolean> {
  return change(project, (cards) =>
    replace(cards, id, (card) => {
      const at = now();
      const chatIds = [
        ...card.chatIds.filter((entry) => entry !== chatId),
        chatId,
      ].slice(-CHATS_KEPT);
      const moved = move ? inColumn(card, move.column, at) : card;
      return {
        ...moved,
        chatIds,
        updatedAt: at,
        ...(move?.basis !== undefined ? { basis: move.basis } : {}),
      };
    }),
  );
}

/** Where a card goes by itself after its chats changed (see `workBoard`). */
export type FeatureCardSettle = {
  id: string;
  /** The basis the move was worked out from; a card changed since is left alone. */
  from: string | undefined;
  basis: string;
  column: FeatureColumn;
  /** When its chats shipped, for a card that moves to Shipped. */
  shippedAt?: number;
};

/** Save where cards moved by themselves. A move by hand since then wins. */
export function settleFeatureCards(
  project: string,
  settles: readonly FeatureCardSettle[],
): Promise<boolean> {
  if (!settles.length) return Promise.resolve(false);
  return change(project, (cards) => {
    const byId = new Map(settles.map((settle) => [settle.id, settle]));
    const at = now();
    const saved: FeatureCard[] = [];
    const next = cards.map((card) => {
      const settle = byId.get(card.id);
      if (!settle || card.basis !== settle.from) return card;
      const moved = {
        ...inColumn(card, settle.column, at, settle.shippedAt),
        basis: settle.basis,
      };
      saved.push(moved);
      return moved;
    });
    return saved.length ? { cards: next, saved } : null;
  });
}

export function deleteFeatureCard(
  project: string,
  id: string,
): Promise<boolean> {
  return change(project, (cards) =>
    cards.some((card) => card.id === id)
      ? { cards: cards.filter((card) => card.id !== id), removed: [id] }
      : null,
  );
}

/** The card a chat is linked to in its project, if any. */
export function featureCardForChat(
  project: string,
  chatId: string,
): FeatureCard | undefined {
  return featureBoardState(project).cards.find((card) =>
    card.chatIds.includes(chatId),
  );
}

/** Every card of a project, when its data is removed. */
export async function clearFeatureCards(project: string): Promise<void> {
  const key = featureCardsKey(project);
  if (backend === null && !isTauri()) {
    entries.delete(key);
    return;
  }
  await currentBackend().clear(key);
  entries.delete(key);
  notify();
}

/** What a card asks an agent to build: its title, its note, and its source. */
export function featureBrief(
  card: Pick<FeatureCard, "title" | "note" | "sourceUrl">,
): string {
  return [
    card.title,
    card.note,
    card.sourceUrl ? `Details: ${card.sourceUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

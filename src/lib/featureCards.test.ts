import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => false,
}));

import {
  addChatsToBoard,
  addFeatureCards,
  addFeatureIdea,
  clearFeatureCards,
  deleteFeatureCard,
  editFeatureCard,
  featureBoardState,
  featureBrief,
  featureCardForChat,
  loadFeatureCards,
  linkFeatureChat,
  memoryFeatureCardBackend,
  moveFeatureCard,
  setFeatureCardBackend,
  settleFeatureCards,
  subscribeFeatureCards,
  FEATURE_TITLE_MAX,
  type FeatureCardBackend,
} from "./featureCards";

const PROJECT = "/work/site";
const NOW = new Date(2026, 9, 17, 15, 0).getTime();

let storage: FeatureCardBackend;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, "error").mockImplementation(() => {});
  storage = memoryFeatureCardBackend();
  setFeatureCardBackend(storage);
});

afterEach(() => {
  setFeatureCardBackend(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const cards = (project = PROJECT) => featureBoardState(project).cards;

describe("featureCards", () => {
  it("adds ideas, keeps them in storage and reads them back per project", async () => {
    const idea = await addFeatureIdea(PROJECT, {
      title: "  Dark   mode ",
      note: "Follow the system.\r\n",
    });
    expect(idea).toMatchObject({
      title: "Dark mode",
      note: "Follow the system.",
      column: "idea",
      chatIds: [],
      createdAt: NOW,
      movedAt: NOW,
    });
    await addFeatureIdea("/work/other", { title: "Elsewhere" });
    // A blank title adds nothing.
    expect(await addFeatureIdea(PROJECT, { title: "   " })).toBeNull();
    expect(cards().map((card) => card.title)).toEqual(["Dark mode"]);
    expect(
      (await storage.list("/work/site")).map((card) => card.title),
    ).toEqual(["Dark mode"]);
    // Read again from storage, as a new window would.
    setFeatureCardBackend(storage);
    expect(featureBoardState(PROJECT).loaded).toBe(false);
    await loadFeatureCards(PROJECT);
    expect(cards().map((card) => card.title)).toEqual(["Dark mode"]);
    expect(cards("/work/other").map((card) => card.title)).toEqual([]);
    await loadFeatureCards("/work/other/");
    expect(cards("/work/other").map((card) => card.title)).toEqual([
      "Elsewhere",
    ]);
  });

  it("caps a long title and keeps a source link", async () => {
    const [card] = await addFeatureCards(PROJECT, [
      {
        title: "x".repeat(FEATURE_TITLE_MAX + 20),
        sourceUrl: " https://github.com/o/r/issues/3 ",
      },
    ]);
    expect(card.title).toHaveLength(FEATURE_TITLE_MAX);
    expect(card.title.endsWith("…")).toBe(true);
    expect(card.sourceUrl).toBe("https://github.com/o/r/issues/3");
  });

  it("edits a card's title and note, keeping the title when blank", async () => {
    const idea = (await addFeatureIdea(PROJECT, { title: "Export" }))!;
    vi.setSystemTime(NOW + 1_000);
    await editFeatureCard(PROJECT, idea.id, {
      title: "Export to CSV",
      note: "Columns as shown",
    });
    expect(cards()[0]).toMatchObject({
      title: "Export to CSV",
      note: "Columns as shown",
      updatedAt: NOW + 1_000,
    });
    await editFeatureCard(PROJECT, idea.id, { title: "  ", note: "" });
    expect(cards()[0].title).toBe("Export to CSV");
    expect(cards()[0].note).toBeUndefined();
    expect((await storage.list("/work/site"))[0].note).toBeUndefined();
  });

  it("moves a card by hand with its chats' state, and to Shipped with a date", async () => {
    const idea = (await addFeatureIdea(PROJECT, { title: "Search" }))!;
    vi.setSystemTime(NOW + 5_000);
    await moveFeatureCard(PROJECT, idea.id, "shipped", "x:review:1:");
    expect(cards()[0]).toMatchObject({
      column: "shipped",
      movedAt: NOW + 5_000,
      shippedAt: NOW + 5_000,
      basis: "x:review:1:",
    });
    await moveFeatureCard(PROJECT, idea.id, "review", "x:review:1:");
    expect(cards()[0].column).toBe("review");
    expect(cards()[0].shippedAt).toBeUndefined();
  });

  it("links chats to a card, each once, moving it when asked", async () => {
    const idea = (await addFeatureIdea(PROJECT, { title: "Search" }))!;
    await linkFeatureChat(PROJECT, idea.id, "draft");
    expect(cards()[0]).toMatchObject({ column: "idea", chatIds: ["draft"] });
    await linkFeatureChat(PROJECT, idea.id, "built", {
      column: "building",
      basis: "built:::",
    });
    await linkFeatureChat(PROJECT, idea.id, "draft");
    expect(cards()[0]).toMatchObject({
      column: "building",
      chatIds: ["built", "draft"],
      basis: "built:::",
    });
    expect(featureCardForChat(PROJECT, "built")?.id).toBe(idea.id);
    expect(featureCardForChat(PROJECT, "other")).toBeUndefined();
  });

  it("saves where cards moved by themselves, unless moved by hand since", async () => {
    const [a, b] = await addFeatureCards(PROJECT, [
      { title: "A", chatIds: ["a"] },
      { title: "B", chatIds: ["b"] },
    ]);
    // B is moved by hand before the board's own move lands.
    await moveFeatureCard(PROJECT, b.id, "review", "b:review:1:");
    await settleFeatureCards(PROJECT, [
      {
        id: a.id,
        from: undefined,
        basis: "a:shipped::9",
        column: "shipped",
        shippedAt: NOW - 100,
      },
      { id: b.id, from: undefined, basis: "b:working::", column: "building" },
    ]);
    const savedA = cards().find((card) => card.id === a.id);
    const savedB = cards().find((card) => card.id === b.id);
    expect(savedA).toMatchObject({
      column: "shipped",
      basis: "a:shipped::9",
      shippedAt: NOW - 100,
    });
    expect(savedB).toMatchObject({ column: "review", basis: "b:review:1:" });
    // Cards added together share a time: find each by its id.
    const stored = await storage.list("/work/site");
    expect(stored.find((card) => card.id === a.id)?.column).toBe("shipped");
    expect(stored.find((card) => card.id === b.id)?.column).toBe("review");
  });

  it("adds a card for each chat not on the board yet", async () => {
    await addFeatureCards(PROJECT, [{ title: "Search", chatIds: ["one"] }]);
    const added = await addChatsToBoard(PROJECT, [
      { title: "Chat one", chatIds: ["one"], column: "building" },
      { title: "Chat two", chatIds: ["two"], column: "review" },
    ]);
    expect(added.map((card) => [card.title, card.column])).toEqual([
      ["Chat two", "review"],
    ]);
    expect(cards().map((card) => card.title)).toEqual(["Search", "Chat two"]);
  });

  it("deletes a card and clears a project's cards", async () => {
    const [a] = await addFeatureCards(PROJECT, [
      { title: "A" },
      { title: "B" },
    ]);
    await deleteFeatureCard(PROJECT, a.id);
    expect(cards().map((card) => card.title)).toEqual(["B"]);
    expect(await storage.list("/work/site")).toHaveLength(1);
    await clearFeatureCards(PROJECT);
    expect(await storage.list("/work/site")).toEqual([]);
    expect(featureBoardState(PROJECT).loaded).toBe(false);
  });

  it("says when a save fails and shows what storage holds", async () => {
    await addFeatureIdea(PROJECT, { title: "Kept" });
    const failing: FeatureCardBackend = {
      ...storage,
      put: () => Promise.reject("The board is full."),
    };
    setFeatureCardBackend(failing);
    await loadFeatureCards(PROJECT);
    expect(await addFeatureIdea(PROJECT, { title: "Lost" })).toBeNull();
    expect(featureBoardState(PROJECT).error).toBe(
      "Couldn't save the board: The board is full.",
    );
    expect(cards().map((card) => card.title)).toEqual(["Kept"]);
  });

  it("says when the board can't be read", async () => {
    setFeatureCardBackend({
      ...storage,
      list: () => Promise.reject(new Error("disk")),
    });
    await loadFeatureCards(PROJECT);
    expect(featureBoardState(PROJECT)).toMatchObject({
      loaded: true,
      error: "Couldn't read the board: disk",
    });
  });

  it("reads again on refresh, showing a card added in another window", async () => {
    await addFeatureIdea(PROJECT, { title: "Here" });
    const before = featureBoardState(PROJECT);
    // Nothing new: the same state, so nothing redraws.
    await loadFeatureCards(PROJECT, { refresh: true });
    expect(featureBoardState(PROJECT)).toBe(before);
    await storage.put("/work/site", PROJECT, {
      ...cards()[0],
      id: "elsewhere",
      title: "From another window",
      createdAt: NOW + 1,
    });
    await loadFeatureCards(PROJECT, { refresh: true });
    expect(cards().map((card) => card.title)).toEqual([
      "Here",
      "From another window",
    ]);
  });

  it("never undoes a change made here with a read that missed it", async () => {
    let land = () => {};
    setFeatureCardBackend({
      ...storage,
      put: (key, path, card) =>
        new Promise((done) => {
          land = () => void storage.put(key, path, card).then(done);
        }),
    });
    await loadFeatureCards(PROJECT);
    const adding = addFeatureIdea(PROJECT, { title: "Here" });
    await vi.waitFor(() => expect(cards()).toHaveLength(1));
    // Storage has nothing yet; the read must not wipe the new card.
    await loadFeatureCards(PROJECT, { refresh: true });
    expect(cards().map((card) => card.title)).toEqual(["Here"]);
    land();
    await adding;
    await loadFeatureCards(PROJECT, { refresh: true });
    expect(cards().map((card) => card.title)).toEqual(["Here"]);
  });

  it("tells subscribers about changes", async () => {
    const heard = vi.fn();
    const stop = subscribeFeatureCards(heard);
    await addFeatureIdea(PROJECT, { title: "A" });
    expect(heard).toHaveBeenCalled();
    stop();
  });

  it("writes a card's brief as its title, then its note", () => {
    expect(featureBrief({ title: "Dark mode" })).toBe("Dark mode");
    expect(
      featureBrief({ title: "Dark mode", note: "Follow the system." }),
    ).toBe("Dark mode\n\nFollow the system.");
  });
});

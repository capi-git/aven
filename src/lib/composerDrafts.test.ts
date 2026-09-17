import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createComposerDraftStore,
  sanitizeComposerDraft,
} from "./composerDrafts";
import type { Attachment } from "./session";

describe("composer draft persistence", () => {
  let values: Map<string, string>;
  let storage: {
    getItem: ReturnType<typeof vi.fn>;
    setItem: ReturnType<typeof vi.fn>;
  };
  const stores: ReturnType<typeof createComposerDraftStore>[] = [];
  const create = (target?: EventTarget) => {
    const store = createComposerDraftStore(() => storage, target);
    stores.push(store);
    return store;
  };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T00:00:00Z"));
    values = new Map();
    storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
    };
  });
  afterEach(() => {
    for (const store of stores.splice(0)) store.dispose();
    vi.useRealTimers();
  });

  it("releases only durable unowned draft memory and preserves quota-failed bytes", () => {
    const store = create();
    const release = store.retain("closed");
    store.update("closed", {text: "saved draft"});
    const before = store.read("closed");
    release();
    const restored = store.read("closed");
    expect(restored).toEqual(before);
    expect(restored).not.toBe(before); // loaded from durable storage
    const a = store.retain("peer"), b = store.retain("peer");
    store.update("peer", {text:"keep live"}); const peer = store.read("peer");
    a(); expect(store.read("peer")).toBe(peer); b();
    const failed = store.retain("quota");
    storage.setItem.mockImplementation(() => {throw new Error("quota");});
    store.update("quota", {text:"cannot lose"}); const cached = store.read("quota");
    failed(); expect(store.read("quota")).toBe(cached);
  });

  it("restores separate unsent drafts after restart without a tab or session change", () => {
    const store = create();
    store.update("personal-blank", { text: "Personal draft" });
    store.update("work-blank", {
      text: "Standalone Work draft — local QA, do not send.",
    });
    expect(storage.setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(storage.setItem).toHaveBeenCalledTimes(2);

    const restarted = create();
    expect(restarted.read("personal-blank")?.text).toBe("Personal draft");
    expect(restarted.read("work-blank")?.text).toBe(
      "Standalone Work draft — local QA, do not send.",
    );
    expect(restarted.read("another-session")).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("persists peer drafts with their original timestamps and rejects stale peer edits", () => {
    const store = create();
    const listener = vi.fn();
    store.subscribe(listener);
    const incoming = { text: "Floating draft", attachments: [], updatedAt: 10 };
    store.importDraft("pip", incoming);
    store.flush();
    expect(create().read("pip")).toEqual(incoming);
    expect(listener).toHaveBeenCalledOnce();
    store.importDraft("pip", { ...incoming, text: "stale", updatedAt: 9 });
    expect(listener).toHaveBeenCalledOnce();
    const cleared = { text: "", attachments: [], updatedAt: 11 };
    store.importDraft("pip", cleared);
    store.flush();
    expect(create().read("pip")).toEqual(cleared);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["beforeunload", "pagehide"])(
    "flushes the latest keystroke synchronously on %s",
    (event) => {
      const lifecycle = new EventTarget();
      const store = create(lifecycle);
      store.update("work", { text: "first" });
      store.update("work", { text: "last keystroke" });
      lifecycle.dispatchEvent(new Event(event));
      expect(create().read("work")?.text).toBe("last keystroke");
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("retains an explicit empty draft after send and ignores an older workspace snapshot", () => {
    const store = create();
    store.update("sent", { text: "send this" });
    const oldSnapshot = store.read("sent")!;
    store.update("sent", { text: "", attachments: [] });
    store.flush();
    const restarted = create();
    restarted.restore("sent", oldSnapshot);
    expect(restarted.read("sent")).toMatchObject({ text: "", attachments: [] });
    expect(restarted.read("sent")!.updatedAt).toBeGreaterThan(
      oldSnapshot.updatedAt,
    );
  });

  it("round-trips selected files and pasted image bytes without stale object URLs", () => {
    const attachments: Attachment[] = [
      {
        id: "file",
        name: "notes.txt",
        mimeType: "text/plain",
        kind: "file",
        size: 12,
        path: "/tmp/notes.txt",
      },
      {
        id: "paste",
        name: "image.png",
        mimeType: "image/png",
        kind: "image",
        size: 4,
        data: "cGl4ZWw=",
        previewUrl: "blob:old-webview",
      },
    ];
    const store = create();
    store.update("with-files", { text: "inspect these", attachments });
    store.update("with-files", { text: "inspect both" });
    store.flush();
    const draft = create().read("with-files");
    expect(draft?.attachments).toEqual([
      attachments[0],
      {
        id: "paste",
        name: "image.png",
        mimeType: "image/png",
        kind: "image",
        size: 4,
        data: "cGl4ZWw=",
      },
    ]);
    expect(draft?.text).toBe("inspect both");
  });

  it("keeps complete data for the native snapshot if localStorage cannot fit it, without idle retries", () => {
    storage.setItem.mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const store = create();
    store.update("large", {
      text: "do not lose me",
      attachments: [
        {
          id: "image",
          name: "image.png",
          mimeType: "image/png",
          kind: "image",
          size: 4,
          data: "cGl4ZWw=",
        },
      ],
    });
    vi.advanceTimersByTime(250);
    expect(store.read("large")?.text).toBe("do not lose me");
    expect(store.read("large")?.attachments[0].data).toBe("cGl4ZWw=");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("notifies only actual changes and removes lifecycle handlers on disposal", () => {
    const target = new EventTarget();
    const store = create(target);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.update("s", { text: "one" });
    store.update("s", { text: "one" });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.update("s", { text: "two" });
    expect(listener).toHaveBeenCalledTimes(1);
    store.dispose();
    storage.setItem.mockClear();
    target.dispatchEvent(new Event("pagehide"));
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores malformed records and keeps supported attachment fields only", () => {
    expect(sanitizeComposerDraft({ text: 42 })).toBeUndefined();
    expect(
      sanitizeComposerDraft({
        text: "valid",
        attachments: [
          null,
          {},
          {
            id: "x",
            name: "unusable",
            mimeType: "text/plain",
            kind: "file",
            size: 1,
          },
        ],
        updatedAt: Infinity,
      }),
    ).toEqual({ text: "valid", attachments: [], updatedAt: 0 });
    values.set("monocode.composerDraft.v1:corrupt", "{");
    expect(create().read("corrupt")).toBeUndefined();
  });
});

// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Attachment } from "./session";
import {
  leaf,
  newEditorPane,
  newFileTab,
  splitPane,
  type WorkspaceTab,
} from "./layout";
import { addFileToChat, fileChatTarget } from "./fileTabChat";
import { ADD_TO_CHAT_EVENT, type AddToChatRequest } from "./quoteDraft";
import type { Session } from "./session";

const mocks = vi.hoisted(() => ({
  attach: vi.fn(async (_paths: string[]): Promise<Attachment[]> => []),
}));
vi.mock("./attachments", () => ({ attachmentsFromPaths: mocks.attach }));

const chat = (id: string, extra: Partial<Session> = {}) =>
  ({ id, harness: "codex", ...extra }) as Session;

/** A workspace tab with chats and one file pane, split left to right. */
function tabWith(
  id: string,
  chats: string[],
  file?: { paneId: string; after?: string },
  focusedId?: string,
): WorkspaceTab {
  let layout = leaf(chats[0] ?? file!.paneId);
  for (const next of chats.slice(1))
    layout = splitPane(layout, chats[0]!, "right", next);
  const editorPanes = [];
  if (file) {
    const pane = {
      ...newEditorPane(newFileTab("/repo/a.md", "/repo")),
      id: file.paneId,
    };
    editorPanes.push(pane);
    if (chats.length)
      layout = splitPane(
        layout,
        file.after ?? chats[chats.length - 1]!,
        "right",
        pane.id,
      );
  }
  return {
    kind: "session",
    id,
    layout,
    focusedId: focusedId ?? file?.paneId ?? chats[0]!,
    editorPanes,
    terminalPanes: [],
  };
}

describe("fileChatTarget", () => {
  it("picks the chat beside the file in its own tab", () => {
    const own = tabWith("own", ["left"], { paneId: "files" });
    const active = tabWith("active", ["elsewhere"]);
    const target = fileChatTarget(
      [active, own],
      "files",
      [chat("left"), chat("elsewhere")],
      "active",
    );
    expect(target).toMatchObject({ tabId: "own", session: { id: "left" } });
  });

  it("prefers the tab's focused chat, then the file's neighbour", () => {
    const sessions = [chat("one"), chat("two"), chat("three")];
    const focused = tabWith(
      "tab",
      ["one", "two", "three"],
      { paneId: "files", after: "three" },
      "two",
    );
    expect(fileChatTarget([focused], "files", sessions)?.session.id).toBe(
      "two",
    );
    const neighbour = { ...focused, focusedId: "files" };
    expect(fileChatTarget([neighbour], "files", sessions)?.session.id).toBe(
      "three",
    );
  });

  it("uses the active tab's chat when the file's tab has none", () => {
    const filesOnly = tabWith("files-only", [], { paneId: "files" });
    const other = tabWith("other", ["first"]);
    const active = tabWith("active", ["current"]);
    const target = fileChatTarget(
      [filesOnly, other, active],
      "files",
      [chat("first"), chat("current")],
      "active",
    );
    expect(target).toMatchObject({
      tabId: "active",
      session: { id: "current" },
    });
    expect(
      fileChatTarget([filesOnly, other], "files", [chat("first")], "gone"),
    ).toMatchObject({ tabId: "other", session: { id: "first" } });
  });

  it("never picks an inbox question's hidden chat", () => {
    const own = tabWith("own", ["ask"], { paneId: "files" });
    expect(
      fileChatTarget([own], "files", [chat("ask", { inboxAsk: {} as never })]),
    ).toBeUndefined();
  });
});

describe("addFileToChat", () => {
  let requests: AddToChatRequest[];
  const listen = (event: Event) =>
    requests.push((event as CustomEvent<AddToChatRequest>).detail);

  beforeEach(() => {
    requests = [];
    mocks.attach.mockReset();
    window.addEventListener(ADD_TO_CHAT_EVENT, listen);
  });
  afterEach(() => window.removeEventListener(ADD_TO_CHAT_EVENT, listen));

  it("mentions a text file in the chosen chat", async () => {
    await addFileToChat("/Users/me/Documents/Stanislaus impressions.md", {
      id: "chat",
      harness: "codex",
    });
    expect(requests).toEqual([
      {
        text: "",
        mode: "mention",
        path: "/Users/me/Documents/Stanislaus impressions.md",
        sessionId: "chat",
      },
    ]);
    expect(mocks.attach).not.toHaveBeenCalled();
  });

  it("attaches an image like a pasted one", async () => {
    const image: Attachment = {
      id: "image",
      name: "shot.png",
      mimeType: "image/png",
      kind: "image",
      size: 10,
      path: "/Users/me/shot.png",
    };
    mocks.attach.mockResolvedValue([image]);
    await addFileToChat("/Users/me/shot.png", { id: "chat", harness: "codex" });
    expect(mocks.attach).toHaveBeenCalledExactlyOnceWith([
      "/Users/me/shot.png",
    ]);
    expect(requests).toEqual([
      { text: "", mode: "plain", attachments: [image], sessionId: "chat" },
    ]);
  });

  it("mentions an image where the agent takes no attachments", async () => {
    await addFileToChat("/Users/me/shot.png", { id: "chat", harness: "fx" });
    expect(mocks.attach).not.toHaveBeenCalled();
    expect(requests).toEqual([
      expect.objectContaining({ mode: "mention", path: "/Users/me/shot.png" }),
    ]);
  });

  it("mentions an image it could not read as an attachment", async () => {
    mocks.attach.mockRejectedValue(new Error("gone"));
    await addFileToChat("/Users/me/shot.png", { id: "chat", harness: "codex" });
    expect(requests).toEqual([
      expect.objectContaining({ mode: "mention", sessionId: "chat" }),
    ]);
  });
});

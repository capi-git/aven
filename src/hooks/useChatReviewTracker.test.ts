// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatReview } from "../lib/chatReview";
import { notifyReviewChanged, type CheckpointStatus } from "../lib/checkpoint";
import { notifyGitChanged } from "../lib/fs";
import { newSession, type Session } from "../lib/session";
import { startChatReviewTracker } from "./useChatReviewTracker";

const files = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    path: `/repo/f${index}.ts`,
    relative: `f${index}.ts`,
    status: "modified",
    additions: 1,
    deletions: 0,
    exact: true,
    undoable: true,
  }));

let sessions: Session[];
let reviews: Record<string, ChatReview>;
let status: ReturnType<
  typeof vi.fn<(id: string, cwd: string) => Promise<CheckpointStatus>>
>;
let note: ReturnType<typeof vi.fn<(input: unknown) => void>>;
let stop: () => void;

const chat = (id: string, patch: Partial<Session> = {}): Session => ({
  ...newSession("claude", "/repo"),
  id,
  title: `claude · ${id}`,
  ...patch,
});

const settle = () => vi.advanceTimersByTimeAsync(300);

beforeEach(() => {
  vi.useFakeTimers();
  sessions = [];
  reviews = {};
  status = vi.fn(async () => ({ files: files(2) }));
  note = vi.fn<(input: unknown) => void>();
  stop = startChatReviewTracker({
    session: (id) => sessions.find((entry) => entry.id === id),
    sessions: () => sessions,
    reviews: () => reviews,
    status,
    note,
  });
});

afterEach(() => {
  stop();
  vi.useRealTimers();
});

describe("startChatReviewTracker", () => {
  it("keeps reading while the window is on screen without focus", async () => {
    // Watched from a second screen: the board still follows the turn's end.
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    window.dispatchEvent(new Event("blur"));
    sessions = [chat("a")];
    notifyReviewChanged("a");
    await settle();
    expect(status).toHaveBeenCalledExactlyOnceWith("a", "/repo");
    vi.restoreAllMocks();
  });

  it("reads a chat's checkpoint once when its turn ends", async () => {
    sessions = [chat("a", { worktreeCwd: "/copies/a" })];
    notifyReviewChanged("a");
    notifyReviewChanged("a");
    await settle();
    expect(status).toHaveBeenCalledOnce();
    expect(status).toHaveBeenCalledWith("a", "/copies/a");
    expect(note).toHaveBeenCalledWith({
      sessionId: "a",
      project: "/repo",
      cwd: "/copies/a",
      files: files(2),
      title: "a",
      harness: "claude",
    });
  });

  it("waits while a chat works, and ignores chats it knows nothing of", async () => {
    sessions = [chat("busy", { busy: true })];
    notifyReviewChanged("busy");
    notifyReviewChanged("unknown");
    await settle();
    expect(status).not.toHaveBeenCalled();
  });

  it("reads saved reviews again when Git changes in their folder", async () => {
    reviews = {
      kept: {
        sessionId: "kept",
        project: "/repo",
        cwd: "/repo",
        at: 1,
        files: 1,
        additions: 1,
        deletions: 0,
        names: [],
      },
      other: {
        sessionId: "other",
        project: "/elsewhere",
        cwd: "/elsewhere",
        at: 1,
        files: 1,
        additions: 1,
        deletions: 0,
        names: [],
      },
    };
    status.mockResolvedValueOnce({ files: [] });
    notifyGitChanged("/repo");
    await settle();
    expect(status.mock.calls).toEqual([["kept", "/repo"]]);
    expect(note).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "kept", files: [] }),
    );
  });

  it("keeps what it knew when the checkpoint cannot be read", async () => {
    sessions = [chat("a")];
    status.mockRejectedValueOnce(new Error("gone"));
    notifyReviewChanged("a");
    await settle();
    expect(note).not.toHaveBeenCalled();
  });

  it("checks saved reviews and reopened chats once after launch, without polling", async () => {
    sessions = [chat("open")];
    reviews = {
      saved: {
        sessionId: "saved",
        project: "/repo",
        cwd: "/repo",
        at: 1,
        files: 1,
        additions: 1,
        deletions: 0,
        names: [],
      },
    };
    await vi.advanceTimersByTimeAsync(2_500);
    expect(status.mock.calls.map(([id]) => id).sort()).toEqual([
      "open",
      "saved",
    ]);
    status.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(status).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

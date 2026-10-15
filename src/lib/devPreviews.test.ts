import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentPreviewSource,
  chipPreview,
  devPreviewPromptLine,
  devPreviewsSnapshot,
  dismissDevPreview,
  installDevPreviewOpener,
  observeAgentPreviewEvent,
  openDevPreview,
  pendingAutoOpen,
  previewBelongsTo,
  previewTabMatch,
  reportDevServer,
  resetDevPreviews,
  stopDevServers,
  subscribeDevPreviews,
  watchTerminalOutput,
  type DevPreview,
} from "./devPreviews";
import { localDevAddress } from "./devServerUrls";
import type { HarnessEvent } from "./harness/types";

const PROJECT = "/Users/me/site";
const VITE = "  ➜  Local:   http://localhost:5173/\n";

let values: Map<string, string>;

beforeEach(() => {
  values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  resetDevPreviews();
});

afterEach(() => {
  resetDevPreviews();
  vi.unstubAllGlobals();
});

function report(
  url: string,
  options: Partial<{
    project: string;
    sourceId: string;
    strength: "strong" | "weak";
    now: number;
  }> = {},
) {
  return reportDevServer(
    {
      project: options.project ?? PROJECT,
      cwd: options.project ?? PROJECT,
      address: localDevAddress(url, options.strength ?? "strong")!,
      source: "terminal",
      sourceId: options.sourceId ?? "terminal:t1",
      placement: "chat",
    },
    options.now,
  );
}

function only(): DevPreview {
  const all = devPreviewsSnapshot();
  expect(all).toHaveLength(1);
  return all[0];
}

describe("reportDevServer", () => {
  it("keeps one entry per project and port while the server runs", () => {
    const listener = vi.fn();
    subscribeDevPreviews(listener);
    report("http://localhost:5173/");
    report("http://127.0.0.1:5173/");
    report("http://localhost:5173/", { project: "/Users/me/other" });
    expect(devPreviewsSnapshot()).toHaveLength(2);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(devPreviewsSnapshot()[0]).toMatchObject({
      url: "http://localhost:5173/",
      label: "localhost:5173",
      status: "live",
      start: 1,
    });
  });

  it("treats an announcement after a stop as a new start", () => {
    report("http://localhost:5173/");
    dismissDevPreview(only().key);
    stopDevServers("terminal:t1");
    expect(only()).toMatchObject({ status: "stale", dismissed: true });
    report("http://localhost:5173/");
    expect(only()).toMatchObject({
      status: "live",
      start: 2,
      dismissed: false,
      opened: false,
    });
  });

  it("upgrades a port notice to the framework's page address", () => {
    report("http://localhost:3000/", { strength: "weak" });
    report("http://localhost:3000/app/");
    expect(only()).toMatchObject({
      url: "http://localhost:3000/app/",
      strength: "strong",
    });
    report("http://localhost:3000/", { strength: "weak" });
    expect(only().url).toBe("http://localhost:3000/app/");
  });

  it("opens automatically only for page addresses with the setting on", () => {
    report("http://localhost:5173/");
    expect(only().autoOpen).toBe(false);
    resetDevPreviews();
    values.set("aven.devPreviewAutoOpen", "1");
    report("http://localhost:5173/");
    report("http://localhost:4000/", { strength: "weak" });
    expect(devPreviewsSnapshot().map((preview) => preview.autoOpen)).toEqual([
      true,
      false,
    ]);
    expect(pendingAutoOpen(devPreviewsSnapshot(), PROJECT)).toHaveLength(1);
    expect(pendingAutoOpen(devPreviewsSnapshot(), "/Users/me/other")).toEqual(
      [],
    );
  });

  it("forgets stopped servers first when the list is full", () => {
    report("http://localhost:3000/", { sourceId: "terminal:old" });
    stopDevServers("terminal:old");
    for (let port = 4000; port < 4024; port++)
      report(`http://localhost:${port}/`);
    const ports = devPreviewsSnapshot().map((preview) => preview.port);
    expect(ports).toHaveLength(24);
    expect(ports).not.toContain(3000);
  });
});

describe("stopDevServers", () => {
  it("stops only its own source, and only the named ports", () => {
    report("http://localhost:5173/", { sourceId: "terminal:a" });
    report("http://localhost:3000/", { sourceId: "terminal:a" });
    report("http://localhost:8000/", { sourceId: "terminal:b" });
    stopDevServers("terminal:a", [3000]);
    expect(
      devPreviewsSnapshot().map((preview) => [preview.port, preview.status]),
    ).toEqual([
      [5173, "live"],
      [3000, "stale"],
      [8000, "live"],
    ]);
  });
});

describe("previewBelongsTo", () => {
  it("matches the project and folders inside it", () => {
    expect(previewBelongsTo({ project: PROJECT, cwd: PROJECT }, PROJECT)).toBe(
      true,
    );
    expect(
      previewBelongsTo(
        { project: `${PROJECT}/apps/web`, cwd: `${PROJECT}/apps/web` },
        PROJECT,
      ),
    ).toBe(true);
    expect(
      previewBelongsTo({ project: "/Users/me/other", cwd: "/x" }, PROJECT),
    ).toBe(false);
    // Home is not a project, so it never claims every server under it.
    expect(
      previewBelongsTo({ project: PROJECT, cwd: PROJECT }, "/Users/me"),
    ).toBe(false);
    expect(previewBelongsTo({ project: PROJECT, cwd: PROJECT }, "")).toBe(
      false,
    );
  });
});

describe("chipPreview", () => {
  it("offers running pages first, then the newest", () => {
    report("http://localhost:4000/", { strength: "weak", now: 3 });
    report("http://localhost:5173/", { now: 1 });
    report("http://localhost:5174/", { now: 2 });
    expect(chipPreview(devPreviewsSnapshot(), PROJECT, "chat")?.port).toBe(
      5174,
    );
    expect(chipPreview(devPreviewsSnapshot(), PROJECT, "terminal")).toBe(
      undefined,
    );
  });

  it("hides dismissed and opened previews", () => {
    const preview = report("http://localhost:5173/");
    installDevPreviewOpener(() => true);
    expect(openDevPreview(preview.key)).toBe(true);
    expect(chipPreview(devPreviewsSnapshot(), PROJECT, "chat")).toBe(undefined);
    report("http://localhost:3000/");
    dismissDevPreview(devPreviewsSnapshot()[1].key);
    expect(chipPreview(devPreviewsSnapshot(), PROJECT, "chat")).toBe(undefined);
  });

  it("shows a stopped server only while it is the latest one", () => {
    report("http://localhost:5173/", { now: 1, sourceId: "terminal:a" });
    stopDevServers("terminal:a");
    expect(chipPreview(devPreviewsSnapshot(), PROJECT, "chat")).toMatchObject({
      port: 5173,
      status: "stale",
    });
    const later = report("http://localhost:3000/", { now: 2 });
    dismissDevPreview(later.key);
    expect(chipPreview(devPreviewsSnapshot(), PROJECT, "chat")).toBe(undefined);
  });
});

describe("openDevPreview", () => {
  it("asks the workspace and records only a successful open", () => {
    const preview = report("http://localhost:5173/");
    expect(openDevPreview(preview.key)).toBe(false);
    const open = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    const uninstall = installDevPreviewOpener(open);
    expect(openDevPreview(preview.key, "session-1")).toBe(false);
    expect(only().opened).toBe(false);
    expect(openDevPreview(preview.key, "session-1")).toBe(true);
    expect(open).toHaveBeenLastCalledWith(
      expect.objectContaining({ url: "http://localhost:5173/" }),
      "session-1",
    );
    expect(only().opened).toBe(true);
    uninstall();
    expect(openDevPreview(preview.key)).toBe(false);
  });

  it("reports an opener failure without throwing", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const preview = report("http://localhost:5173/");
    installDevPreviewOpener(() => {
      throw new Error("layout unavailable");
    });
    expect(openDevPreview(preview.key)).toBe(false);
    expect(error).toHaveBeenCalledWith(
      "[aven] Could not open the dev preview: layout unavailable",
    );
  });
});

describe("previewTabMatch", () => {
  const tabs = [
    { id: "docs", url: "https://vitejs.dev/" },
    { id: "blank", url: "" },
    { id: "about", url: "http://127.0.0.1:5173/about" },
    { id: "other", url: "http://localhost:3000/" },
  ];

  it("reuses a tab on the same server, whichever page it shows", () => {
    expect(previewTabMatch(tabs, "http://localhost:5173/")?.id).toBe("about");
    expect(previewTabMatch(tabs, "http://localhost:3000/")?.id).toBe("other");
    expect(previewTabMatch(tabs, "http://localhost:8080/")).toBeUndefined();
    expect(previewTabMatch(tabs, "https://localhost:5173/")).toBeUndefined();
  });

  it("prefers the active tab when several match", () => {
    const both = [...tabs, { id: "home", url: "http://localhost:5173/" }];
    expect(previewTabMatch(both, "http://localhost:5173/", "home")?.id).toBe(
      "home",
    );
  });
});

describe("watchTerminalOutput", () => {
  it("reports a terminal's server and marks it stale when it stops", () => {
    const watch = watchTerminalOutput({
      id: "t1",
      project: PROJECT,
      cwd: `${PROJECT}/web`,
      placement: "terminal",
    });
    watch.push("\r\n  VITE v5.4.0  ready in 220 ms\r\n\r\n");
    watch.push(VITE);
    expect(only()).toMatchObject({
      project: PROJECT,
      cwd: `${PROJECT}/web`,
      source: "terminal",
      sourceId: "terminal:t1",
      placement: "terminal",
      status: "live",
    });
    watch.push(VITE);
    expect(only().start).toBe(1);
    watch.push("^C\r\n");
    expect(only().status).toBe("stale");
    watch.push(VITE);
    expect(only()).toMatchObject({ status: "live", start: 2 });
    watch.stopped();
    expect(only().status).toBe("stale");
  });
});

describe("observeAgentPreviewEvent", () => {
  const place = () => ({ project: PROJECT, cwd: `${PROJECT}-worktree` });
  const observe = (event: HarnessEvent, sessionId = "s1") =>
    observeAgentPreviewEvent(sessionId, event, place);

  it("finds a server in streamed shell output", () => {
    observe({
      type: "tool.started",
      callId: "c1",
      title: "npm run dev",
      kind: "execute",
    });
    observe({
      type: "tool.updated",
      callId: "c1",
      kind: "execute",
      status: "in_progress",
      detail: "> vite\n\n  VITE v5 ready\n  ➜  Local:   http://localh",
    });
    expect(devPreviewsSnapshot()).toEqual([]);
    observe({
      type: "tool.updated",
      callId: "c1",
      kind: "execute",
      status: "in_progress",
      detail: "ost:5173/\n",
    });
    expect(only()).toMatchObject({
      project: PROJECT,
      cwd: `${PROJECT}-worktree`,
      source: "agent",
      sourceId: agentPreviewSource("s1"),
      sessionId: "s1",
      placement: "chat",
      url: "http://localhost:5173/",
    });
  });

  it("scans only what cumulative updates add", () => {
    const place = vi.fn(() => ({ project: PROJECT, cwd: PROJECT }));
    const start = "> next dev\n\n   ▲ Next.js 15.0.0\n";
    const local = `${start}   - Local:        http://localhost:3000\n`;
    for (const detail of [start, local, `${local}\n ✓ Ready in 1.2s\n`])
      observeAgentPreviewEvent(
        "s1",
        {
          type: "tool.updated",
          callId: "c1",
          kind: "shell",
          status: "in_progress",
          detail,
        },
        place,
      );
    expect(place).toHaveBeenCalledTimes(1);
    expect(only().port).toBe(3000);
  });

  it("finds a server in a finished read of background output", () => {
    observe({
      type: "tool.updated",
      callId: "read-1",
      kind: "execute",
      status: "completed",
      detail:
        "<status>running</status>\n\n<stdout>\n  ➜  Local:   http://localhost:5173/\n</stdout>",
    });
    expect(only().status).toBe("live");
  });

  it("does not offer a server whose output shows it already ended", () => {
    observe({
      type: "tool.updated",
      callId: "read-1",
      kind: "execute",
      status: "completed",
      detail:
        "<status>killed</status>\n\n<stdout>\n  ➜  Local:   http://localhost:5173/\n</stdout>",
    });
    expect(devPreviewsSnapshot()).toEqual([]);
  });

  it("ignores tools that are not shell commands, and assistant text", () => {
    observe({
      type: "tool.updated",
      callId: "r1",
      kind: "read",
      status: "completed",
      detail: VITE,
    });
    observe({ type: "message.delta", text: VITE });
    observe({
      type: "tool.updated",
      callId: "r2",
      status: "completed",
      detail: VITE,
    });
    expect(devPreviewsSnapshot()).toEqual([]);
  });

  it("marks the agent's servers stale when it kills them or exits", () => {
    observe({
      type: "tool.updated",
      callId: "c1",
      kind: "execute",
      status: "in_progress",
      detail: VITE + "Listening on http://localhost:4000\n",
    });
    expect(devPreviewsSnapshot()).toHaveLength(2);
    observe({
      type: "tool.started",
      callId: "k1",
      kind: "execute",
      title: "lsof -ti:4000 | xargs kill",
    });
    observe({
      type: "tool.updated",
      callId: "k1",
      status: "completed",
    });
    expect(
      devPreviewsSnapshot().map((preview) => [preview.port, preview.status]),
    ).toEqual([
      [5173, "live"],
      [4000, "stale"],
    ]);
    observe({ type: "session.ended", code: 0 });
    expect(devPreviewsSnapshot().every((p) => p.status === "stale")).toBe(true);
  });

  it("does not treat a search for the word kill as killing a server", () => {
    observe({
      type: "tool.updated",
      callId: "c1",
      kind: "execute",
      status: "in_progress",
      detail: VITE,
    });
    observe({
      type: "tool.updated",
      callId: "g1",
      kind: "execute",
      title: "grep -rn kill src",
      status: "completed",
      detail: "src/a.ts:3: process.kill(pid)",
    });
    expect(only().status).toBe("live");
  });

  it("marks a streamed server stale when its own output says it stopped", () => {
    observe({
      type: "tool.updated",
      callId: "c1",
      kind: "execute",
      status: "in_progress",
      detail: VITE,
    });
    observe({
      type: "tool.updated",
      callId: "c1",
      kind: "execute",
      status: "in_progress",
      detail: " ELIFECYCLE  Command failed with exit code 1.\n",
    });
    expect(only().status).toBe("stale");
  });

  it("leaves another session's server alone", () => {
    observe({
      type: "tool.updated",
      callId: "c1",
      kind: "execute",
      status: "in_progress",
      detail: VITE,
    });
    observe({ type: "session.ended" }, "s2");
    expect(only().status).toBe("live");
  });
});

describe("devPreviewPromptLine", () => {
  it("names the running servers for the agent's project", () => {
    expect(devPreviewPromptLine({ cwd: PROJECT })).toBeUndefined();
    report("http://localhost:5173/");
    expect(devPreviewPromptLine({ cwd: PROJECT, sessionId: "s1" })).toBe(
      "<aven-preview>This project's dev server is running at http://localhost:5173/ (started in an Aven terminal). To check visible changes, list the browser pages and reuse one already showing it, or open it once; reload after edits instead of starting another server. If it does not load, it may have stopped since.</aven-preview>",
    );
    expect(devPreviewPromptLine({ cwd: "/Users/me/other" })).toBeUndefined();
  });

  it("includes the agent's own servers from another checkout", () => {
    observeAgentPreviewEvent(
      "s1",
      {
        type: "tool.updated",
        callId: "c1",
        kind: "execute",
        status: "in_progress",
        detail: "Listening on http://localhost:4000\n",
      },
      () => ({ project: PROJECT, cwd: PROJECT }),
    );
    report("http://localhost:5173/");
    const line = devPreviewPromptLine({
      cwd: "/Users/me/.worktrees/site/fix",
      sessionId: "s1",
    });
    expect(line).toContain(
      "This project's dev server is running at http://localhost:4000/ (started by you).",
    );
    expect(devPreviewPromptLine({ cwd: PROJECT, sessionId: "s2" })).toContain(
      "http://localhost:4000/ (started by another chat)",
    );
    stopDevServers(agentPreviewSource("s1"));
    stopDevServers("terminal:t1");
    expect(devPreviewPromptLine({ cwd: PROJECT, sessionId: "s1" })).toBe(
      undefined,
    );
  });
});

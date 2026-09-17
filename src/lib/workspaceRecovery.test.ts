import { describe, expect, it } from "vitest";
import {
  leaf,
  leafIds,
  newTab,
  type FilePaneTab,
  type WorkspaceTab,
} from "./layout";
import { resolveWorkspaceView } from "./workspaceViews";
import {
  emptyWorkspaceRecovery,
  loadWorkspaceRecovery,
  parseWorkspaceRecovery,
  peekClosedWorkspaceEntry,
  popClosedWorkspaceEntry,
  popWorkspaceLayoutUndo,
  prepareRecoveredWorkspaceTab,
  pushClosedWorkspaceEntry,
  pushWorkspaceLayoutUndo,
  saveWorkspaceRecovery,
  type ClosedWorkspaceEntry,
} from "./workspaceRecovery";

const cwd = "/synthetic/project";
const browserEntry = (id: string, project = cwd): ClosedWorkspaceEntry => ({
  kind: "browser",
  cwd: project,
  closedAt: 123,
  browser: { id, url: `https://example.test/${id}`, title: id },
});
const file: FilePaneTab = { id: "file", path: "/synthetic/project/a.ts", cwd };
function fileEntry(value = file): ClosedWorkspaceEntry {
  return {
    kind: "file",
    cwd,
    closedAt: 1,
    tabId: "tab",
    paneId: "pane",
    file: value,
  };
}

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe("recently closed workspace metadata", () => {
  it("keeps the newest 20 entries and de-duplicates a reopened tab", () => {
    let state = emptyWorkspaceRecovery();
    for (let index = 0; index < 25; index++)
      state = pushClosedWorkspaceEntry(state, browserEntry(String(index)));
    expect(state.closed).toHaveLength(20);
    expect(state.closed[0]).toMatchObject({ browser: { id: "5" } });
    state = pushClosedWorkspaceEntry(state, browserEntry("10"));
    expect(state.closed).toHaveLength(20);
    expect(peekClosedWorkspaceEntry(state, cwd)).toMatchObject({
      browser: { id: "10" },
    });
  });

  it("pops only the latest entry for the current project without mutating history", () => {
    const initial = emptyWorkspaceRecovery();
    const state = [
      browserEntry("first"),
      browserEntry("other", "/elsewhere"),
      browserEntry("last"),
    ].reduce(pushClosedWorkspaceEntry, initial);
    const next = popClosedWorkspaceEntry(state, cwd);
    expect(next.entry).toMatchObject({ browser: { id: "last" } });
    expect(next.state.closed).toHaveLength(2);
    expect(state.closed).toHaveLength(3);
    expect(initial.closed).toHaveLength(0);
    expect(peekClosedWorkspaceEntry(next.state, "/elsewhere")).toMatchObject({
      browser: { id: "other" },
    });
    expect(popClosedWorkspaceEntry(state, "/missing")).toEqual({
      state,
      entry: null,
    });
  });

  it("retains browser address/title but strips web contents and unsafe icon URLs", () => {
    const raw = {
      ...browserEntry("browser"),
      browser: {
        id: "browser",
        url: "https://example.test",
        title: "Page",
        favicon: "javascript:alert(1)",
        html: "private page",
        cookies: "secret",
      },
    };
    const state = pushClosedWorkspaceEntry(emptyWorkspaceRecovery(), raw);
    expect(state.closed[0]).toMatchObject({
      browser: { id: "browser", title: "Page" },
    });
    expect(JSON.stringify(state)).not.toMatch(
      /html|cookies|private page|javascript:/,
    );
  });

  it("keeps file descriptors without unsaved buffers and deduplicates the same file identity", () => {
    let state = pushClosedWorkspaceEntry(
      emptyWorkspaceRecovery(),
      fileEntry({
        ...file,
        buffer: "unsaved",
        foreground: "running command",
      } as FilePaneTab),
    );
    state = pushClosedWorkspaceEntry(
      state,
      fileEntry({ ...file, id: "new-file-id" }),
    );
    expect(state.closed).toHaveLength(1);
    expect(state.closed[0]).toMatchObject({
      file: { id: "new-file-id", path: file.path },
    });
    expect(JSON.stringify(state)).not.toMatch(
      /buffer|unsaved|foreground|running command/,
    );
  });

  it("does not offer an individual terminal process as a reopenable file", () => {
    const state = emptyWorkspaceRecovery();
    expect(
      pushClosedWorkspaceEntry(state, fileEntry({ ...file, terminal: true })),
    ).toBe(state);
  });

  it("uses snapshot validation for plan/commit descriptors", () => {
    const valid = pushClosedWorkspaceEntry(
      emptyWorkspaceRecovery(),
      fileEntry({
        ...file,
        commit: { sha: "abc", shortSha: "abc", subject: "Change" },
      }),
    );
    expect(valid.closed).toHaveLength(1);
    const invalid = pushClosedWorkspaceEntry(
      emptyWorkspaceRecovery(),
      fileEntry({
        ...file,
        terminal: false,
        commit: { sha: "", shortSha: "", subject: "" },
      }),
    );
    expect(invalid.closed).toHaveLength(0);
  });

  it("stores only matching session stubs and never copies composer drafts or transcripts", () => {
    const tab = { ...newTab("session"), id: "tab" };
    const stub = {
      id: "session",
      cwd,
      harness: "codex",
      model: "codex:gpt-test",
      modelSettings: { effort: "high", invalid: 4 },
      runtimeMode: "full-access",
      title: "Blank task",
      providerSessionId: "provider-id",
      draft: { text: "private draft" },
      transcript: "private transcript",
    };
    const state = parseWorkspaceRecovery({
      version: 1,
      layouts: [],
      closed: [
        {
          kind: "tab",
          cwd,
          closedAt: 1,
          tab,
          sessionStubs: [stub, { ...stub, id: "unrelated" }, stub],
        },
      ],
    });
    expect(state.closed).toHaveLength(1);
    expect(state.closed[0]).toMatchObject({
      sessionStubs: [
        {
          id: "session",
          title: "Blank task",
          providerSessionId: "provider-id",
          modelSettings: { effort: "high" },
        },
      ],
    });
    expect(JSON.stringify(state)).not.toMatch(
      /draft|transcript|unrelated|invalid/,
    );
  });

  it("copies a tab at close time and strips terminal runtime fields", () => {
    const tab: WorkspaceTab = {
      ...newTab("session"),
      id: "tab",
      editorPanes: [{ id: "editor", activeFileId: "file", files: [file] }],
      terminalPanes: [
        {
          id: "terminal",
          activeFileId: "shell",
          files: [
            {
              id: "shell",
              path: "Shell",
              cwd,
              terminal: true,
              foreground: "npm run dev",
            },
          ],
        },
      ],
    };
    const state = pushClosedWorkspaceEntry(emptyWorkspaceRecovery(), {
      kind: "tab",
      cwd,
      closedAt: 1,
      tab,
    });
    tab.editorPanes[0].files[0].path = "/changed";
    const entry = state.closed[0];
    expect(entry.kind === "tab" && entry.tab.editorPanes[0].files[0].path).toBe(
      "/synthetic/project/a.ts",
    );
    expect(JSON.stringify(state)).not.toContain("npm run dev");
    file.path = "/synthetic/project/a.ts";
  });

  it("reopens terminal panes with fresh identities while retaining session references", () => {
    const tab: WorkspaceTab = {
      ...newTab("session"),
      id: "tab",
      focusedId: "terminal",
      layout: {
        type: "split",
        id: "split",
        dir: "right",
        sizes: [0.4, 0.6],
        children: [leaf("session"), leaf("terminal")],
      },
      terminalPanes: [
        {
          id: "terminal",
          activeFileId: "shell",
          files: [
            {
              id: "shell",
              path: "Shell",
              cwd,
              terminal: true,
              foreground: "dangerous command",
            },
          ],
        },
      ],
    };
    let seq = 0;
    const restored = prepareRecoveredWorkspaceTab(tab, () => `fresh-${++seq}`);
    expect(restored.id).toBe("tab");
    expect(leafIds(restored.layout)).toEqual(["session", "fresh-1"]);
    expect(restored.focusedId).toBe("fresh-1");
    expect(restored.terminalPanes[0]).toEqual({
      id: "fresh-1",
      activeFileId: "fresh-2",
      files: [{ id: "fresh-2", path: "Shell", cwd, terminal: true }],
    });
    expect(tab.terminalPanes[0].id).toBe("terminal");
  });
});

describe("layout undo", () => {
  it("restores group layout without resurrecting closed IDs or dropping new IDs", () => {
    const previous = resolveWorkspaceView(
      {
        layout: {
          type: "split",
          id: "split",
          dir: "right",
          children: [leaf("a"), leaf("c")],
          sizes: [0.4, 0.6],
        },
        order: ["a", "b", "c"],
        focusedId: "a",
        groups: { a: ["a", "b"], c: ["c"] },
      },
      ["a", "b", "c"],
      "a",
    );
    const state = pushWorkspaceLayoutUndo(
      emptyWorkspaceRecovery(),
      cwd,
      previous,
    );
    const result = popWorkspaceLayoutUndo(state, cwd, ["b", "c", "new"], "c");
    expect(result.view?.order).toContain("new");
    expect(result.view?.order).not.toContain("a");
    expect(leafIds(result.view!.layout!)).toEqual(["b", "c"]);
    expect(Object.values(result.view!.groups).flat().sort()).toEqual([
      "b",
      "c",
      "new",
    ]);
    expect(result.state.layouts).toHaveLength(0);
    expect(state.layouts).toHaveLength(1);
  });

  it("bounds layout history separately, avoids identical captures, and isolates projects", () => {
    let state = emptyWorkspaceRecovery();
    for (let index = 0; index < 25; index++)
      state = pushWorkspaceLayoutUndo(
        state,
        cwd,
        resolveWorkspaceView(undefined, [String(index)], String(index)),
      );
    expect(state.layouts).toHaveLength(20);
    const duplicate = pushWorkspaceLayoutUndo(
      state,
      cwd,
      state.layouts[19].view,
    );
    expect(duplicate).toBe(state);
    state = pushWorkspaceLayoutUndo(
      state,
      "/elsewhere",
      resolveWorkspaceView(undefined, ["other"], "other"),
    );
    expect(
      popWorkspaceLayoutUndo(state, cwd, ["24"], "24").state.layouts.some(
        (entry) => entry.cwd === "/elsewhere",
      ),
    ).toBe(true);
    expect(popWorkspaceLayoutUndo(state, "/missing", [], "")).toEqual({
      state,
      view: null,
    });
  });

  it("never persists nested expansion backups or view runtime fields", () => {
    const view = {
      ...resolveWorkspaceView(undefined, ["tab"], "tab"),
      restoreView: { secret: "backup" },
      runtime: "buffer",
    };
    const state = pushWorkspaceLayoutUndo(emptyWorkspaceRecovery(), cwd, view);
    expect(JSON.stringify(state)).not.toMatch(
      /restoreView|secret|runtime|buffer/,
    );
    expect(popWorkspaceLayoutUndo(state, cwd, [], "").view?.layout).toBeNull();
  });
});

describe("versioned recovery storage", () => {
  it("roundtrips only schema-whitelisted metadata with a caller-owned storage key", () => {
    const storage = memoryStorage();
    const state = pushClosedWorkspaceEntry(
      emptyWorkspaceRecovery(),
      browserEntry("a"),
    );
    expect(saveWorkspaceRecovery(state, storage, "window-owned-key")).toBe(
      true,
    );
    expect(loadWorkspaceRecovery(storage, "window-owned-key")).toEqual(state);
    expect(loadWorkspaceRecovery(storage)).toEqual(emptyWorkspaceRecovery());
  });

  it("rejects unknown schema versions, malformed entries and oversized/deep storage", () => {
    expect(
      parseWorkspaceRecovery({
        version: 2,
        closed: [browserEntry("a")],
        layouts: [],
      }),
    ).toEqual(emptyWorkspaceRecovery());
    expect(
      parseWorkspaceRecovery({
        version: 1,
        closed: [
          { kind: "tab", cwd, closedAt: "now", tab: {} },
          { ...browserEntry("a"), closedAt: Infinity },
        ],
        layouts: [{}],
      }),
    ).toEqual(emptyWorkspaceRecovery());
    const storage = memoryStorage();
    storage.setItem("bad", "not json");
    expect(loadWorkspaceRecovery(storage, "bad")).toEqual(
      emptyWorkspaceRecovery(),
    );
    storage.setItem("large", " ".repeat(1_000_001));
    expect(loadWorkspaceRecovery(storage, "large")).toEqual(
      emptyWorkspaceRecovery(),
    );
    let layout: unknown = leaf("session");
    for (let index = 0; index < 30; index++)
      layout = {
        type: "split",
        id: `split-${index}`,
        dir: "right",
        children: [layout, leaf(`leaf-${index}`)],
        sizes: [0.5, 0.5],
      };
    expect(
      parseWorkspaceRecovery({
        version: 1,
        layouts: [],
        closed: [
          {
            kind: "tab",
            cwd,
            closedAt: 1,
            tab: { ...newTab("session"), layout },
          },
        ],
      }).closed,
    ).toHaveLength(0);
  });

  it("handles unavailable storage without blocking tab or layout operations", () => {
    const storage = {
      getItem() {
        throw new Error("Unavailable");
      },
      setItem() {
        throw new Error("Full");
      },
    };
    expect(loadWorkspaceRecovery(storage)).toEqual(emptyWorkspaceRecovery());
    expect(saveWorkspaceRecovery(emptyWorkspaceRecovery(), storage)).toBe(
      false,
    );
  });
});

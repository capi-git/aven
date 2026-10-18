import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const failPrepare = { value: false };

vi.mock("./checkpoint", () => ({
  ensureSessionCheckpoint: vi.fn(async (id: string, cwd: string) => {
    calls.push(`ensure ${id} ${cwd}`);
  }),
  prepareSessionCheckpoint: vi.fn(
    async (id: string, cwd: string, paths: string[]) => {
      if (failPrepare.value) throw new Error("no checkpoint");
      calls.push(`prepare ${id} ${cwd} ${paths.join(",")}`);
    },
  ),
  captureSessionCheckpoint: vi.fn(
    async (id: string, cwd: string, paths: string[]) => {
      calls.push(`capture ${id} ${cwd} ${paths.join(",")}`);
    },
  ),
  notifyReviewChanged: vi.fn((id?: string) => {
    calls.push(`notify ${id}`);
  }),
}));
vi.mock("./errors", () => ({ logError: vi.fn() }));

const { applyForChat, installChatFolders, turnChangeOwner } =
  await import("./teamChanges");

describe("turnChangeOwner", () => {
  it("keeps a chat's own turn in its own changes", () => {
    expect(
      turnChangeOwner({ sessionId: "a", workCwd: "/p/site", driven: false }),
    ).toEqual({ sessionId: "a", cwd: "/p/site" });
    expect(
      turnChangeOwner({ sessionId: "a", workCwd: "~", driven: false }),
    ).toBeNull();
  });

  it("puts what a run's workers and lead write in the lead's changes", () => {
    const lead = { id: "lead", workCwd: "/p/site" };
    expect(
      turnChangeOwner({
        sessionId: "worker",
        workCwd: "/p/site/",
        driven: true,
        lead,
      }),
    ).toEqual({ sessionId: "lead", cwd: "/p/site" });
    expect(
      turnChangeOwner({
        sessionId: "lead",
        workCwd: "/p/site",
        driven: true,
        lead,
      }),
    ).toEqual({ sessionId: "lead", cwd: "/p/site" });
  });

  it("records nothing for a driven turn away from its lead's folder", () => {
    expect(
      turnChangeOwner({
        sessionId: "worker",
        workCwd: "/p/other",
        driven: true,
        lead: { id: "lead", workCwd: "/p/site" },
      }),
    ).toBeNull();
    expect(
      turnChangeOwner({
        sessionId: "worker",
        workCwd: "/p/site",
        driven: true,
      }),
    ).toBeNull();
  });
});

describe("applyForChat", () => {
  let uninstall: () => void;

  beforeEach(() => {
    calls.length = 0;
    failPrepare.value = false;
    uninstall = installChatFolders((id) =>
      id === "origin" ? "/p/site" : undefined,
    );
  });
  afterEach(() => uninstall());

  const apply = vi.fn(async () => {
    calls.push("apply");
  });

  it("reads the files before and after, so they are the chat's to review", async () => {
    await applyForChat(
      "origin",
      ["/p/site/app.js", "/p/site/README.md"],
      apply,
    );
    expect(calls).toEqual([
      "ensure origin /p/site",
      "prepare origin /p/site /p/site/app.js,/p/site/README.md",
      "apply",
      "capture origin /p/site /p/site/app.js,/p/site/README.md",
      "notify origin",
    ]);
  });

  it("only brings the changes in for a chat it cannot place", async () => {
    await applyForChat("elsewhere", ["/p/site/app.js"], apply);
    await applyForChat(undefined, ["/p/site/app.js"], apply);
    expect(calls).toEqual(["apply", "apply"]);
  });

  it("still brings the changes in when the chat's checkpoint cannot be read", async () => {
    failPrepare.value = true;
    await applyForChat("origin", ["/p/site/app.js"], apply);
    expect(calls).toEqual(["ensure origin /p/site", "apply"]);
  });

  it("records nothing when bringing them in fails", async () => {
    await expect(
      applyForChat("origin", ["/p/site/app.js"], async () => {
        throw new Error("conflict with edits in your project");
      }),
    ).rejects.toThrow("conflict");
    expect(calls).toEqual([
      "ensure origin /p/site",
      "prepare origin /p/site /p/site/app.js",
    ]);
  });
});

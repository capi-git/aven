import { describe, expect, it, vi } from "vitest";
import { summarizeRelease, type ReleaseStatus } from "./gitHousekeeping";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function status(overrides: Partial<ReleaseStatus> = {}): ReleaseStatus {
  return {
    base: "main",
    latest: {
      tag: "v0.1.107",
      name: "Aven 0.1.107",
      url: "https://example.com/r",
      publishedAt: "2026-09-28T19:00:31Z",
    },
    unreleased: 0,
    version: "0.1.107",
    sourceSha: "a".repeat(40),
    versionUnreleased: false,
    workflow: "release.yml",
    workflowHasPublish: true,
    run: {
      status: "completed",
      conclusion: "success",
      url: "https://example.com/run",
      createdAt: "2026-09-28T18:40:00Z",
      headSha: "abc",
    },
    ...overrides,
  };
}

describe("release summary", () => {
  it("is up to date when main has nothing new", () => {
    expect(summarizeRelease(status())).toMatchObject({
      tone: "ok",
      title: "v0.1.107 is up to date",
      publish: null,
    });
  });

  it("asks for a new version before unreleased changes can publish", () => {
    const summary = summarizeRelease(status({ unreleased: 3 }));
    expect(summary.title).toBe("v0.1.107 is the latest release");
    expect(summary.detail).toBe(
      "3 changes on main since v0.1.107. Set a new version to publish them.",
    );
    expect(summary.publish).toBeNull();
  });

  it("offers to publish a version that has no tag yet", () => {
    const summary = summarizeRelease(
      status({ unreleased: 1, version: "0.1.108", versionUnreleased: true }),
    );
    expect(summary).toMatchObject({
      tone: "info",
      title: "Version 0.1.108 is ready to publish",
      detail: "1 change on main since v0.1.107.",
      publish: "0.1.108",
    });
    // A workflow without a publish input cannot be driven from the card.
    expect(
      summarizeRelease(
        status({
          version: "0.1.108",
          versionUnreleased: true,
          workflowHasPublish: false,
        }),
      ).publish,
    ).toBeNull();
  });

  it("hides the button while a release runs and warns after a failure", () => {
    const running = summarizeRelease(
      status({
        version: "0.1.108",
        versionUnreleased: true,
        run: { ...status().run!, status: "in_progress", conclusion: "" },
      }),
    );
    expect(running).toMatchObject({ tone: "busy", publish: null });
    const failed = summarizeRelease(
      status({
        version: "0.1.108",
        versionUnreleased: true,
        run: { ...status().run!, conclusion: "failure" },
      }),
    );
    expect(failed).toMatchObject({ tone: "warn", publish: "0.1.108" });
  });

  it("does not offer publication without a verified source commit", () => {
    for (const sourceSha of [null, ""]) {
      expect(
        summarizeRelease(
          status({ version: "0.1.108", versionUnreleased: true, sourceSha }),
        ).publish,
      ).toBeNull();
    }
  });

  it("explains a project without releases", () => {
    expect(
      summarizeRelease(
        status({ latest: null, unreleased: null, workflow: null }),
      ),
    ).toMatchObject({
      title: "No releases yet",
      detail: "This project has no release workflow.",
    });
  });
});

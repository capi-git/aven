import { describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  invoke: vi.fn(async () => "/data/sample-projects/sample-site"),
}));
vi.mock("@tauri-apps/api/core", () => core);

import { createSampleProject, isSampleProject } from "./sampleProject";

describe("the walkthrough's sample", () => {
  it("is made by Aven's own command, which picks the folder", async () => {
    await expect(createSampleProject()).resolves.toBe(
      "/data/sample-projects/sample-site",
    );
    expect(core.invoke).toHaveBeenCalledExactlyOnceWith(
      "create_sample_project",
    );
  });

  it("is recognised by where Aven keeps it, on any platform", () => {
    expect(
      isSampleProject(
        "/Users/me/Library/Application Support/com.capi.monocode.personal/sample-projects/sample-site",
      ),
    ).toBe(true);
    expect(
      isSampleProject(
        "C:\\Users\\me\\AppData\\Roaming\\aven\\sample-projects\\sample-site\\",
      ),
    ).toBe(true);
    expect(isSampleProject("/Users/me/code/sample-site")).toBe(false);
    expect(isSampleProject("/Users/me/sample-projects/sample-site-2")).toBe(
      false,
    );
  });
});

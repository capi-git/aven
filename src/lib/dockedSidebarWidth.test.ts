// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";

const VALUE = "--aven-sidebar-width";

beforeEach(() => vi.resetModules());

it("reaches a row that mounts after the sidebar, and follows a resize", async () => {
  const { attachDockedSidebarWidth, publishDockedSidebarWidth } =
    await import("./dockedSidebarWidth");
  publishDockedSidebarWidth(240);
  const row = document.createElement("div");
  attachDockedSidebarWidth(row);
  expect(row.style.getPropertyValue(VALUE)).toBe("240px");
  publishDockedSidebarWidth(260);
  expect(row.style.getPropertyValue(VALUE)).toBe("260px");
});

it("reaches a row that comes back, and never the root", async () => {
  const { attachDockedSidebarWidth, publishDockedSidebarWidth } =
    await import("./dockedSidebarWidth");
  attachDockedSidebarWidth(document.createElement("div"));
  attachDockedSidebarWidth(null);
  publishDockedSidebarWidth(300);
  const next = document.createElement("div");
  attachDockedSidebarWidth(next);
  expect(next.style.getPropertyValue(VALUE)).toBe("300px");
  expect(document.documentElement.style.getPropertyValue(VALUE)).toBe("");
});

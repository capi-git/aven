// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { applyTypography } from "./typography";
import { SETTINGS } from "./settings";

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  });
});

it("sets the chat text size and code font, and clears them at the defaults", () => {
  const root = document.createElement("div");
  applyTypography(root);
  expect(root.style.getPropertyValue("--text-ui-reading")).toBe("");
  expect(root.style.getPropertyValue("--font-mono")).toBe("");

  SETTINGS.chatTextSize.save(16);
  SETTINGS.codeFont.save("JetBrains Mono");
  applyTypography(root);
  expect(root.style.getPropertyValue("--text-ui-reading")).toBe("16px");
  expect(root.style.getPropertyValue("--font-mono")).toContain(
    '"JetBrains Mono"',
  );

  SETTINGS.chatTextSize.save(14);
  SETTINGS.codeFont.save("");
  applyTypography(root);
  expect(root.style.getPropertyValue("--text-ui-reading")).toBe("");
  expect(root.style.getPropertyValue("--font-mono")).toBe("");
});

it("ignores a stored font name that is not a plain name", () => {
  localStorage.setItem("aven.codeFont", 'x"; color: red');
  expect(SETTINGS.codeFont.load()).toBe("");
});

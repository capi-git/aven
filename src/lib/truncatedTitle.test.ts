// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { isTextTruncated, syncTruncatedTitle } from "./truncatedTitle";

function row(name: string, scrollWidth: number, clientWidth: number) {
  const button = document.createElement("button");
  const label = document.createElement("span");
  label.className = "personal-task-title";
  label.textContent = name;
  Object.defineProperty(label, "scrollWidth", { value: scrollWidth });
  Object.defineProperty(label, "clientWidth", { value: clientWidth });
  button.append(label);
  return { button, label };
}

describe("truncated names", () => {
  it("knows when text is cut off", () => {
    expect(isTextTruncated(row("A", 180, 120).label)).toBe(true);
    expect(isTextTruncated(row("A", 120, 120).label)).toBe(false);
    expect(isTextTruncated(null)).toBe(false);
  });

  it("shows the full name as a tooltip only while it is cut off", () => {
    const cut = row("Refactor the browser pane's corners", 240, 120);
    syncTruncatedTitle(cut.button);
    expect(cut.button.title).toBe("Refactor the browser pane's corners");
    const whole = row("Short", 40, 120);
    whole.button.title = "stale";
    syncTruncatedTitle(whole.button);
    expect(whole.button.hasAttribute("title")).toBe(false);
  });
});

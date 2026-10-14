import { describe, expect, it } from "vitest";
import { errorText, failureText } from "./errors";

describe("failure messages", () => {
  it("keeps a native command's plain-string rejection", () => {
    expect(
      failureText(
        "current webview is not a WebviewWindow",
        "claude adapter failed",
      ),
    ).toBe("current webview is not a WebviewWindow");
  });

  it("keeps an Error's message", () => {
    expect(failureText(new Error("spawn ENOENT"), "fallback")).toBe(
      "spawn ENOENT",
    );
  });

  it("uses the fallback only when there is no message", () => {
    expect(failureText(undefined, "fallback")).toBe("fallback");
    expect(failureText(null, "fallback")).toBe("fallback");
    expect(failureText("  ", "fallback")).toBe("fallback");
    expect(failureText(new Error(""), "fallback")).toBe("fallback");
  });

  it("normalizes any caught value", () => {
    expect(errorText(42)).toBe("42");
  });
});

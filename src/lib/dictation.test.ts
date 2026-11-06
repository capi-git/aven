import { describe, expect, it } from "vitest";
import {
  dictationProblem,
  isDictationHotkey,
  spliceSpoken,
  wordCount,
} from "./dictation";

const key = (
  overrides: Partial<Parameters<typeof isDictationHotkey>[0]> = {},
) => ({
  key: "m",
  code: "KeyM",
  metaKey: true,
  ctrlKey: false,
  altKey: false,
  shiftKey: true,
  ...overrides,
});

describe("where spoken words go", () => {
  it("fills an empty message", () => {
    expect(spliceSpoken("", "Add a mic button", "")).toEqual({
      text: "Add a mic button",
      caret: 16,
    });
  });

  it("adds a space after typed words, never two", () => {
    expect(spliceSpoken("Please", "add a mic", "").text).toBe(
      "Please add a mic",
    );
    expect(spliceSpoken("Please ", "add a mic", "").text).toBe(
      "Please add a mic",
    );
  });

  it("goes between the words around the caret, and leaves the caret after it", () => {
    const spoken = spliceSpoken("Make the", "send button", "bigger");
    expect(spoken.text).toBe("Make the send button bigger");
    expect(spoken.caret).toBe("Make the send button".length);
  });

  it("keeps punctuation that follows tight against the words", () => {
    expect(spliceSpoken("Fix", "the build", ". Then ship").text).toBe(
      "Fix the build. Then ship",
    );
  });

  it("leaves the text as it was until something is heard", () => {
    expect(spliceSpoken("Hello", "  ", " there")).toEqual({
      text: "Hello there",
      caret: 5,
    });
  });
});

describe("the dictation shortcut", () => {
  it("is ⇧⌘M", () => {
    expect(isDictationHotkey(key())).toBe(true);
    expect(isDictationHotkey(key({ key: "M" }))).toBe(true);
  });

  it("is nothing else", () => {
    expect(isDictationHotkey(key({ shiftKey: false }))).toBe(false);
    expect(isDictationHotkey(key({ altKey: true }))).toBe(false);
    expect(isDictationHotkey(key({ ctrlKey: true }))).toBe(false);
    expect(isDictationHotkey(key({ metaKey: false }))).toBe(false);
    expect(isDictationHotkey(key({ key: "n", code: "KeyN" }))).toBe(false);
  });

  it("doesn't flicker on and off while held", () => {
    expect(isDictationHotkey(key({ repeat: true }))).toBe(false);
  });
});

describe("a refusal in plain words", () => {
  it("points at the setting that fixes it", () => {
    expect(dictationProblem("microphone-denied").settings).toBe("microphone");
    expect(dictationProblem("speech-denied").settings).toBe("speech");
    expect(dictationProblem("on-device").settings).toBe("keyboard");
    expect(dictationProblem("language").settings).toBe("keyboard");
  });

  it("says what went wrong when nothing in Settings fixes it", () => {
    expect(dictationProblem("no-microphone")).toEqual({
      text: "No microphone found. Connect one and try again.",
    });
    expect(dictationProblem("failed", "The audio engine stopped.")).toEqual({
      text: "Couldn't listen: The audio engine stopped.",
    });
    expect(dictationProblem("failed")).toEqual({ text: "Couldn't listen." });
  });

  it("never offers to send audio anywhere", () => {
    for (const code of [
      "microphone-denied",
      "speech-denied",
      "on-device",
      "language",
      "no-microphone",
      "unavailable",
      "failed",
    ])
      expect(dictationProblem(code).text).not.toMatch(/server|online|cloud/i);
  });
});

describe("counting words", () => {
  it("counts runs of non-space", () => {
    expect(wordCount("")).toBe(0);
    expect(wordCount("   ")).toBe(0);
    expect(wordCount(" add  a\nmic ")).toBe(3);
  });
});

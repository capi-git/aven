import { describe, expect, it } from "vitest";
import {
  DICTATION_PAUSE_MS,
  dictationProblem,
  heardText,
  hearWords,
  isDictationHotkey,
  NOTHING_HEARD,
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

/** Reports from the recogniser: the text, how long after the one before, and
 * whether it closed the stretch. */
type Report = [text: string, afterMs?: number, paused?: boolean];

function listen(reports: Report[]): string[] {
  let heard = NOTHING_HEARD;
  let at = 5000;
  return reports.map(([text, afterMs = 200, paused = false]) => {
    at += afterMs;
    heard = hearWords(heard, text, at, paused);
    return heardText(heard);
  });
}
const lastHeard = (reports: Report[]) => listen(reports).at(-1);
const PAUSE = DICTATION_PAUSE_MS * 2;

describe("what was heard across the recogniser's pauses", () => {
  it("follows one stretch of speech as it grows and is heard differently", () => {
    expect(
      listen([
        ["I"],
        ["I scream"],
        ["Ice cream for"],
        ["Ice cream for twenty five"],
        ["Ice cream for 25 people"],
        ["Ice cream for 25 people."],
      ]),
    ).toEqual([
      "I",
      "I scream",
      "Ice cream for",
      "Ice cream for twenty five",
      "Ice cream for 25 people",
      "Ice cream for 25 people.",
    ]);
  });

  it("keeps the words before a pause when the text starts over", () => {
    expect(
      listen([
        ["Add a"],
        ["Add a mic button"],
        ["And", PAUSE],
        ["And make it"],
        ["And make it round"],
      ]),
    ).toEqual([
      "Add a",
      "Add a mic button",
      "Add a mic button And",
      "Add a mic button And make it",
      "Add a mic button And make it round",
    ]);
  });

  it("keeps a short stretch the recogniser said it had closed", () => {
    // Too quick and too short to tell by the clock or the length alone.
    expect(
      lastHeard([["Okay"], ["Okay.", 200, true], ["So", 300], ["So then"]]),
    ).toBe("Okay. So then");
  });

  it("keeps the words through any number of pauses", () => {
    expect(
      lastHeard([
        ["One two three"],
        ["Four", PAUSE],
        ["Four five six"],
        ["Four five six.", 900, true],
        ["Seven", 400],
        ["Seven eight"],
      ]),
    ).toBe("One two three Four five six. Seven eight");
  });

  it("keeps a stretch that starts with the same words as the one before", () => {
    expect(
      lastHeard([
        ["And then I went home"],
        ["And", PAUSE],
        ["And then I slept"],
      ]),
    ).toBe("And then I went home And then I slept");
  });

  it("loses nothing to a report of no text", () => {
    expect(
      listen([["Hello there"], ["", PAUSE], ["How", 100], ["How are you"]]),
    ).toEqual([
      "Hello there",
      "Hello there",
      "Hello there How",
      "Hello there How are you",
    ]);
    // The last report after a stop can be empty too.
    expect(lastHeard([["Hello there"], ["", 300]])).toBe("Hello there");
    expect(lastHeard([[""], ["  "]])).toBe("");
  });

  it("goes on with the same stretch after a pause that didn't start it over", () => {
    expect(
      lastHeard([
        ["Add a mic button"],
        ["Add a mic button and make it round", PAUSE],
      ]),
    ).toBe("Add a mic button and make it round");
    // Even one the recogniser closed, or heard a little differently.
    expect(
      lastHeard([
        ["Add a mic button"],
        ["Add a mic button.", 900, true],
        ["Add a mic button and", 400],
      ]),
    ).toBe("Add a mic button and");
    expect(
      lastHeard([
        ["I need twenty five of them"],
        ["I need 25 of them now", PAUSE],
      ]),
    ).toBe("I need 25 of them now");
  });

  it("doesn't say the earlier words twice when the recogniser gives them again", () => {
    expect(
      lastHeard([
        ["Add a mic button"],
        ["And make", PAUSE],
        ["Add a mic button and make it round.", 300],
      ]),
    ).toBe("Add a mic button and make it round.");
  });

  it("doesn't take a word heard differently mid-speech for a new start", () => {
    expect(lastHeard([["to gather"], ["together"], ["together we"]])).toBe(
      "together we",
    );
    expect(lastHeard([["Hello the"], ["Hello"], ["Hello there"]])).toBe(
      "Hello there",
    );
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

import { expect, it } from "vitest";
import { listText, plural, possessive } from "./words";

it("counts with the right plural", () => {
  expect(plural(1, "file")).toBe("1 file");
  expect(plural(3, "file")).toBe("3 files");
  expect(plural(0, "agent")).toBe("0 agents");
  expect(plural(2, "reply", "replies")).toBe("2 replies");
});

it("lists names without a comma before the last", () => {
  expect(listText([])).toBe("");
  expect(listText(["Claude"])).toBe("Claude");
  expect(listText(["Claude", "Codex"])).toBe("Claude and Codex");
  expect(listText(["Claude", "Codex", "Grok"])).toBe("Claude, Codex and Grok");
});

it("makes a name own something", () => {
  expect(possessive("Codex")).toBe("Codex's");
});

import { bundledLanguages, bundledLanguagesInfo } from "shiki";
import { describe, expect, it } from "vitest";
import {
  CODE_LANGUAGES,
  isCodeLanguage,
  normalizeCodeLanguage,
} from "./codeLanguages";

describe("code languages", () => {
  it("lists exactly the languages and aliases Shiki bundles", () => {
    // After a Shiki update, copy its `bundledLanguagesInfo` ids and aliases
    // into codeLanguages.ts.
    expect([...CODE_LANGUAGES].sort()).toEqual(
      Object.keys(bundledLanguages).sort(),
    );
    for (const info of bundledLanguagesInfo) {
      expect(normalizeCodeLanguage(info.id)).toBe(info.id);
      for (const alias of info.aliases ?? []) {
        expect(normalizeCodeLanguage(alias)).toBe(info.id);
      }
    }
  });

  it("matches fence names case-insensitively and rejects unknown ones", () => {
    expect(normalizeCodeLanguage(" TS ")).toBe("typescript");
    expect(isCodeLanguage("Bash")).toBe(true);
    expect(isCodeLanguage("rust")).toBe(true);
    expect(isCodeLanguage("not-a-language")).toBe(false);
    expect(isCodeLanguage("constructor")).toBe(false);
    expect(normalizeCodeLanguage("constructor")).toBe("constructor");
  });
});

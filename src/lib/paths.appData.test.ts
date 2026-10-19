import { describe, expect, it } from "vitest";
import { displayAppData, displayPath, prettyCwd } from "./paths";

const SHOT = "turn-shots/11e225b6/1792438599200-preview-login.png";

describe("displayAppData", () => {
  it.each([
    [
      "the absolute macOS folder",
      `/Users/jack/Library/Application Support/com.capi.monocode.personal/${SHOT}`,
    ],
    [
      "the macOS folder from home",
      `~/Library/Application Support/com.capi.monocode.personal/${SHOT}`,
    ],
    [
      "a home folder with a space in its name",
      `/Users/Jack Hagan/Library/Application Support/com.capi.monocode.personal/${SHOT}`,
    ],
    [
      "the dev build's folder",
      `/Users/jack/Library/Application Support/com.capi.aven.dev/${SHOT}`,
    ],
    [
      "the Windows roaming folder",
      `C:/Users/jack/AppData/Roaming/com.capi.monocode.personal/${SHOT}`,
    ],
    [
      "the Windows local folder",
      `D:/Users/jack/AppData/Local/com.capi.aven.dev/${SHOT}`,
    ],
    [
      "a Windows folder shortened from home",
      `~/AppData/Roaming/com.capi.monocode.personal/${SHOT}`,
    ],
    ["the %APPDATA% folder", `%APPDATA%/com.capi.monocode.personal/${SHOT}`],
    ["the %LOCALAPPDATA% folder", `%LOCALAPPDATA%/com.capi.aven.dev/${SHOT}`],
  ])("names %s Aven data", (_, path) => {
    expect(displayAppData(path)).toBe(`Aven data/${SHOT}`);
  });

  it("keeps a Windows path's own separators", () => {
    expect(
      displayAppData(
        "C:\\Users\\jack\\AppData\\Roaming\\com.capi.monocode.personal\\turn-shots\\s1\\a.png",
      ),
    ).toBe("Aven data\\turn-shots\\s1\\a.png");
    expect(displayAppData("%APPDATA%\\com.capi.monocode.personal\\notes")).toBe(
      "Aven data\\notes",
    );
  });

  it("names the folder itself and every mention in a line", () => {
    expect(
      displayAppData(
        "/Users/jack/Library/Application Support/com.capi.monocode.personal",
      ),
    ).toBe("Aven data");
    expect(
      displayAppData(
        `Reading ~/Library/Application Support/com.capi.monocode.personal/${SHOT}`,
      ),
    ).toBe(`Reading Aven data/${SHOT}`);
    expect(
      displayAppData(
        "cp ~/Library/Application Support/com.capi.aven.dev/a.png /Users/jack/Library/Application Support/com.capi.monocode.personal/b.png",
      ),
    ).toBe("cp Aven data/a.png Aven data/b.png");
    expect(
      displayAppData(
        "Saved under ~/Library/Application Support/com.capi.monocode.personal.",
      ),
    ).toBe("Saved under Aven data.");
  });

  it("reads the shortened and project-relative forms paths are shown in", () => {
    const lane =
      "/Users/jack/Library/Application Support/com.capi.monocode.personal/races/r1/1";
    expect(displayAppData(prettyCwd(lane))).toBe("Aven data/races/r1/1");
    expect(displayAppData(displayPath(`${lane}/src/app.ts`, "/repo"))).toBe(
      "Aven data/races/r1/1/src/app.ts",
    );
  });

  it.each([
    ["a project path", "/Users/jack/Developer/Aven/src/lib/paths.ts"],
    [
      "a project named like Aven's old name",
      "/Users/jack/Code/monocode/app.ts",
    ],
    [
      "a project folder named after the identifier",
      "/Users/jack/Developer/com.capi.monocode.personal/notes.md",
    ],
    [
      "a different app's folder sharing the prefix",
      "/Users/jack/Library/Application Support/com.capi.monocode.personal-backup/x",
    ],
    [
      "a folder with a longer identifier",
      "/Users/jack/Library/Application Support/com.capi.monocode.personal.old/x",
    ],
    [
      "a home folder on another volume",
      "/Volumes/Data/Users/jack/Library/Application Support/com.capi.monocode.personal/x",
    ],
    ["plain words", "Built on MonoCode (com.capi.monocode.personal)"],
    ["nothing", ""],
  ])("leaves %s unchanged", (_, text) => {
    expect(displayAppData(text)).toBe(text);
  });

  it("passes an absent value through", () => {
    expect(displayAppData(undefined)).toBeUndefined();
  });
});

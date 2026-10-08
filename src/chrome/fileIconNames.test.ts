import {
  getFileIcon,
  getFolderIcon,
  getIconSvg,
} from "react-material-icon-theme";
import { describe, expect, it } from "vitest";
import { FILE_ICON_SVGS, iconNameFor } from "./fileIconNames";

describe("lazy file icon data", () => {
  it("keeps every bundled glyph identical to the installed theme", () => {
    for (const [name, svg] of Object.entries(FILE_ICON_SVGS)) {
      expect(svg, name).toBe(getIconSvg(name));
    }
  });

  it("retains filename, compound extension, case and unknown-file lookup", () => {
    for (const name of ["README.MD", ".gitignore", "package.json"]) {
      expect(iconNameFor(name, false, false, false)).toBe(
        getFileIcon({ fileName: name.toLowerCase(), iconPack: "" }),
      );
    }
    expect(iconNameFor("types.D.TS", false, false, false)).toBe(
      getFileIcon({ fileExtension: "d.ts", iconPack: "" }),
    );
    expect(iconNameFor("unknown.avenunknown", false, false, false)).toBe(
      "file",
    );
    for (const isOpen of [false, true]) {
      for (const isRoot of [false, true]) {
        expect(iconNameFor("src", true, isOpen, isRoot)).toBe(
          getFolderIcon({ folderName: "src", isOpen, isRoot }),
        );
      }
    }
  });
});

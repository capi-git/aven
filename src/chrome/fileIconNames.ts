// Name lookup only: Rollup tree-shakes the package's embedded SVG table away
// from these two functions, leaving its file and folder association data.
import { getFileIcon, getFolderIcon } from "react-material-icon-theme";
export { FILE_ICON_SVGS } from "./fileIconSubset";

export function iconNameFor(
  name: string,
  isDir: boolean,
  isOpen: boolean,
  isRoot: boolean,
): string {
  return isDir
    ? getFolderIcon({ folderName: name, isOpen, isRoot })
    : resolveFileIcon(name);
}

/**
 * The package only checks `fileExtension` when that prop is set — it does not
 * peel an extension off `fileName`. Try the full name, then compound suffixes
 * (`d.ts`, then `ts`) so `.rs` / `.toml` / `.json` resolve by compound suffix.
 */
function resolveFileIcon(fileName: string): string {
  const key = fileName.toLowerCase();
  const fromName = getFileIcon({
    fileName: key,
    fallback: "",
    iconPack: "",
  });
  if (fromName) return fromName;

  for (const ext of compoundExtensions(key)) {
    const fromExt = getFileIcon({
      fileExtension: ext,
      fallback: "",
      iconPack: "",
    });
    if (fromExt) return fromExt;
  }

  return "file";
}

function compoundExtensions(fileName: string): string[] {
  const parts = fileName.split(".");
  const start = parts[0] === "" ? 1 : 0;
  const exts: string[] = [];
  for (let i = start + 1; i < parts.length; i++) {
    exts.push(parts.slice(i).join("."));
  }
  return exts;
}

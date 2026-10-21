import { useState, type KeyboardEvent, type MouseEvent } from "react";
import type { ExplorerMenuItem } from "../chrome/ExplorerMenu";
import { copyText } from "../lib/clipboard";
import { logError } from "../lib/errors";
import { basename } from "../lib/fs";
import { REVEAL_LABEL } from "../lib/platform";
import { revealFile } from "../lib/revealFile";
import type { EditorNavigation, OpenFileFn } from "../lib/search";

type FileLink = { path: string; navigation?: EditorNavigation };

const ITEMS: ExplorerMenuItem[] = [
  { kind: "item", id: "open", label: "Open" },
  { kind: "item", id: "reveal", label: REVEAL_LABEL },
  { kind: "sep" },
  { kind: "item", id: "copy-path", label: "Copy Path" },
];

/**
 * Right-click actions for a chat reference that resolves to a local file.
 * Without a file, the handlers do nothing, so web links keep the system menu.
 */
export function useFileLinkMenu(file: FileLink | undefined, open: OpenFileFn) {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);

  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    if (!file) return;
    event.preventDefault();
    setPoint({ x: event.clientX, y: event.clientY });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (
      !file ||
      (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))
    )
      return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setPoint({ x: rect.left, y: rect.bottom });
  };

  const menu =
    file && point
      ? {
          x: point.x,
          y: point.y,
          items: ITEMS,
          ariaLabel: `Actions for ${basename(file.path)}`,
          onClose: () => setPoint(null),
          onPick: (id: string) => {
            setPoint(null);
            if (id === "open") open(file.path, file.navigation);
            else if (id === "reveal") revealFile(file.path, "reveal file link");
            else if (id === "copy-path")
              void copyText(file.path).catch((error: unknown) =>
                logError("copy file link path", error),
              );
          },
        }
      : null;

  return { menu, onContextMenu, onKeyDown };
}

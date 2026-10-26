import { createContext, useContext, useMemo, useRef } from "react";
import {
  chatFileReferences,
  projectFileReferences,
  turnFilePaths,
  type ChatFileReferences,
  type FileReferences,
} from "../lib/fileReferences";
import type { Block } from "../lib/session";

/**
 * How file names in a chat turn's replies resolve: against what the chat's
 * agent touched, preferring that turn and the ones before it.
 */
export const ChatFileReferencesContext = createContext<FileReferences | null>(
  null,
);

/**
 * The resolver for a transcript's turns. Its identity changes only when the
 * files the chat touched do, not on every streamed word, so file references
 * in replies render again only when they might resolve differently.
 */
export function useChatFileReferences(
  turns: readonly (readonly Block[])[],
  cwd: string | undefined,
): ChatFileReferences {
  const previous = useRef<readonly (readonly string[])[]>([]);
  const touched = useMemo(() => {
    const next = turns.map((turn) => turnFilePaths(turn, cwd));
    const before = previous.current;
    if (
      before.length === next.length &&
      next.every((paths, index) => samePaths(paths, before[index]!))
    )
      return before;
    previous.current = next;
    return next;
  }, [turns, cwd]);
  return useMemo(() => chatFileReferences(cwd, touched), [cwd, touched]);
}

function samePaths(a: readonly string[], b: readonly string[]): boolean {
  return (
    a === b || (a.length === b.length && a.every((path, i) => path === b[i]))
  );
}

/**
 * How file references resolve where Markdown renders: in a chat turn, with
 * that chat's touched files; elsewhere, with the project's index and folder.
 */
export function useFileReferences(cwd: string | undefined): FileReferences {
  const chat = useContext(ChatFileReferencesContext);
  return chat && chat.cwd === cwd ? chat : projectFileReferences(cwd);
}

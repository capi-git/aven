import { fileLinkHref, resolveFileLink } from "./inAppLinks";
import { normalizeBrowserUrl } from "./browser";

export type ChatReferencePart = {
  text: string;
  href?: string;
  file?: ReturnType<typeof resolveFileLink>;
};

type Reference = ChatReferencePart & { start: number; end: number };

// Delimiters are retained as plain text. Do not find a URL inside another
// scheme, an email address, or a larger word.
const URL_REFERENCE =
  /(^|[\s([{"'`<])((?:https?:\/\/|www\.|localhost\b)[^\s<>"'`]*)/gi;
const DOCUMENT_REFERENCE = /\[[^\]\r\n]+\]\((<[^<>\r\n]+>|[^()\s]+)\)/g;

function trimUrlEnd(value: string): string {
  let end = value.length;
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  const counts: Record<string, number> = {};
  for (const character of value)
    counts[character] = (counts[character] ?? 0) + 1;
  while (end) {
    const last = value[end - 1]!;
    if (/[.,;:!?]/.test(last)) {
      end -= 1;
    } else if (
      pairs[last] &&
      (counts[last] ?? 0) > (counts[pairs[last]!] ?? 0)
    ) {
      counts[last] -= 1;
      end -= 1;
    } else {
      break;
    }
  }
  return value.slice(0, end);
}

/** Decorate references without changing even one character of the message. */
export function chatReferenceParts(
  text: string,
  cwd?: string,
): ChatReferencePart[] {
  const references: Reference[] = [];
  for (const match of text.matchAll(URL_REFERENCE)) {
    const start = match.index! + match[1]!.length;
    const label = trimUrlEnd(match[2]!);
    const local = /^localhost\b/i.test(label);
    const href = /^https?:\/\//i.test(label)
      ? label
      : `${local ? "http" : "https"}://${label}`;
    try {
      const url = new URL(normalizeBrowserUrl(href));
      if (!url.hostname || (local && url.hostname !== "localhost")) continue;
      references.push({
        text: label,
        href: url.href,
        start,
        end: start + label.length,
      });
    } catch {
      // Incomplete or invalid URLs remain editable plain text.
    }
  }
  for (const match of text.matchAll(DOCUMENT_REFERENCE)) {
    // This is source highlighting, not Markdown rendering. URL text wins over
    // Markdown-like fragments in a URL, and every source character is retained.
    const start = match.index!;
    const end = start + match[0].length;
    if (
      text[start - 1] === "!" ||
      references.some(
        (reference) => start < reference.end && end > reference.start,
      )
    )
      continue;
    const target = match[1]!.startsWith("<")
      ? match[1]!.slice(1, -1)
      : match[1]!;
    if (/^(?:www\.|localhost\b)/i.test(target)) continue;
    const file = resolveFileLink(target, cwd);
    if (!file) continue;
    references.push({
      text: match[0],
      start,
      end,
      href: fileLinkHref(file.path, file.navigation),
      file,
    });
  }
  references.sort((a, b) => a.start - b.start);
  const parts: ChatReferencePart[] = [];
  let cursor = 0;
  for (const { start, end, ...reference } of references) {
    if (start < cursor) continue;
    if (start > cursor) parts.push({ text: text.slice(cursor, start) });
    parts.push(reference);
    cursor = end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}

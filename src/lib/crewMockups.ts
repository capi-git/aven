import { basename } from "./fs";
import { MOCKUP_DIR } from "./crews";
import { parentPath } from "./paths";

/**
 * The Designer's mock-ups: where they may be drawn, where Aven keeps them,
 * and what Aven accepts. A mock-up is one self-contained HTML file: inline
 * styles, no scripts from anywhere, nothing fetched from the web.
 */

/** The most a mock-up may be. */
export const MOCKUP_MAX_BYTES = 2 * 1024 * 1024;

/** The file a card's mock-up is drawn as, inside `MOCKUP_DIR`. */
export function mockupFileName(cardId: string): string {
  const safe = cardId.replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 60);
  return `${safe || "mockup"}.html`;
}

/**
 * Where Aven keeps a card's mock-up once the turn ends: beside the team's
 * copies in Aven's own data (never the project, never the copy), one folder
 * per copy, one file per card. The copy's parent is Aven's bots folder.
 */
export function mockupStorePath(copyPath: string, cardId: string): string {
  const parent = parentPath(copyPath.replace(/\/+$/, ""));
  return `${parent}/mockups/${basename(copyPath)}/${mockupFileName(cardId)}`;
}

/** Whether a path the Designer named sits inside its folder in the copy. */
export function insideMockupDir(relative: string): boolean {
  const normal = relative.replace(/\\/g, "/").replace(/^\.\//, "");
  return (
    normal.startsWith(`${MOCKUP_DIR}/`) &&
    !normal.split("/").includes("..") &&
    normal.length > MOCKUP_DIR.length + 1
  );
}

/**
 * Why a mock-up can't be kept, or null when it can: it must be HTML within
 * size, with no script from a file or the web, and no reference to the web
 * at all (a mock-up is self-contained: it never fetches anything).
 */
export function mockupProblem(html: string): string | null {
  const bytes = new TextEncoder().encode(html).length;
  if (!html.trim()) return "the file is empty";
  if (bytes > MOCKUP_MAX_BYTES)
    return `the file is ${(bytes / (1024 * 1024)).toFixed(1)} MB, over the 2 MB a mock-up may be`;
  if (/<script[^>]*\ssrc\s*=/i.test(html))
    return "it loads a script from a file or the web";
  if (/https?:\/\//i.test(html)) return "it refers to the web";
  if (!/<[a-z!][^>]*>/i.test(html)) return "it isn't HTML";
  return null;
}

/**
 * A mock-up as Aven shows it: scripts and event handlers out, the rest as
 * drawn. Shown inside a shadow root, so its styles stay its own.
 */
export function sanitizeMockupHtml(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*\/?>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(
      /\s(href|src|action|formaction)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi,
      "",
    );
}

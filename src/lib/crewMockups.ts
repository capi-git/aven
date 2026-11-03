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
  // `<script src>`, `<script/src=x>`: a script from anywhere.
  if (/<script\b[^>]*\bsrc\s*=/i.test(html))
    return "it loads a script from a file or the web";
  // A web address, or one without its scheme (`src="//cdn…"`, `url(//…)`).
  if (
    /https?:\/\//i.test(html) ||
    /(?:=\s*|url\(\s*|@import\s*)["']?\s*\/\//i.test(html)
  )
    return "it refers to the web";
  // A data: URL that isn't a picture: a page, a font, a script in disguise.
  if (/(?:=\s*|url\(\s*)["']?\s*data:(?!image\/)/i.test(html))
    return "it embeds a data: URL that isn't an image";
  if (!/<[a-z!][^>]*>/i.test(html)) return "it isn't HTML";
  return null;
}

/** Where Aven keeps every copy's mock-ups: a folder beside the copies. */
export function mockupStoreRoot(copyPath: string): string {
  return `${parentPath(copyPath.replace(/\/+$/, ""))}/mockups`;
}

/** Elements a mock-up is shown without: anything that runs, loads or sends. */
const DROPPED_ELEMENTS = [
  "script",
  "noscript",
  "template",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "link",
  "meta",
  "base",
  "form",
];

/** Attributes that name somewhere to fetch from or go to. */
const URL_ATTRIBUTES = new Set([
  "src",
  "srcset",
  "href",
  "xlink:href",
  "poster",
  "action",
  "formaction",
  "background",
  "ping",
  "cite",
  "longdesc",
  "usemap",
  "data",
  "manifest",
  "srcdoc",
  "codebase",
]);

/** A web address, with or without its scheme, anywhere in `value`. */
const WEB = /(?:^|[\s,('"])(?:https?:)?\/\//i;

/** A `url(…)` or `@import` in CSS that reaches the web, to take out. */
const CSS_WEB =
  /(?:@import\s+(?:url\()?\s*["']?\s*(?:https?:)?\/\/[^;]*;?|url\(\s*["']?\s*(?:https?:)?\/\/[^)]*\))/gi;

/**
 * A mock-up as Aven shows it: nothing that runs, loads, sends or leaves the
 * page. Parsed as a document, not patched with patterns: every element that
 * runs or fetches goes (scripts, frames, objects, links, meta, base, forms),
 * every `on*` handler goes, any attribute whose value is a `javascript:`,
 * `vbscript:` or `data:` URL goes (a `data:image/…` picture in `src` may
 * stay), and any web address in a URL attribute, a `style`, a stylesheet
 * or `srcset` goes. Shown inside a shadow root, so its styles stay its own.
 */
export function sanitizeMockupHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const element of [...doc.querySelectorAll(DROPPED_ELEMENTS.join(","))])
    element.remove();
  for (const element of [...doc.querySelectorAll("*")]) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      const drop =
        name.startsWith("on") ||
        (/^(?:javascript|vbscript|data)\s*:/i.test(value) &&
          !(name === "src" && /^data:image\//i.test(value))) ||
        (URL_ATTRIBUTES.has(name) && WEB.test(value)) ||
        (name === "style" && WEB.test(value));
      if (drop) element.removeAttribute(attribute.name);
    }
  }
  for (const style of [...doc.querySelectorAll("style")])
    style.textContent = (style.textContent ?? "").replace(CSS_WEB, "");
  return `${doc.head.innerHTML}${doc.body.innerHTML}`;
}

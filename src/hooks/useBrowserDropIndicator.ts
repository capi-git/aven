import { useEffect, type RefObject } from "react";
import {
  browserBounds,
  nativeBrowser,
  type BrowserBounds,
  type BrowserDropIndicator,
  type BrowserDropColor,
  type BrowserDropPalette,
} from "../lib/browser";

export const WORKSPACE_DROP_FEEDBACK = "supermono:workspace-drop-feedback";

/** The hint forces color-mix(in srgb), so WebKit resolves these to either
 * color(srgb ...) or legacy rgb/rgba. No arbitrary CSS crosses native IPC. */
export function parseDropColor(value: string): BrowserDropColor | null {
  const match = /^(color\(srgb\s+|rgba?\()(.*)\)$/i.exec(value.trim());
  if (!match) return null;
  const srgb = match[1].toLowerCase().startsWith("color");
  const parts = match[2].trim().split(/[\s,/]+/);
  if (parts.length !== 3 && parts.length !== 4) return null;
  const channels = parts.map((part, index) => {
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?%?$/i.test(part)) return NaN;
    const percentage = part.endsWith("%");
    const number = Number(percentage ? part.slice(0, -1) : part);
    return number / (percentage ? 100 : index < 3 && !srgb ? 255 : 1);
  });
  if (!channels.every(Number.isFinite)) return null;
  if (channels.length === 3) channels.push(1);
  // CSS permits out-of-gamut colors. Clip when converting to the sRGB native view.
  return channels.map((channel) =>
    Math.max(0, Math.min(1, channel)),
  ) as BrowserDropColor;
}

export function readDropPalette(
  hint: HTMLElement,
): BrowserDropPalette | undefined {
  const style = getComputedStyle(hint);
  const stroke = parseDropColor(style.borderTopColor);
  const fill = parseDropColor(style.backgroundColor);
  const halo = parseDropColor(style.outlineColor);
  return stroke && fill && halo ? { stroke, fill, halo } : undefined;
}

/** Fractions of the full native viewport; no Retina/UI-zoom conversion needed. */
export function normalizeDropIndicator(
  viewport: BrowserBounds,
  rect: Pick<DOMRect, "left" | "top" | "right" | "bottom">,
  details: Pick<BrowserDropIndicator, "edge" | "kind" | "title" | "palette">,
): BrowserDropIndicator | null {
  if (
    ![
      viewport.x,
      viewport.y,
      viewport.width,
      viewport.height,
      rect.left,
      rect.top,
      rect.right,
      rect.bottom,
    ].every(Number.isFinite) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  )
    return null;
  const x = Math.max(0, Math.min(1, (rect.left - viewport.x) / viewport.width));
  const y = Math.max(0, Math.min(1, (rect.top - viewport.y) / viewport.height));
  const right = Math.max(
    0,
    Math.min(1, (rect.right - viewport.x) / viewport.width),
  );
  const bottom = Math.max(
    0,
    Math.min(1, (rect.bottom - viewport.y) / viewport.height),
  );
  if (right <= x || bottom <= y) return null;
  return {
    ...details,
    title: details.title.slice(0, 160).replace(/[\uD800-\uDBFF]$/, ""),
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

type Presentation = {
  owner: symbol | null;
  desired: BrowserDropIndicator | null;
  desiredKey: string;
  sentKey: string;
  running: boolean;
  present: (value: BrowserDropIndicator | null) => Promise<void>;
};
const presentations = new Map<string | symbol, Presentation>();
let generation = 0;

/** Serialize across remounts as well as pointer bursts. An old owner's clear
 * must never arrive after a new owner's show for the same native page. */
export function createDropIndicatorPresenter(
  present: Presentation["present"],
  id: string | symbol = Symbol(),
) {
  const owner = Symbol();
  const ownerGeneration = ++generation;
  let state = presentations.get(id);
  if (!state) {
    state = {
      owner,
      present,
      desired: null,
      desiredKey: "null",
      sentKey: "null",
      running: false,
    };
    presentations.set(id, state);
  }
  const slot = state;
  slot.owner = owner;
  slot.present = present;
  const cleanup = () => {
    if (
      !slot.owner &&
      !slot.running &&
      slot.sentKey === "null" &&
      presentations.get(id) === slot
    )
      presentations.delete(id);
  };
  const pump = async () => {
    if (slot.running) return;
    slot.running = true;
    try {
      while (slot.sentKey !== slot.desiredKey) {
        const value = slot.desired;
        slot.sentKey = slot.desiredKey;
        try {
          await slot.present(value);
        } catch {
          /* Closed/transferred pages need no indicator. */
        }
      }
    } finally {
      slot.running = false;
      cleanup();
    }
  };
  const update = (value: BrowserDropIndicator | null) => {
    slot.desired = value;
    // A new visible owner must restore even identical geometry after native
    // hide/reparent cleared it. Null is shared to avoid idle clear requests.
    slot.desiredKey = value
      ? `${ownerGeneration}:${JSON.stringify(value)}`
      : "null";
    void pump();
  };
  return {
    update: (value: BrowserDropIndicator | null) => {
      if (slot.owner === owner) update(value);
    },
    dispose: () => {
      if (slot.owner !== owner) return;
      slot.owner = null;
      update(null);
    },
  };
}

export function useBrowserDropIndicator(
  host: RefObject<HTMLElement | null>,
  id: string | null,
  enabled: boolean,
) {
  useEffect(() => {
    const viewport = host.current;
    if (!id || !enabled || !viewport) return;
    const stage = viewport.closest("[data-workspace-stage]");
    if (!stage) return;
    const presenter = createDropIndicatorPresenter(
      (value) => nativeBrowser.dropIndicator(id, value),
      id,
    );
    let palette: BrowserDropPalette | undefined;
    let paletteDirty = true;
    const refresh = (event?: Event) => {
      if (event?.type === WORKSPACE_DROP_FEEDBACK && event.target !== stage)
        return;
      if (event instanceof CustomEvent && event.detail?.clear) {
        paletteDirty = true;
        presenter.update(null);
        return;
      }
      const body = viewport.closest("[data-workspace-body]");
      const hint = body?.querySelector<HTMLElement>(
        "[data-workspace-drop-hint]",
      );
      const bounds = browserBounds(viewport);
      if (
        !hint ||
        !bounds ||
        viewport.closest('[hidden], [inert], [aria-hidden="true"]')
      ) {
        paletteDirty = true;
        presenter.update(null);
        return;
      }
      if (paletteDirty) {
        palette = readDropPalette(hint);
        paletteDirty = false;
      }
      presenter.update(
        normalizeDropIndicator(bounds, hint.getBoundingClientRect(), {
          edge: hint.dataset.dropEdge as BrowserDropIndicator["edge"],
          kind: hint.dataset.dropKind as BrowserDropIndicator["kind"],
          title: hint.dataset.dropTitle ?? "",
          ...(palette ? { palette } : {}),
        }),
      );
    };
    // Palette reads are independent of pointer/destination changes. A theme
    // edit during a drag repaints even when the target geometry is unchanged.
    const themeChanged = () => {
      paletteDirty = true;
      refresh();
    };
    const observer = new MutationObserver(themeChanged);
    const attributes = {
      attributes: true,
      attributeFilter: ["class", "style"],
    };
    observer.observe(document.documentElement, attributes);
    const shell = viewport.closest(".personal-shell");
    if (shell) observer.observe(shell, attributes);
    window.addEventListener(WORKSPACE_DROP_FEEDBACK, refresh);
    window.addEventListener("supermono:workspace-layout", refresh);
    window.addEventListener("resize", refresh);
    window.addEventListener("monocode:uiscalechange", refresh);
    refresh();
    return () => {
      window.removeEventListener(WORKSPACE_DROP_FEEDBACK, refresh);
      window.removeEventListener("supermono:workspace-layout", refresh);
      window.removeEventListener("resize", refresh);
      window.removeEventListener("monocode:uiscalechange", refresh);
      observer.disconnect();
      presenter.dispose();
    };
  }, [host, id, enabled]);
}

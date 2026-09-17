import { useEffect, type RefObject } from "react";
import {
  browserBounds,
  nativeBrowser,
  type BrowserBounds,
  type BrowserDropIndicator,
} from "../lib/browser";

export const WORKSPACE_DROP_FEEDBACK = "supermono:workspace-drop-feedback";

/** Fractions of the full native viewport; no Retina/UI-zoom conversion needed. */
export function normalizeDropIndicator(
  viewport: BrowserBounds,
  rect: Pick<DOMRect, "left" | "top" | "right" | "bottom">,
  details: Pick<BrowserDropIndicator, "edge" | "kind" | "title">,
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
    const refresh = (event?: Event) => {
      if (event?.type === WORKSPACE_DROP_FEEDBACK && event.target !== stage)
        return;
      if (event instanceof CustomEvent && event.detail?.clear) {
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
        presenter.update(null);
        return;
      }
      presenter.update(
        normalizeDropIndicator(bounds, hint.getBoundingClientRect(), {
          edge: hint.dataset.dropEdge as BrowserDropIndicator["edge"],
          kind: hint.dataset.dropKind as BrowserDropIndicator["kind"],
          title: hint.dataset.dropTitle ?? "",
        }),
      );
    };
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
      presenter.dispose();
    };
  }, [host, id, enabled]);
}

import { X } from "./icons";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { LAYER } from "../lib/layers";
import "./Overlays.css";

export type ModalSize = "sm" | "md";

const WIDTH: Record<ModalSize, string> = {
  sm: "w-[min(420px,calc(100vw-24px))]",
  md: "w-[min(560px,calc(100vw-24px))]",
};

const TOP: Record<ModalSize, string> = {
  sm: "top-[22%]",
  md: "top-[10%]",
};

const MODAL_SELECTOR =
  '.modal-panel[role="dialog"], [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]';
const FOCUSABLE_SELECTOR =
  'button, input:not([type="hidden"]), select, textarea, a[href], summary, [tabindex]';

/** Checking the ancestor chain also excludes collapsed sections and fields
 * inside a hidden wrapper, which can have visible styles of their own. */
function isVisible(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  for (
    let node: HTMLElement | null = element;
    node;
    node = node.parentElement
  ) {
    if (
      node.hidden ||
      node.hasAttribute("inert") ||
      node.getAttribute("aria-hidden") === "true"
    )
      return false;
    const style = getComputedStyle(node);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.contentVisibility === "hidden"
    )
      return false;
    if (node instanceof HTMLDetailsElement && !node.open) {
      const summary = node.querySelector(":scope > summary");
      if (!summary?.contains(element)) return false;
    }
  }
  return true;
}

function topModal(): HTMLElement | undefined {
  const dialogs = [
    ...document.querySelectorAll<HTMLElement>(MODAL_SELECTOR),
  ].filter(isVisible);
  return dialogs[dialogs.length - 1];
}

function isDisabled(element: HTMLElement): boolean {
  if (element.matches(":disabled")) return true;
  for (
    let fieldset = element.closest<HTMLFieldSetElement>("fieldset[disabled]");
    fieldset;
    fieldset =
      fieldset.parentElement?.closest<HTMLFieldSetElement>(
        "fieldset[disabled]",
      ) ?? null
  ) {
    // The first legend remains interactive in a disabled fieldset.
    if (!fieldset.querySelector(":scope > legend")?.contains(element))
      return true;
  }
  return false;
}

function focusableWithin(roots: HTMLElement[]): HTMLElement[] {
  return (
    [
      ...new Set(
        roots.flatMap((root) => [
          ...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        ]),
      ),
    ]
      .filter(
        (element) =>
          element.tabIndex >= 0 && !isDisabled(element) && isVisible(element),
      )
      // Positive tabindex values precede ordinary controls in browser tab order.
      .sort((a, b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity))
  );
}

function popoverRoot(element: Element): HTMLElement | null {
  let root = element.closest<HTMLElement>("[data-popover-side]");
  let outer = root?.parentElement?.closest<HTMLElement>("[data-popover-side]");
  while (outer) {
    root = outer;
    outer = outer.parentElement?.closest<HTMLElement>("[data-popover-side]");
  }
  return root;
}

type Props = {
  onClose: () => void;
  title: string;
  description?: string;
  size?: ModalSize;
  /** Extra classes on the panel (fixed height, etc). */
  className?: string;
  children: ReactNode;
};

export function ModalPanel({
  onClose,
  title,
  description,
  size = "md",
  className,
  children,
}: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef(
    typeof document === "undefined" ? null : document.activeElement,
  );
  const popoversRef = useRef(new Set<HTMLElement>());
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const uid = useId();
  const titleId = `${uid}-title`;
  const descriptionId = description ? `${uid}-desc` : undefined;

  useEffect(() => {
    const panel = panelRef.current;
    const previous = openerRef.current;
    const popovers = popoversRef.current;
    if (
      panel &&
      topModal() === panel &&
      !panel.contains(document.activeElement)
    )
      closeRef.current?.focus();
    return () => {
      const active = document.activeElement;
      const ownedFocus =
        active === document.body ||
        panel?.contains(active) ||
        [...popovers].some((popover) => popover.contains(active));
      // Removing a background dialog must not steal focus from a newer one.
      if (
        ownedFocus &&
        previous instanceof HTMLElement &&
        isVisible(previous) &&
        !isDisabled(previous)
      )
        previous.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const panel = panelRef.current;
      if (!panel || topModal() !== panel) return;
      const popovers = [...popoversRef.current].filter(isVisible);
      if (event.key === "Escape") {
        // An anchored menu dismisses itself before its parent dialog.
        if (popovers.length) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      } else if (event.key === "Tab") {
        const focusable = focusableWithin([panel, ...popovers]);
        if (!focusable.length) return;
        const index = focusable.indexOf(document.activeElement as HTMLElement);
        const next =
          index < 0
            ? event.shiftKey
              ? focusable.length - 1
              : 0
            : (index + (event.shiftKey ? -1 : 1) + focusable.length) %
              focusable.length;
        event.preventDefault();
        focusable[next].focus({ preventScroll: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className={`absolute left-1/2 ${TOP[size]} ${WIDTH[size]} -translate-x-1/2`}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onFocusCapture={(event) => {
          // React focus events retain their ancestry across portals. Associate
          // a picker with this dialog without admitting unrelated app menus.
          const popover = popoverRoot(event.target);
          if (popover) popoversRef.current.add(popover);
          for (const known of popoversRef.current) {
            if (!known.isConnected) popoversRef.current.delete(known);
          }
        }}
        onMouseDown={(event) => event.stopPropagation()}
        className={`modal-panel flex flex-col overflow-hidden rounded-2xl ${className ?? ""}`}
      >
        <header className="flex shrink-0 items-start gap-2 px-4 pt-3">
          <div className="min-w-0 flex-1 pt-0.5">
            <h2
              id={titleId}
              className="text-2xl font-semibold leading-tight text-content"
            >
              {title}
            </h2>
            {description ? (
              <p
                id={descriptionId}
                className="mt-1 text-[12px] leading-relaxed text-content/65"
              >
                {description}
              </p>
            ) : null}
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid size-7 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/8 hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="size-3.5" strokeWidth={1.75} />
          </button>
        </header>
        <div
          ref={lockOverscroll}
          className="min-h-0 flex-1 overflow-y-auto overscroll-none"
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function Modal(props: Props) {
  return createPortal(
    <div className="fixed inset-0" style={{ zIndex: LAYER.dialog }}>
      <div
        className="modal-backdrop absolute inset-0 bg-black/40"
        onMouseDown={props.onClose}
      />
      <ModalPanel {...props} />
    </div>,
    document.body,
  );
}

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  browserMarkupAttachment,
  nativeBrowser,
  type BrowserPageCapture,
} from "../lib/browser";
import type { MarkupPng } from "../lib/browserMarkup";
import type { BrowserPresentation } from "../lib/browserPresentation";
import { errorText } from "../lib/errors";
import type { Attachment } from "../lib/session";

export type BrowserMarkupImage = { src: string; width: number; height: number };

export type BrowserMarkupState =
  | { phase: "capturing"; token: number }
  | {
      phase: "active";
      token: number;
      image: BrowserMarkupImage;
      /** The page is hidden behind the picture; the tools may open. */
      ready: boolean;
      /** Closing: the picture stays until the live page is back over it. */
      leaving: boolean;
    };

function usableCapture(capture: BrowserPageCapture | null | undefined) {
  return (
    !!capture &&
    typeof capture.dataUrl === "string" &&
    capture.dataUrl.startsWith("data:image/png;base64,") &&
    Number.isFinite(capture.width) &&
    capture.width > 0 &&
    Number.isFinite(capture.height) &&
    capture.height > 0
  );
}

/**
 * Mark up: freeze one browser page behind a lossless picture of it, let the
 * person draw on that, and hand the result to the chat beside the page.
 *
 * Nothing runs until `start`. Hiding the pane, an error, a new address or a
 * replaced page all leave markup, and the live page returns.
 */
export function useBrowserMarkup({
  pageId,
  presentation,
  visible,
  error,
  url,
  snapshotSrc,
  onNotice,
  onAddToChat,
}: {
  pageId: string | null;
  presentation: RefObject<BrowserPresentation | null>;
  visible: boolean;
  error: string | null;
  url: string;
  /** The still image currently covering the pane, if any. */
  snapshotSrc: string | null;
  onNotice: (notice: string) => void;
  onAddToChat?: (text: string, attachments?: Attachment[]) => void;
}) {
  const [state, setState] = useState<BrowserMarkupState | null>(null);
  const current = useRef(state);
  current.current = state;
  const token = useRef(0);
  const latest = useRef({ pageId, onNotice, onAddToChat });
  latest.current = { pageId, onNotice, onAddToChat };

  const leave = useCallback(() => {
    const markup = current.current;
    if (!markup) return;
    ++token.current;
    presentation.current?.thaw();
    const next =
      markup.phase === "active" && markup.ready && !markup.leaving
        ? { ...markup, leaving: true }
        : markup.phase === "active" && markup.leaving
          ? markup
          : null;
    current.current = next;
    setState(next);
  }, [presentation]);

  const start = useCallback(() => {
    const page = latest.current.pageId;
    if (!page || current.current) return;
    const mine = ++token.current;
    const capturing = { phase: "capturing" as const, token: mine };
    current.current = capturing;
    setState(capturing);
    const fail = (notice: string) => {
      if (mine !== token.current) return;
      ++token.current;
      presentation.current?.thaw();
      current.current = null;
      setState(null);
      latest.current.onNotice(notice);
    };
    void (async () => {
      let capture: BrowserPageCapture;
      try {
        capture = await nativeBrowser.capture(page);
      } catch (reason) {
        fail(errorText(reason));
        return;
      }
      if (mine !== token.current) return;
      if (!usableCapture(capture)) {
        fail("Could not capture this page. Try again.");
        return;
      }
      const active = {
        phase: "active" as const,
        token: mine,
        image: {
          src: capture.dataUrl,
          width: capture.width,
          height: capture.height,
        },
        ready: false,
        leaving: false,
      };
      current.current = active;
      // Commit markup before the picture arrives, so the pane hands it to
      // the markup layer instead of decoding a plain cover first.
      flushSync(() => setState(active));
      const frozen =
        (await presentation.current?.freeze(capture.dataUrl)) ?? false;
      if (mine !== token.current) return;
      if (!frozen) {
        fail("Could not hold the page still for marking up. Try again.");
        return;
      }
      const ready = { ...active, ready: true };
      current.current = ready;
      setState(ready);
    })();
  }, [presentation]);

  const send = useCallback(
    async (render: () => Promise<MarkupPng>) => {
      const markup = current.current;
      if (markup?.phase !== "active" || !markup.ready || markup.leaving) return;
      const mine = markup.token;
      let attachment: Attachment;
      try {
        attachment = await browserMarkupAttachment(await render());
      } catch (reason) {
        if (mine === token.current)
          latest.current.onNotice(
            `Could not attach the marked-up page: ${errorText(reason)}`,
          );
        return;
      }
      if (mine !== token.current) return;
      leave();
      // Into the draft beside the page; the person says what to change.
      latest.current.onAddToChat?.("", [attachment]);
    },
    [leave],
  );

  // A hidden pane, a failed page or a new address ends markup. Back and
  // forward land here through the address.
  const previousUrl = useRef(url);
  useEffect(() => {
    const navigated = previousUrl.current !== url;
    previousUrl.current = url;
    if (!visible || error || navigated) leave();
  }, [visible, error, url, leave]);

  // A replaced or closed page takes its presentation with it.
  useEffect(
    () => () => {
      ++token.current;
      current.current = null;
      setState(null);
    },
    [pageId],
  );

  // Once the frozen picture no longer covers the pane (the live page is
  // back, or the pane let it go), markup is over.
  const ready = state?.phase === "active" && state.ready;
  const frozenSrc = state?.phase === "active" ? state.image.src : null;
  useEffect(() => {
    if (!ready || snapshotSrc === frozenSrc) return;
    ++token.current;
    presentation.current?.thaw();
    current.current = null;
    setState(null);
  }, [ready, snapshotSrc, frozenSrc, presentation]);

  // Keys belong to the markup layer: move native focus off the hidden page.
  const leaving = state?.phase === "active" && state.leaving;
  useEffect(() => {
    if (!ready || leaving || !isTauri()) return;
    void getCurrentWebview()
      .setFocus()
      .catch(() => {});
  }, [ready, leaving]);

  return {
    state,
    /** Marking up, from pressing the button until the tools close. */
    active: !!state && !(state.phase === "active" && state.leaving),
    busy: state?.phase === "capturing" || leaving,
    start,
    leave,
    send,
  };
}

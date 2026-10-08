import "./BrowserOrbWindow.css";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  BROWSER_ORB_STATE_EVENT,
  browserOrbWindow,
  type BrowserOrbAction,
  type BrowserOrbSnapshot,
  type BrowserOrbState,
} from "../lib/browserOrb";

const CLOSED_WIDTH = 60;
const OPEN_WIDTH = 600;
const CARD_WIDTH = 500;

/** Plain glass with a passing glint; a ring turns while the chat works. */
function BubbleGlass() {
  return (
    <>
      <span className="orb-glint" aria-hidden="true" />
      <svg className="orb-ring" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="7.5" />
      </svg>
    </>
  );
}

const CloseIcon = () => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
  </svg>
);

/**
 * The Aven bubble over a web page. The workspace owns the chat; this window
 * only shows what it is sent and asks the workspace to send or stop.
 */
export function BrowserOrbWindow() {
  const [snapshot, setSnapshot] = useState<BrowserOrbSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [dismissedAnswer, setDismissedAnswer] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const stack = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const readySent = useRef(false);

  useEffect(() => {
    let disposed = false;
    let received = false;
    let stop: (() => void) | undefined;
    let revision = 0;
    const accept = (next: BrowserOrbState) => {
      if (disposed || next.revision < revision) return;
      revision = next.revision;
      setSnapshot(next.snapshot);
    };
    void (async () => {
      const unsubscribe = await browserOrbWindow.listen<BrowserOrbState>(
        BROWSER_ORB_STATE_EVENT,
        (next) => {
          received = true;
          accept(next);
        },
      );
      if (disposed) {
        unsubscribe();
        return;
      }
      stop = unsubscribe;
      const initial = await browserOrbWindow.getState();
      if (!received) accept(initial);
    })().catch(() => {});
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);

  useLayoutEffect(() => {
    document.documentElement.classList.add("browser-orb-window");
    document.getElementById("boot-splash")?.remove();
  }, []);

  const answer =
    snapshot?.answer && snapshot.answer.id !== dismissedAnswer
      ? snapshot.answer
      : null;
  const busy = Boolean(snapshot?.busy);
  const chat = snapshot?.chat ?? null;

  // Size the window to what is showing; it grows upwards from the bubble.
  useLayoutEffect(() => {
    const element = stack.current;
    if (!element || !snapshot) return;
    const width = open ? OPEN_WIDTH : answer ? CARD_WIDTH : CLOSED_WIDTH;
    const send = () =>
      void browserOrbWindow
        .layout(width, Math.ceil(element.offsetHeight), open)
        .then(() => {
          if (open) input.current?.focus();
          if (!readySent.current) {
            readySent.current = true;
            return browserOrbWindow.ready();
          }
        })
        .catch(() => {});
    send();
    const observer = new ResizeObserver(send);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open, answer?.id, Boolean(snapshot)]);

  // Clicking back on the page closes an empty pill.
  useEffect(() => {
    if (!open) return;
    const blur = () => {
      if (!input.current?.value.trim()) setOpen(false);
    };
    window.addEventListener("blur", blur);
    return () => window.removeEventListener("blur", blur);
  }, [open]);

  const act = (action: BrowserOrbAction) => {
    setFailed(false);
    void browserOrbWindow.act(action).catch(() => setFailed(true));
  };

  // The workspace forgets a dismissed answer too, so it cannot come back
  // when the bubble is shown again.
  const dismiss = (id: string) => {
    setDismissedAnswer(id);
    void browserOrbWindow.act({ action: "dismiss" }).catch(() => {});
  };

  const close = () => {
    setText("");
    setOpen(false);
  };

  const submit = () => {
    const message = text.trim();
    if (!message || !chat || busy) return;
    if (answer) setDismissedAnswer(answer.id);
    act({ action: "submit", text: message });
    setText("");
    setOpen(false);
  };

  if (!snapshot) return null;

  const placeholder = !chat
    ? "Open a chat in this workspace to ask"
    : failed
      ? "Couldn't send. Try again"
      : `Ask ${chat.agent} about this page…`;

  return (
    <div
      ref={stack}
      className={`orb-stack${busy ? " is-busy" : ""}`}
      data-tint={snapshot.tint ? "" : undefined}
      style={
        (snapshot.tint ? { "--orb-tint": snapshot.tint } : undefined) as
          CSSProperties | undefined
      }
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          if (open) close();
          else if (answer) dismiss(answer.id);
        }
      }}
    >
      {answer && !open ? (
        <section className="orb-card" aria-label="Answer" aria-live="polite">
          <div className="orb-card-head">
            <span>{chat ? `${chat.agent} · ${chat.title}` : "Answer"}</span>
            <button
              type="button"
              className="orb-icon-button"
              aria-label="Dismiss"
              title="Dismiss"
              onClick={() => dismiss(answer.id)}
            >
              <CloseIcon />
            </button>
          </div>
          <p className="orb-card-text">{answer.text}</p>
          <div className="orb-card-actions">
            <button
              type="button"
              className="orb-chip orb-primary"
              onClick={() => {
                dismiss(answer.id);
                setOpen(true);
              }}
            >
              Reply
            </button>
            <button
              type="button"
              className="orb-chip"
              onClick={() => {
                dismiss(answer.id);
                act({ action: "openChat" });
              }}
            >
              Open chat
            </button>
          </div>
        </section>
      ) : null}
      {open ? (
        <form
          className="orb-pill"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <span className="orb-bubble" aria-hidden="true">
            <BubbleGlass />
          </span>
          <input
            ref={input}
            className="orb-input"
            aria-label="Message"
            placeholder={placeholder}
            value={text}
            disabled={!chat}
            maxLength={20_000}
            onChange={(event) => {
              setFailed(false);
              setText(event.target.value);
            }}
          />
          {chat ? (
            <button
              type="button"
              className="orb-chip"
              title={`Messages go to “${chat.title}”. Click to open it.`}
              onClick={() => act({ action: "openChat" })}
            >
              <span>{chat.title}</span>
            </button>
          ) : null}
          {busy ? (
            <button
              type="button"
              className="orb-icon-button orb-send"
              aria-label="Stop"
              title="Stop"
              onClick={() => act({ action: "stop" })}
            >
              <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" />
              </svg>
            </button>
          ) : (
            <button
              type="submit"
              className="orb-icon-button orb-send"
              aria-label="Send"
              title="Send"
              disabled={!chat || !text.trim()}
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
              </svg>
            </button>
          )}
          <span className="orb-divider" />
          <button
            type="button"
            className="orb-icon-button"
            aria-label="Close"
            title="Close (Esc)"
            onClick={close}
          >
            <CloseIcon />
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="orb-bubble"
          aria-label={
            busy ? "Aven is working. Open" : "Ask Aven about this page"
          }
          title={busy ? "Working…" : "Ask about this page"}
          onClick={() => setOpen(true)}
        >
          <BubbleGlass />
        </button>
      )}
    </div>
  );
}

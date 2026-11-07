import {
  useLayoutEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  cascadeCardSize,
  cascadeDepth,
  cascadePlace,
} from "../lib/recentSurfaces";
import type { RecentSwitcherState } from "../hooks/useRecentSwitcher";
import "./RecentSwitcher.css";

/** What a card shows of a strip entry. */
export type RecentPreview =
  | {
      kind: "chat";
      /** The last few turns, oldest first. */
      lines: { role: "user" | "assistant"; text: string }[];
    }
  | { kind: "page"; image?: string; icon: ReactNode }
  | { kind: "panes"; panes: { id: string; title: string; mark: ReactNode }[] }
  | { kind: "plain"; icon: ReactNode; detail?: string };

export type RecentCard = {
  key: string;
  title: string;
  /** A short second line: a page's site, a split's panes. */
  meta?: string;
  mark: ReactNode;
  status?: "needs" | "working";
  preview: RecentPreview;
};

type Props = {
  state: RecentSwitcherState;
  cards: RecentCard[];
  /** Click a card: open it. */
  onChoose: (index: number) => void;
  onCancel: () => void;
};

type Box = { left: number; top: number; width: number; height: number };

/** Where the picked card lands: the workspace's content. */
function workspaceBox(): Box {
  const el = document.querySelector(".personal-workspace-content");
  const rect = el?.getBoundingClientRect();
  if (rect && rect.width > 0 && rect.height > 0)
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  return {
    left: 0,
    top: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

/**
 * The recent switcher, as a cascade: the window blurs behind a stack of
 * cards, the picked one in front and the ones used before it stepping back
 * up and to the right. Each ⇥ sends the front card off toward you and
 * brings the next forward. Letting go grows the picked card into the
 * workspace as the blur clears.
 */
export function RecentSwitcher({ state, cards, onChoose, onCancel }: Props) {
  const [frame, setFrame] = useState(() => ({
    viewport: { width: window.innerWidth, height: window.innerHeight },
    target: workspaceBox(),
  }));
  // Cards start a little low and clear, then settle into the stack.
  const [entered, setEntered] = useState(false);
  useLayoutEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    const onResize = () =>
      setFrame({
        viewport: { width: window.innerWidth, height: window.innerHeight },
        target: workspaceBox(),
      });
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const { viewport, target } = frame;
  const card = cascadeCardSize(viewport, target.width / target.height);
  const originX = Math.round(
    (viewport.width - card.width) / 2 - card.width * 0.08,
  );
  const originY = Math.round(
    (viewport.height - card.height) / 2 + card.height * 0.1,
  );
  const count = cards.length;
  const picked = cards[state.picked];
  const opening = state.phase === "opening";
  const landScale = target.width / card.width;
  const landTop = target.top + (target.height - card.height * landScale) / 2;

  return createPortal(
    <div
      className="aven-recent"
      data-phase={state.phase}
      data-entered={entered || undefined}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="aven-recent-scrim" aria-hidden />
      <div
        className="aven-recent-stack"
        role="listbox"
        aria-label="Recent"
        aria-activedescendant={picked ? `aven-recent-${state.picked}` : ""}
      >
        {cards.map((item, index) => {
          const depth = cascadeDepth(index, state.picked, count);
          const place = cascadePlace(depth, count, card);
          const isPicked = index === state.picked;
          let transform = `translate3d(${originX + place.x}px, ${
            originY + place.y + (entered ? 0 : card.height * 0.12)
          }px, ${place.z}px)`;
          // Cards further back are fainter sheets of the same glass.
          let opacity = entered ? place.opacity * (1 - place.dim) : 0;
          if (opening) {
            if (isPicked)
              transform = `translate3d(${target.left}px, ${landTop}px, 0px) scale(${landScale})`;
            else opacity = 0;
          }
          const style = {
            width: card.width,
            height: card.height,
            transform,
            opacity,
            zIndex: isPicked && opening ? 300 : place.zIndex,
            transitionDelay:
              entered || opening ? undefined : `${Math.min(depth, 4) * 18}ms`,
          } as CSSProperties;
          return (
            <div
              key={item.key}
              id={`aven-recent-${index}`}
              role="option"
              aria-selected={isPicked}
              aria-label={item.title}
              className="aven-recent-card"
              data-picked={isPicked || undefined}
              style={style}
              onClick={() => onChoose(index)}
            >
              <RecentFace preview={item.preview} status={item.status} />
            </div>
          );
        })}
      </div>
      {picked ? (
        <div
          className="aven-recent-name"
          style={{
            width: card.width,
            transform: `translate(${originX}px, ${
              originY + card.height + 14
            }px)`,
          }}
        >
          <div className="aven-recent-title">
            {picked.mark}
            <span>{picked.title}</span>
          </div>
          {picked.meta || picked.status ? (
            <div className="aven-recent-meta">
              {picked.meta ? <span>{picked.meta}</span> : null}
              {picked.status === "needs" ? (
                <span className="aven-recent-needs">Needs you</span>
              ) : picked.status === "working" ? (
                <span>Working</span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

function RecentFace({
  preview,
  status,
}: {
  preview: RecentPreview;
  status?: RecentCard["status"];
}) {
  if (preview.kind === "chat") {
    return (
      <div className="aven-recent-face" data-kind="chat">
        <div className="aven-recent-lines">
          {preview.lines.map((line, index) => (
            <p key={index} data-role={line.role}>
              {line.text}
            </p>
          ))}
        </div>
        {status ? (
          <div className="aven-recent-composer">
            {status === "needs" ? (
              <span className="aven-recent-needs">Needs you</span>
            ) : (
              <span>Working</span>
            )}
          </div>
        ) : null}
      </div>
    );
  }
  if (preview.kind === "page") {
    return (
      <div className="aven-recent-face" data-kind="page">
        {preview.image ? (
          <img src={preview.image} alt="" draggable={false} />
        ) : (
          <div className="aven-recent-plain">
            <span className="aven-recent-icon">{preview.icon}</span>
          </div>
        )}
      </div>
    );
  }
  if (preview.kind === "panes") {
    return (
      <div className="aven-recent-face" data-kind="panes">
        {preview.panes.map((pane) => (
          <div key={pane.id} className="aven-recent-pane">
            {pane.mark}
            <span>{pane.title}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="aven-recent-face" data-kind="plain">
      <div className="aven-recent-plain">
        <span className="aven-recent-icon">{preview.icon}</span>
        {preview.detail ? (
          <span className="aven-recent-detail">{preview.detail}</span>
        ) : null}
      </div>
    </div>
  );
}

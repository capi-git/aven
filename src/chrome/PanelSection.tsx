import { useId, type ReactNode } from "react";

/** A titled group inside the agent panel: Reasoning, Access and so on. */
export function PanelSection({
  title,
  note,
  children,
  ...rest
}: {
  title: ReactNode;
  /** One quiet line under the title. */
  note?: ReactNode;
  children: ReactNode;
} & Record<`data-${string}`, string | boolean | undefined>) {
  const id = useId();
  return (
    <section {...rest} aria-labelledby={id} className="agent-panel-section">
      <h3 id={id} className="agent-panel-heading">
        {title}
      </h3>
      {note ? <p className="agent-panel-note">{note}</p> : null}
      {children}
    </section>
  );
}

/**
 * Arrow keys, Home and End move focus between a group's enabled radios. The
 * choice itself waits for Enter, Space or a click, so passing over a value
 * never saves it.
 */
export function moveRadioFocus(event: {
  key: string;
  preventDefault: () => void;
  currentTarget: HTMLElement;
}) {
  const { key } = event;
  const back = key === "ArrowUp" || key === "ArrowLeft";
  const forward = key === "ArrowDown" || key === "ArrowRight";
  if (!back && !forward && key !== "Home" && key !== "End") return;
  const items = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(
      '[role="radio"]:not(:disabled)',
    ),
  ];
  if (items.length === 0) return;
  event.preventDefault();
  const index = items.indexOf(document.activeElement as HTMLElement);
  const next =
    key === "Home"
      ? 0
      : key === "End"
        ? items.length - 1
        : forward
          ? (index + 1) % items.length
          : index <= 0
            ? items.length - 1
            : index - 1;
  items[next]?.focus();
}

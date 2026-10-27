import { MessageSquarePlus } from "../chrome/icons";
import { useEffect, useRef } from "react";
import "../chrome/Menu.css";
import { Popover } from "../chrome/Popover";
import { type TranscriptSelection } from "../lib/transcriptSelection";

type Props = {
  selection: TranscriptSelection | null;
  onAddToChat: (text: string) => void;
  onDismiss: () => void;
};

export function TranscriptSelectionMenu({
  selection,
  onAddToChat,
  onDismiss,
}: Props) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  // Scrolling or resizing moves the text out from under the menu, so the
  // selection it acts on is gone; drop it rather than chase the range.
  useEffect(() => {
    if (!selection) return;
    const dismiss = () => onDismissRef.current();
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [selection]);

  if (!selection) return null;

  return (
    <Popover
      anchor={selection.rect}
      side="top"
      align="center"
      onDismiss={(reason) => {
        if (reason === "escape") window.getSelection()?.removeAllRanges();
        onDismiss();
      }}
      role="toolbar"
      aria-label="Selected text actions"
      className="aven-menu"
    >
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          onAddToChat(selection.text);
          window.getSelection()?.removeAllRanges();
          onDismiss();
        }}
        className="aven-menu-item font-sans"
      >
        <span aria-hidden="true" className="aven-menu-icon">
          <MessageSquarePlus strokeWidth={1.75} />
        </span>
        <span className="aven-menu-label">Add to chat</span>
      </button>
    </Popover>
  );
}

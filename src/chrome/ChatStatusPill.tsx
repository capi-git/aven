import { memo } from "react";
import {
  CHAT_STATUS_LABEL,
  chatStage,
  chatStatusHint,
  type ChatStatusWord,
} from "../lib/chatStatus";
import "./ChatStatusPill.css";

/**
 * A chat's one-word status as a small pill: Needs you, Working (or its
 * team's word), Review or Shipped. `data-stage` picks its tone and
 * `data-word` names the word, for styles and motion to hook into. A
 * working chat's tooltip says what holds it up, when something does.
 */
export const ChatStatusPill = memo(function ChatStatusPill({
  word,
  holdUp,
  className = "",
}: {
  word: ChatStatusWord;
  holdUp?: string;
  className?: string;
}) {
  const label = CHAT_STATUS_LABEL[word];
  return (
    <span
      className={`aven-chat-status ${className}`}
      data-chat-status={word}
      data-stage={chatStage(word)}
      title={chatStatusHint(word, holdUp)}
    >
      {label}
    </span>
  );
});

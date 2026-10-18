import { memo } from "react";
import {
  CHAT_STATUS_HINT,
  CHAT_STATUS_LABEL,
  chatStage,
  type ChatStatusWord,
} from "../lib/chatStatus";
import "./ChatStatusPill.css";

/**
 * A chat's one-word status as a small pill: Needs you, Working (or its
 * team's word), Review or Shipped. `data-stage` picks its tone and
 * `data-word` names the word, for styles and motion to hook into.
 */
export const ChatStatusPill = memo(function ChatStatusPill({
  word,
  className = "",
}: {
  word: ChatStatusWord;
  className?: string;
}) {
  const label = CHAT_STATUS_LABEL[word];
  return (
    <span
      className={`aven-chat-status ${className}`}
      data-chat-status={word}
      data-stage={chatStage(word)}
      title={CHAT_STATUS_HINT[word]}
    >
      {label}
    </span>
  );
});

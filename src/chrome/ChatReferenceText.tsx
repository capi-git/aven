import { memo, useMemo } from "react";
import { chatReferenceParts } from "../lib/chatReferences";
import { openInAppFile } from "../lib/inAppLinks";

export const ChatReferenceText = memo(function ChatReferenceText({
  text,
  cwd,
  interactive = false,
}: {
  text: string;
  cwd?: string;
  interactive?: boolean;
}) {
  const parts = useMemo(() => chatReferenceParts(text, cwd), [text, cwd]);
  return (
    <>
      {parts.map((part, index) =>
        !part.href ? (
          part.text
        ) : interactive ? (
          <a
            key={index}
            className="chat-reference"
            href={part.href}
            onClick={
              part.file
                ? (event) => {
                    event.preventDefault();
                    openInAppFile(part.file!.path, part.file!.navigation);
                  }
                : undefined
            }
            onAuxClick={
              part.file
                ? (event) => {
                    if (event.button !== 1) return;
                    event.preventDefault();
                    openInAppFile(part.file!.path, part.file!.navigation);
                  }
                : undefined
            }
          >
            {part.text}
          </a>
        ) : (
          <span key={index} className="chat-reference">
            {part.text}
          </span>
        ),
      )}
    </>
  );
});

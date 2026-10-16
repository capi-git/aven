import type { BuiltinSkill } from "./skills";

/** `/discuss`: turns on the composer's Discuss mode; the rest is the topic. */
export const DISCUSS_COMMAND: BuiltinSkill = {
  kind: "builtin",
  name: "discuss",
  invocation: "discuss",
  description:
    "Turn on Discuss mode: talk your message through with another chat.",
  scope: "builtin",
  source: "monocode",
};

/** Consume a leading `/discuss`; the rest of the message is the topic. */
export function consumeDiscussCommand(text: string): {
  topic: string;
  matched: boolean;
} {
  const match = text.match(/^\s*\/discuss(?=\s|$)\s*/i);
  if (!match) return { topic: text, matched: false };
  return { topic: text.slice(match[0].length).trim(), matched: true };
}

import type { BuiltinSkill } from "./skills";

/** `/discuss`: the slash form of the composer's Discuss with… choice. */
export const DISCUSS_COMMAND: BuiltinSkill = {
  kind: "builtin",
  name: "discuss",
  invocation: "discuss",
  description: "Have this chat discuss a topic with another chat.",
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

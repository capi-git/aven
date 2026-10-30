import { botName, useProjectBot } from "../lib/projectBots";

/** A project bot's name: the one you gave it, or "Fixer". */
export function useProjectBotName(
  path: string | undefined,
): string | undefined {
  const bot = useProjectBot(path);
  return path ? botName(bot ?? {}) : undefined;
}

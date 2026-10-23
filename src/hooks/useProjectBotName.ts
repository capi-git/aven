import { botName, useProjectBot } from "../lib/projectBots";
import { useProjectAppearance } from "./useProjectAppearance";

/** A project bot's name: the one you gave it, or its critter's. */
export function useProjectBotName(
  path: string | undefined,
): string | undefined {
  const bot = useProjectBot(path);
  const appearance = useProjectAppearance(path);
  return path ? botName(bot ?? { path }, appearance?.mascot) : undefined;
}

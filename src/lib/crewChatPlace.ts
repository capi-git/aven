import { crewMemberApp, type Crew, type CrewMember } from "./crews";
import { botChatInCopy, type BotChatShape } from "./projectBots";

/**
 * Where a helper's chat may run its next turn, and how to put it there.
 * Every helper works only in the project's copy. Avos (the Lead) reads your
 * own folder until there's a copy, which a project without Git never has,
 * and every new Avos starts without one: so its chat runs in your folder
 * then, and moves into the copy once there is one.
 *
 * Returns why it can't run now, null when the chat is where it belongs, or
 * the chat moved (`restart`: its agent starts a new conversation there).
 */
export function crewChatPlace<T extends BotChatShape>(
  chat: T,
  crew: Pick<Crew, "on" | "copy">,
  member: Pick<CrewMember, "role" | "harness" | "model" | "fallback">,
  claudeModel: () => string,
  modelFor: (harness: string) => string = claudeModel,
): string | { chat: T; restart: boolean } | null {
  if (!crew.on) return "Avos is off. Open Avos to wake it.";
  const copy = crew.copy?.path;
  if (!copy) {
    if (member.role !== "lead")
      return "The project's copy isn't ready yet. Try again in a moment.";
    // Avos in your folder: a chat left in a copy that went away comes back.
    if (!chat.worktreeCwd) return null;
    return {
      restart: true,
      chat: {
        ...chat,
        worktreeCwd: undefined,
        providerSessionId: undefined,
        pendingSwitch: undefined,
      },
    };
  }
  const app = crewMemberApp(member as CrewMember);
  return botChatInCopy(chat, copy, claudeModel, {
    harness: app.harness,
    model: () => app.model ?? modelFor(app.harness),
  });
}

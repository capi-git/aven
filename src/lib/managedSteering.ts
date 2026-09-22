import { prepareAgentBrowserPrompt } from "./agentBrowser";
import { nativeCommandPrompt } from "./harness/nativeCommands";
import { steerHarnessTurn } from "./harness/registry";
import type { SteerTurnInput } from "./harness/types";
import type { HarnessId } from "./session";
import { isNativeCommandPrompt } from "./skills";

/** Managed follow-ups need the same scoped browser guidance as composer turns. */
export async function steerManagedTurn(
  input: SteerTurnInput & { harness: HarnessId },
  isCurrentTurn: () => boolean,
): Promise<void> {
  const text = isNativeCommandPrompt(input.text, input.harness)
    ? nativeCommandPrompt(input.harness, input.text)
    : await prepareAgentBrowserPrompt(input.text, {
        sessionId: input.sessionId,
        cwd: input.cwd,
      });
  if (!isCurrentTurn())
    throw new Error("This agent's turn changed before the guidance was sent.");
  await steerHarnessTurn({ ...input, text });
}

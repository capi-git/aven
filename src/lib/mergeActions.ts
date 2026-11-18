import { gitPrCreate, gitPush, gitSync, type GitDiffIndex } from "./fs";
import { generateCommitMessage, generatePrContent } from "./harness";
import { openInAppUrl } from "./inAppLinks";
import type { HarnessId } from "./session";
import { runShip } from "./shipFlow";

/** Plain Git steps toward a merge, shared by the Checks tab and the merge line. */
export type MergeGitStep =
  "commit-push" | "commit" | "push" | "publish" | "pull" | "create-pr";

/**
 * Runs one step. Commit messages and pull request text come from the
 * chat's provider, with the instructions in Settings › Prompts.
 */
export async function runMergeGitStep(
  step: MergeGitStep,
  cwd: string,
  index: GitDiffIndex,
  textHarness?: HarnessId,
): Promise<void> {
  if (step === "pull" || step === "publish") return void (await gitSync(cwd));
  if (step === "push") return void (await gitPush(cwd));
  if (step === "commit-push" || step === "commit") {
    const message = (await generateCommitMessage(cwd, textHarness)).trim();
    if (!message) throw new Error("Couldn't write the commit message.");
    const push = step === "commit-push";
    // A branch with no upstream yet is published after the commit.
    await runShip({
      cwd,
      message,
      mode: push && index.upstream ? "push" : "commit",
      scope: "all",
      textHarness,
      openPr: null,
    });
    if (push && !index.upstream) await gitSync(cwd);
    return;
  }
  const content = await generatePrContent(cwd, textHarness);
  if (!content) throw new Error("Couldn't prepare the pull request text.");
  const url = await gitPrCreate(
    cwd,
    content.title,
    content.body,
    content.base,
    content.head,
  );
  if (url.trim()) void openInAppUrl(url.trim());
}

import {
  installSessionPermissions,
  type ClaudePermissionRules,
} from "./harness/sessionPermissions";
import { slash } from "./paths";
import { botForChat, type ProjectBot } from "./projectBots";

/**
 * What a bot always asks before doing, enforced as Claude Code `ask` rules
 * on its chat (see `sessionPermissions`), not only asked of it in words. The
 * bot runs in auto mode: everything else in its own copy goes ahead, and
 * these reach the user as approvals ("Needs you").
 *
 * Bash rules match a command anywhere in a chain (`cd x && git push`) and
 * past leading `VAR=value`s, but they are patterns, not a sandbox: the
 * wrapped forms Claude Code documents (`git -C . push`) are listed too.
 */

/** Pushing, committing, merging, and pull requests or issues on GitHub. */
const GIT_AND_GITHUB = [
  "Bash(git push *)",
  "Bash(git * push *)",
  "Bash(git * push)",
  "Bash(git commit *)",
  "Bash(git * commit *)",
  "Bash(git * commit)",
  "Bash(git merge *)",
  "Bash(git * merge *)",
  "Bash(git * merge)",
  // Git aimed somewhere else, or at what the copy shares with your folder:
  // the repository's settings and its other checkouts.
  "Bash(git -C *)",
  "Bash(git --git-dir*)",
  "Bash(git --work-tree*)",
  "Bash(git worktree *)",
  "Bash(git config *)",
  "Bash(git clean *)",
  "Bash(git branch -d *)",
  "Bash(git branch -D *)",
  "Bash(git branch --delete *)",
  "Bash(git tag -d *)",
  "Bash(git stash drop *)",
  "Bash(git stash clear *)",
  "Bash(gh pr create *)",
  "Bash(gh pr merge *)",
  "Bash(gh pr close *)",
  "Bash(gh pr comment *)",
  "Bash(gh pr review *)",
  "Bash(gh pr edit *)",
  "Bash(gh issue create *)",
  "Bash(gh issue comment *)",
  "Bash(gh issue close *)",
  "Bash(gh issue edit *)",
  "Bash(gh issue delete *)",
  "Bash(gh release *)",
  "Bash(gh repo delete *)",
  "Bash(gh workflow run *)",
  "Bash(gh api *)",
];

/** Deploying and publishing. */
const DEPLOY_AND_PUBLISH = [
  "Bash(npm publish *)",
  "Bash(pnpm publish *)",
  "Bash(yarn publish *)",
  "Bash(yarn npm publish *)",
  "Bash(bun publish *)",
  "Bash(cargo publish *)",
  "Bash(twine upload *)",
  "Bash(gem push *)",
  "Bash(docker push *)",
  "Bash(vercel *)",
  "Bash(npx vercel *)",
  "Bash(supabase *)",
  "Bash(npx supabase *)",
  "Bash(netlify *)",
  "Bash(npx netlify *)",
  "Bash(fly deploy *)",
  "Bash(flyctl deploy *)",
  "Bash(firebase deploy *)",
  "Bash(wrangler deploy *)",
  "Bash(wrangler publish *)",
  "Bash(npx wrangler *)",
  "Bash(heroku *)",
];

/** Deleting files. */
const DELETING = [
  "Bash(rm *)",
  "Bash(rmdir *)",
  "Bash(unlink *)",
  "Bash(trash *)",
  "Bash(shred *)",
  "Bash(find * -delete*)",
];

/** Posting or sending messages. */
const SENDING = [
  "Bash(curl -X *)",
  "Bash(curl * -X *)",
  "Bash(curl --request *)",
  "Bash(curl * --request *)",
  "Bash(curl -d *)",
  "Bash(curl * -d *)",
  "Bash(curl --data*)",
  "Bash(curl * --data*)",
  "Bash(curl -F *)",
  "Bash(curl * -F *)",
  "Bash(osascript *)",
  "Bash(mail *)",
  "Bash(sendmail *)",
];

/**
 * A Claude Code path rule for an absolute folder and everything in it:
 * `//Users/me/Orbit/**`. Drive letters read `//c/...`.
 */
export function absolutePathRule(folder: string): string {
  const normal = slash(folder).replace(/\/+$/, "");
  const drive = /^([A-Za-z]):(\/.*)?$/.exec(normal);
  const absolute = drive
    ? `//${drive[1].toLowerCase()}${drive[2] ?? ""}`
    : `/${normal}`;
  return `${absolute}/**`;
}

/** The one line the settings sheet shows for what always asks. */
export const ALWAYS_ASKS_LINE =
  "Always asks before pushing, publishing, merging, sending or deleting.";

/**
 * The rules a bot's chat launches with. Aven's browser follows the user's
 * own setting and other apps still ask per app, as in any chat.
 */
export function botPermissionRules(
  bot: Pick<ProjectBot, "path">,
): ClaudePermissionRules {
  return {
    ask: [
      // Changing the user's own files, rather than its copy. Elsewhere,
      // edits outside its working folder go to auto mode's checks, which
      // Claude Code also applies to protected paths (.git, .claude).
      `Edit(${absolutePathRule(bot.path)})`,
      ...GIT_AND_GITHUB,
      ...DEPLOY_AND_PUBLISH,
      ...DELETING,
      ...SENDING,
    ],
  };
}

/**
 * Every window launches bot chats with their rules and in auto mode, from
 * any spawn path (a message, a resume, a compaction).
 */
export function installBotPermissions(): () => void {
  return installSessionPermissions((sessionId) => {
    const bot = botForChat(sessionId);
    return bot ? { mode: "auto", rules: botPermissionRules(bot) } : undefined;
  });
}

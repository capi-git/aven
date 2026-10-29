import {
  installSessionPermissions,
  type ClaudePermissionRules,
} from "./harness/sessionPermissions";
import { slash } from "./paths";
import { botForAnyChat, botForChat, type ProjectBot } from "./projectBots";
import { CREW_ROLE_INFO, crewForChat, type Crew, type CrewRole } from "./crews";

import { agentBrowserSocket } from "./agentBrowser";
import type {
  ClaudeSandboxSettings,
  SessionPermissions,
} from "./harness/sessionPermissions";

/**
 * What a bot never does, and what it asks before doing, enforced on its chat
 * (see `sessionPermissions`), not only asked of it in words. The bot runs in
 * auto mode: everything else in its own copy goes ahead.
 *
 * Two layers. Claude Code's sandbox (see `botSandbox`) lets its commands
 * write only in its copy and the temp folder and reach only package
 * registries: however a command is spelled (`/usr/bin/git push`,
 * `sh -c "..."`, an alias), it can't push, publish or change your folder.
 * On top, rules: `deny` for what a bot never does (push, open pull
 * requests, publish, deploy; you ship its fixes), `ask` for what reaches you
 * as an approval ("Needs you"). Rules match a command anywhere in a chain
 * (`cd x && git push`) and past leading `VAR=value`s, but they are
 * patterns, so the sandbox is what holds.
 */

/** Pushing, pull requests, releases and running workflows: never. */
const NEVER_GIT = [
  "Bash(git push)",
  "Bash(git push *)",
  "Bash(git * push *)",
  "Bash(git * push)",
  "Bash(gh pr create *)",
  "Bash(gh pr merge *)",
  "Bash(gh release *)",
  "Bash(gh repo delete *)",
  "Bash(gh workflow run *)",
];

/** Committing, merging, and pull requests or issues on GitHub: asks. */
const GIT_AND_GITHUB = [
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
  "Bash(gh pr close *)",
  "Bash(gh pr comment *)",
  "Bash(gh pr review *)",
  "Bash(gh pr edit *)",
  "Bash(gh issue create *)",
  "Bash(gh issue comment *)",
  "Bash(gh issue close *)",
  "Bash(gh issue edit *)",
  "Bash(gh issue delete *)",
  "Bash(gh api *)",
];

/** Deploying and publishing: never. */
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

/** The one line the settings sheet shows for what a bot never does. */
export const ALWAYS_ASKS_LINE =
  "Never pushes or publishes: you ship its fixes. Asks before merging, sending or deleting.";

/**
 * The rules a bot's chat launches with. Aven's browser follows the user's
 * own setting and other apps still ask per app, as in any chat.
 */
export function botPermissionRules(
  bot: Pick<ProjectBot, "path">,
): ClaudePermissionRules {
  return {
    deny: [...NEVER_GIT, ...DEPLOY_AND_PUBLISH],
    ask: [
      // Changing the user's own files, rather than its copy. Elsewhere,
      // edits outside its working folder go to auto mode's checks, which
      // Claude Code also applies to protected paths (.git, .claude).
      `Edit(${absolutePathRule(bot.path)})`,
      ...GIT_AND_GITHUB,
      ...DELETING,
      ...SENDING,
    ],
  };
}

/**
 * Hosts a bot's commands may reach: package registries, so installs work.
 * Not GitHub or any other place a push or deploy could go.
 */
export const BOT_ALLOWED_HOSTS = [
  "registry.npmjs.org",
  "registry.yarnpkg.com",
  "repo.yarnpkg.com",
  "pypi.org",
  "files.pythonhosted.org",
  "crates.io",
  "index.crates.io",
  "static.crates.io",
  "proxy.golang.org",
  "sum.golang.org",
  "rubygems.org",
  "index.rubygems.org",
];

/**
 * Claude Code's sandbox for a bot's commands. They run in its copy (the
 * chat's working folder), so they can write there and in the temp folder
 * only, never in your folder; and not to the repository's refs, which the
 * copy shares with your checkout (your branches, HEAD and index). They
 * reach package registries and local ports (to run and test the app), and
 * nothing runs outside the sandbox: where it can't start, the bot stops.
 */
export function botSandbox(
  bot: Pick<ProjectBot, "copy">,
  /** Aven's browser socket: its in-app browser and desktop commands. */
  browserSocket = agentBrowserSocket(),
): ClaudeSandboxSettings {
  const gitDir = bot.copy
    ? slash(
        bot.copy.gitDir ?? `${slash(bot.copy.root).replace(/\/+$/, "")}/.git`,
      ).replace(/\/+$/, "")
    : null;
  return {
    enabled: true,
    failIfUnavailable: true,
    allowUnsandboxedCommands: false,
    autoAllowBashIfSandboxed: true,
    network: {
      allowedDomains: BOT_ALLOWED_HOSTS,
      allowLocalBinding: true,
      // Aven's own browser and desktop commands, which keep their own
      // approvals (uploads, desktop consent): one socket, not all of them.
      ...(browserSocket ? { allowUnixSockets: [browserSocket] } : {}),
    },
    ...(gitDir
      ? {
          filesystem: {
            denyWrite: [
              `${gitDir}/refs`,
              `${gitDir}/packed-refs`,
              `${gitDir}/logs`,
              `${gitDir}/HEAD`,
              `${gitDir}/index`,
            ],
          },
        }
      : {}),
  };
}

/**
 * A crew member's rules. The Builder's are a bot's: it changes files only
 * in the crew's copy, and never pushes, opens pull requests, publishes or
 * deploys. The Checker and Scout may only read: editing the copy, or your
 * folder, is denied outright rather than asked, so a check can never "fix
 * it itself" or weaken a test to pass.
 */
/**
 * Fetching from the web: a Checker or Scout has no business there, and a
 * page it read could steer it (the Builder keeps it, for docs).
 */
export const WEB_TOOLS = ["WebFetch", "WebSearch"];

export function crewPermissionRules(
  crew: Pick<Crew, "path" | "copy">,
  role: Exclude<CrewRole, "fixer">,
): ClaudePermissionRules {
  const rules = botPermissionRules({ path: crew.path });
  if (CREW_ROLE_INFO[role].edits) return rules;
  return {
    deny: [
      ...(rules.deny ?? []),
      ...WEB_TOOLS,
      `Edit(${absolutePathRule(crew.path)})`,
      ...(crew.copy ? [`Edit(${absolutePathRule(crew.copy.path)})`] : []),
    ],
    ask: (rules.ask ?? []).filter((rule) => !rule.startsWith("Edit(")),
  };
}

/**
 * A crew member's sandbox: a bot's, in the crew's copy. For the Checker and
 * Scout, commands may not write the copy's own files either (its top-level
 * entries Git doesn't ignore), while caches, build output and the temp
 * folder stay writable so tests still run. Aven also compares the copy's
 * fingerprint before and after a check, so anything that slips past voids
 * the verdict (see `afterCheck`).
 */
export function crewSandbox(
  crew: Pick<Crew, "copy">,
  role: Exclude<CrewRole, "fixer">,
  browserSocket = agentBrowserSocket(),
): ClaudeSandboxSettings {
  const sandbox = botSandbox({ copy: crew.copy }, browserSocket);
  if (CREW_ROLE_INFO[role].edits || !crew.copy?.sources?.length) return sandbox;
  return {
    ...sandbox,
    filesystem: {
      denyWrite: [
        ...(sandbox.filesystem?.denyWrite ?? []),
        ...crew.copy.sources.map((path) => slash(path).replace(/\/+$/, "")),
      ],
    },
  };
}

/**
 * What a crew member's chat launches with, whether its crew is on or off,
 * or undefined for any other chat. It fails closed: always the role's
 * rules, sandbox and no MCP servers, only ever in the crew's copy; and while
 * the crew is off (or has no copy yet) the launch is refused outright.
 */
export function crewChatPermissions(
  sessionId: string,
): SessionPermissions | undefined {
  const found = crewForChat(sessionId);
  if (!found || found.member.role === "fixer") return undefined;
  const { crew } = found;
  const role = found.member.role;
  const readOnly = !CREW_ROLE_INFO[role].edits;
  const refuse = !crew.on
    ? "This crew is off, so its chat didn't start. Turn the crew on to use it."
    : !crew.copy
      ? "The crew's copy isn't ready yet, so its chat didn't start."
      : undefined;
  return {
    mode: "auto",
    rules: crewPermissionRules(crew, role),
    sandbox: crewSandbox(crew, role),
    noMcp: true,
    ...(crew.copy ? { workFolder: crew.copy.path } : {}),
    ...(readOnly ? { readOnly: true } : {}),
    ...(refuse ? { refuse } : {}),
  };
}

/**
 * What a project bot's chat launches with while the bot is on: its rules,
 * sandbox and auto mode, no MCP servers, and only in its copy.
 */
export function botChatPermissions(
  bot: Pick<ProjectBot, "path" | "copy">,
): SessionPermissions {
  return {
    mode: "auto",
    rules: botPermissionRules(bot),
    sandbox: botSandbox(bot),
    noMcp: true,
    ...(bot.copy
      ? { workFolder: bot.copy.path }
      : {
          refuse: "The bot's copy isn't ready yet, so its chat didn't start.",
        }),
  };
}

/**
 * Every window launches bot chats (a crew's included) with their rules,
 * sandbox and auto mode, from any spawn path (a message, a resume, a
 * compaction). A crew's chat that can't resolve them never launches (see
 * `launchRefusal`).
 */
export function installBotPermissions(): () => void {
  return installSessionPermissions((sessionId) => {
    const bot = botForChat(sessionId);
    if (bot) return botChatPermissions(bot);
    // Turned off while its copy is still there (mid-start, or while it is
    // being removed): its rules, and refused outright. Once the copy is
    // gone its chat is an ordinary chat in your folder again.
    const off = botForAnyChat(sessionId);
    if (off && !off.on && off.copy)
      return {
        ...botChatPermissions(off),
        refuse: "This bot is off, so its chat didn't start.",
      };
    return crewChatPermissions(sessionId);
  });
}

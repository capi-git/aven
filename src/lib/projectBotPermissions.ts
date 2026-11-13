import {
  installSessionPermissions,
  launchRefusal,
  type ClaudePermissionRules,
} from "./harness/sessionPermissions";
import { basename } from "./fs";
import { mockupStoreRoot } from "./crewMockups";
import { slash } from "./paths";
import { botForAnyChat, botForChat, type ProjectBot } from "./projectBots";
import {
  AVOS_MAY_NOT_READ,
  CREW_ROLE_INFO,
  avosMayRead,
  crewAccess,
  crewMemberPagesReachWeb,
  crewMemberSeesPages,
  crewRoleUsesBrowser,
  crewRoleUsesWeb,
  crewRoleWritesCopy,
  AVEN_DIR,
  MOCKUP_DIR,
  crewForChat,
  crewMemberApp,
  type Crew,
  type CrewRole,
} from "./crews";

import { agentBrowserSocket } from "./agentBrowser";
import { HARNESS_TITLE, type HarnessId } from "./session";
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
  "Bash(curl -X*)",
  "Bash(curl * -X *)",
  "Bash(curl * -X*)",
  "Bash(curl -T *)",
  "Bash(curl * -T *)",
  "Bash(curl --upload-file*)",
  "Bash(curl * --upload-file*)",
  "Bash(curl --json*)",
  "Bash(curl * --json*)",
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

/** What a team's Access never changes. */
export const TEAM_ALWAYS_LINE =
  "Everything stays in Avos's copy until you press Apply. Pushing, publishing, deploying and your keys stay off limits, even with Full access. Helpers don't use connections.";

/** Who Access reaches, in one line; the roles it doesn't follow. */
export const TEAM_ACCESS_SCOPE_LINE =
  "These are for teammates on Claude. A few keep their own rules:";

/** The teammates and turns Access doesn't change, one line each. */
export const TEAM_ACCESS_ROLE_LINES = [
  "Teammates on Codex have no network and never stop to ask.",
  "The Fixer keeps its own rules.",
  "Planning a goal never uses the web or the browser.",
  "Avos and the helpers it starts look at pages in Aven's browser with none of your sign-ins, and never change a file.",
  "The Researcher reads the web whenever Builders may, never changes a file, and its ideas always wait for you.",
  "The Designer never uses the web or the browser, and writes only its mock-up.",
];

/** The one line the settings sheet shows for what a bot never does. */
export const ALWAYS_ASKS_LINE =
  "Never pushes or publishes: you ship its fixes. Asks before merging, sending or deleting.";

/**
 * The rules a bot's chat launches with. Aven's browser follows the user's
 * own setting and other apps still ask per app, as in any chat.
 */
export function botPermissionRules(
  bot: Pick<ProjectBot, "path"> & { copy?: { path: string } },
): ClaudePermissionRules {
  return {
    deny: [
      ...NEVER_GIT,
      ...DEPLOY_AND_PUBLISH,
      ...NEVER_READ_RULES,
      // Settings in its copy that an app would run as the user, and the
      // user's own.
      ...(bot.copy ? copySettingsRules(bot.copy.path) : []),
      ...USER_CONFIG_RULES,
    ],
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
 * Where your tokens for those registries usually live. A bot's commands can
 * reach the registries so installs work, and installs of public packages
 * read nothing here. A token kept elsewhere (a shell startup file, a
 * project's own .env) stays within reach: the publish commands are refused,
 * not every way to upload.
 */
export const PUBLISH_CREDENTIALS = [
  "~/.npmrc",
  "~/.yarnrc.yml",
  "~/.config/pnpm/rc",
  "~/.bunfig.toml",
  "~/.pypirc",
  "~/.netrc",
  "~/.cargo/credentials",
  "~/.cargo/credentials.toml",
  "~/.gem/credentials",
  "~/.local/share/gem/credentials",
];

/**
 * Your keys and sign-ins for other services: SSH, cloud accounts, GitHub's
 * CLI, Docker, Kubernetes, GPG, deploy tools and the agents' own sign-ins. No
 * bot or teammate reads them, by rule and by sandbox: nothing it does needs
 * them (an agent's own app signs in outside its sandbox), and a page or a
 * file it read could ask for them.
 */
export const SECRET_FOLDERS = [
  "~/.ssh",
  "~/.aws",
  "~/.azure",
  "~/.config/gcloud",
  "~/.config/gh",
  "~/.config/supabase",
  "~/.config/vercel",
  "~/.kube",
  "~/.gnupg",
];
export const SECRET_FILES = [
  "~/.docker/config.json",
  "~/.codex/auth.json",
  "~/.codex/mcp-auth.json",
  "~/.claude/.credentials.json",
];

/** Everything a bot's commands may not read: the sandbox's list. */
export const NEVER_READ_PATHS = [
  ...PUBLISH_CREDENTIALS,
  ...SECRET_FILES,
  ...SECRET_FOLDERS,
];

/** The same, as rules for its Read tool (a folder with everything in it). */
export const NEVER_READ_RULES = [
  ...PUBLISH_CREDENTIALS.map((path) => `Read(${path})`),
  ...SECRET_FILES.map((path) => `Read(${path})`),
  ...SECRET_FOLDERS.map((path) => `Read(${path}/**)`),
];

/**
 * Files and folders in a copy that an app would load as settings and run
 * as the user. No bot or crew member may write them; Aven removes any it
 * finds there (see `bot_copy_planted`).
 */
export const COPY_SETTINGS = [
  ".claude",
  ".codex",
  ".agents",
  ".mcp.json",
  ".vscode",
] as const;

/**
 * Your own settings outside the copy, which an agent must never edit:
 * Claude's and Codex's, git's, and the shell's startup files. Its sandbox
 * already keeps its commands out of them; these keep its edit tools out.
 */
export const USER_CONFIG_RULES = [
  "Edit(~/.claude/**)",
  "Edit(~/.claude.json)",
  "Edit(~/.codex/**)",
  "Edit(~/.gitconfig)",
  "Edit(~/.config/git/**)",
  "Edit(~/.zshrc)",
  "Edit(~/.zprofile)",
  "Edit(~/.zshenv)",
  "Edit(~/.bashrc)",
  "Edit(~/.bash_profile)",
  "Edit(~/.profile)",
];

/**
 * Names a fix may not bring into your files (Apply refuses it; you can
 * take it over in a chat): settings an app or editor would run as you, the
 * folders git hook managers run from, package-manager and shell hooks.
 * Matched at any depth of a path, without case. The host refuses them too
 * (see `PROTECTED` in project_bots.rs).
 */
export const PROTECTED_FIX_PATHS = [
  ".claude",
  ".codex",
  ".agents",
  ".aven",
  ".mcp.json",
  ".vscode",
  ".cursor",
  ".zed",
  ".idea",
  ".devcontainer",
  ".husky",
  ".githooks",
  ".git-hooks",
  ".lefthook",
  "lefthook.yml",
  ".lefthook.yml",
  ".pre-commit-config.yaml",
  ".yarnrc.yml",
  ".pnpmfile.cjs",
  ".npmrc",
  "bunfig.toml",
  ".envrc",
  // What every later agent reads as your instructions.
  "agents.md",
  "agents.override.md",
  "claude.md",
  "claude.local.md",
  "gemini.md",
  ".cursorrules",
  ".windsurfrules",
  ".clinerules",
  // Package managers read these as a package's manifest, or build from them.
  "package.yaml",
  "package.json5",
  "binding.gyp",
  // Decides how git shows and treats every other file.
  ".gitattributes",
] as const;

/** Two-part names refused at any depth: a folder and the file or folder in it. */
export const PROTECTED_FIX_PAIRS = [
  ".cargo/config.toml",
  ".cargo/config",
  ".github/workflows",
  ".github/copilot-instructions.md",
] as const;

/**
 * A name as a file system that ignores case reads it: NFKC-normalised and
 * fully case-folded, so "ſ" is "s", "ﬁ" is "fi" and a full-width "ｃ" is "c"
 * (APFS reads the first two that way), not just its ASCII letters.
 */
export function foldedName(name: string): string {
  return name.normalize("NFKC").toUpperCase().toLowerCase().normalize("NFKC");
}

/**
 * The protected paths among a fix's files. A name git would have to quote
 * (a quote or a control character in it) is never applied either. Every
 * part of a path is matched folded ("ſ" is "s" on a Mac), without the
 * trailing dots and spaces Windows drops, so a settings folder is refused
 * at any depth ("packages/app/.vscode/tasks.json"); and, as a margin, a
 * dotfile-style part that isn't plain ASCII is kept out too. Ordinary names
 * with accents ("Données", "Résumé.md") are like any other.
 */
export function protectedFixPaths(paths: readonly string[]): string[] {
  return paths.filter((path) => {
    // oxlint-disable-next-line no-control-regex -- control characters are what this refuses.
    if (path.startsWith('"') || /[\u0000-\u001f\u007f]/.test(path)) return true;
    const parts = path.replace(/\\/g, "/").split("/");
    // oxlint-disable-next-line no-control-regex -- ASCII is what this keeps.
    if (
      parts.some(
        (part) => part.startsWith(".") && /[^\u0000-\u007f]/.test(part),
      )
    )
      return true;
    const folded = parts.map((part) => foldedName(part).replace(/[. ]+$/, ""));
    if (
      folded.some((part) =>
        (PROTECTED_FIX_PATHS as readonly string[]).includes(part),
      )
    )
      return true;
    return folded.some((part, index) =>
      (PROTECTED_FIX_PAIRS as readonly string[]).includes(
        `${part}/${folded[index + 1] ?? ""}`,
      ),
    );
  });
}

/** Edit rules for a copy's settings files and folders, which no bot may write. */
export function copySettingsRules(copy: string): string[] {
  const root = absolutePathRule(copy).replace(/\/\*\*$/, "");
  return COPY_SETTINGS.flatMap((name) => [
    `Edit(${root}/${name})`,
    `Edit(${root}/${name}/**)`,
  ]);
}

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
  /** Aven's browser socket: its in-app browser and desktop commands. Null for none. */
  browserSocket: string | null | undefined = agentBrowserSocket(),
): ClaudeSandboxSettings {
  const gitDir = bot.copy
    ? slash(
        bot.copy.gitDir ?? `${slash(bot.copy.root).replace(/\/+$/, "")}/.git`,
      ).replace(/\/+$/, "")
    : null;
  const copy = bot.copy ? slash(bot.copy.path).replace(/\/+$/, "") : null;
  return {
    enabled: true,
    failIfUnavailable: true,
    allowUnsandboxedCommands: false,
    autoAllowBashIfSandboxed: true,
    network: {
      allowedDomains: BOT_ALLOWED_HOSTS,
      // In auto mode a command can otherwise ask for more hosts for itself.
      strictAllowlist: true,
      allowLocalBinding: true,
      // Aven's own browser and desktop commands, which keep their own
      // approvals (uploads, desktop consent): one socket, not all of them.
      ...(browserSocket ? { allowUnixSockets: [browserSocket] } : {}),
    },
    ...(gitDir && copy
      ? {
          filesystem: {
            denyWrite: [
              `${gitDir}/refs`,
              `${gitDir}/packed-refs`,
              `${gitDir}/logs`,
              `${gitDir}/HEAD`,
              `${gitDir}/index`,
              // What git runs, and how it finds the copy's repository.
              `${gitDir}/hooks`,
              `${gitDir}/config`,
              `${gitDir}/worktrees`,
              // Your history: deleting no longer asks, so it's named here.
              `${gitDir}/objects`,
              `${copy}/.git`,
              // Settings an app would load from the copy and run as the
              // user: Claude's, MCP servers, the editor's tasks.
              ...COPY_SETTINGS.map((name) => `${copy}/${name}`),
            ],
            denyRead: NEVER_READ_PATHS,
          },
        }
      : {}),
  };
}

/**
 * Fetching from the web: a Checker or Scout has no business there, and a
 * page it read could steer it (the Builder keeps it, for docs; the
 * Researcher reads it as its job, and everything it hands back waits for
 * you).
 */
export const WEB_TOOLS = ["WebFetch", "WebSearch"];

/**
 * A crew member's rules. The Builder's are a bot's: it changes files only
 * in the crew's copy, and never pushes, opens pull requests, publishes or
 * deploys. The Checker and Scout may only read: editing the copy, or your
 * folder, is denied outright rather than asked, so a check can never "fix
 * it itself" or weaken a test to pass.
 */
export function crewPermissionRules(
  crew: Pick<Crew, "path" | "copy" | "access">,
  role: Exclude<CrewRole, "fixer">,
  /** It plans the goal now: no web, whatever you set (see `Crew.planning`). */
  offline = false,
): ClaudePermissionRules {
  const rules = botPermissionRules({
    path: crew.path,
    ...(crew.copy ? { copy: crew.copy } : {}),
  });
  const access = crewAccess(crew);
  // The Designer writes one file in its own folder: for every rule here it
  // is a reader, and the copy's own files are refused one by one (see
  // `designerDenied`), so the folder stays open.
  const edits = crewRoleWritesCopy(role);
  const yourFiles = `Edit(${absolutePathRule(crew.path)})`;
  // A copy inside the project (a home folder as the project): refusing your
  // folder would refuse its own copy, so that one rule keeps asking.
  const copyInside =
    !!crew.copy &&
    `${slash(crew.copy.path)}/`.startsWith(
      `${slash(crew.path).replace(/\/+$/, "")}/`,
    );
  const asks = (rules.ask ?? []).filter(
    (rule) =>
      // A Builder deletes as you set it; the sandbox keeps that to its copy
      // and temp files, and to the Checker's and Security's nothing changes.
      !(access.deletes && edits && DELETING.includes(rule)) &&
      // A teammate that only reads never edits: refused below.
      (edits || !rule.startsWith("Edit(")),
  );
  // Full access: a teammate that builds never asks. What the sandbox and
  // `rules.deny` refuse stays refused (pushing, publishing, your keys), and so
  // do your own files, which keep its work in the copy until you press Apply.
  const allowing = access.others === "allow" && edits;
  // Told no, it carries on: nothing waits for you while you're away. One that
  // only reads stays that way under Full access, so a check can't fix what it
  // is checking.
  const refusing =
    access.others === "refuse" ||
    (access.others === "allow" && !edits) ||
    // Nothing a Lead or a helper does is worth stopping for: it answers.
    role === "lead" ||
    role === "helper";
  const web = !offline && crewRoleUsesWeb(crew, role);
  return {
    deny: [
      ...(rules.deny ?? []),
      ...(web ? [] : WEB_TOOLS),
      ...(edits
        ? []
        : role === "designer"
          ? [yourFiles, ...designerDenied(crew)]
          : [
              yourFiles,
              ...(crew.copy
                ? [`Edit(${absolutePathRule(crew.copy.path)})`]
                : []),
            ]),
      // Mock-ups are the Designer's to draw and Aven's to keep: no one else
      // writes the copy's folder for them, and no one writes Aven's store
      // (a Builder reads a mock-up there, never changes it).
      ...mockupsDenied(crew, role),
      ...(refusing
        ? asks.filter((rule) => !(copyInside && rule === yourFiles))
        : []),
      ...(allowing && !copyInside
        ? asks.filter((rule) => rule === yourFiles)
        : []),
      // Sending could publish what it finds, and Delete off still means off.
      ...(allowing ? SENDING : []),
      ...(allowing && !access.deletes && edits ? DELETING : []),
    ],
    ask:
      refusing || allowing
        ? asks.filter((rule) => copyInside && rule === yourFiles)
        : asks,
  };
}

/** The copy's top-level entries a Designer may not write, as paths. */
function designerKeepsOut(copy: NonNullable<Crew["copy"]>): string[] {
  const root = slash(copy.path).replace(/\/+$/, "");
  // Every entry when known (ignored ones too), else the files Git knows.
  const entries = (copy.entries ?? copy.sources ?? [])
    .map((entry) => slash(entry).replace(/\/+$/, ""))
    .filter(
      (path) => path.startsWith(`${root}/`) && basename(path) !== MOCKUP_DIR,
    );
  // Aven's own folder, there or not: its turn isn't checked against it
  // after (see `AVEN_DIR`), so it is kept out before.
  const aven = `${root}/${AVEN_DIR}`;
  return entries.includes(aven) ? entries : [...entries, aven];
}

/**
 * What the Designer may not edit in the copy: each of its top-level entries
 * (ignored ones too, so a cache or a build folder is no way out), named one
 * by one, so that `aven-mockups/`, which is none of them, stays the one
 * place it can write. A new top-level entry its turn adds is caught after.
 */
function designerDenied(crew: Pick<Crew, "copy">): string[] {
  if (!crew.copy) return [];
  return designerKeepsOut(crew.copy).flatMap((path) => {
    const rule = absolutePathRule(path);
    // A file, and anything under a folder of that name.
    return [`Edit(${rule.replace(/\/\*\*$/, "")})`, `Edit(${rule})`];
  });
}

/** The copy's mock-up folder and Aven's store of mock-ups, as paths. */
function mockupPlaces(crew: Pick<Crew, "copy">): {
  folder?: string;
  store?: string;
} {
  if (!crew.copy) return {};
  const copy = slash(crew.copy.path).replace(/\/+$/, "");
  return { folder: `${copy}/${MOCKUP_DIR}`, store: mockupStoreRoot(copy) };
}

/** Edit rules that keep mock-ups to the Designer (the folder) and Aven (the store). */
function mockupsDenied(
  crew: Pick<Crew, "copy">,
  role: Exclude<CrewRole, "fixer">,
): string[] {
  const { folder, store } = mockupPlaces(crew);
  if (!folder || !store) return [];
  const storeRule = absolutePathRule(store);
  const folderRule = absolutePathRule(folder);
  return [
    `Edit(${storeRule.replace(/\/\*\*$/, "")})`,
    `Edit(${storeRule})`,
    ...(role === "designer"
      ? []
      : [`Edit(${folderRule.replace(/\/\*\*$/, "")})`, `Edit(${folderRule})`]),
  ];
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
  crew: Pick<Crew, "copy" | "access">,
  role: Exclude<CrewRole, "fixer">,
  /** Aven's browser socket; null for a teammate that may not use it. */
  browserSocket: string | null | undefined = agentBrowserSocket(),
  /** It plans the goal now: no browser, whatever you set. */
  offline = false,
): ClaudeSandboxSettings {
  const sandbox = botSandbox(
    { copy: crew.copy },
    !offline && crewRoleUsesBrowser(crew, role) ? browserSocket : null,
  );
  if (!crew.copy) return sandbox;
  const { folder, store } = mockupPlaces(crew);
  const keepOut =
    role === "designer"
      ? // Every top-level entry, ignored ones too; its own folder never.
        designerKeepsOut(crew.copy)
      : crewRoleWritesCopy(role)
        ? []
        : (crew.copy.sources ?? []).map((path) =>
            slash(path).replace(/\/+$/, ""),
          );
  // A Lead or a helper answers: no package registries, and nothing in the copy.
  const answers = role === "lead" || role === "helper";
  return {
    ...sandbox,
    ...(offline || answers
      ? { network: { ...sandbox.network, allowedDomains: [] } }
      : {}),
    filesystem: {
      ...sandbox.filesystem,
      denyWrite: [
        ...(sandbox.filesystem?.denyWrite ?? []),
        ...keepOut,
        ...(answers ? [slash(crew.copy.path).replace(/\/+$/, "")] : []),
        // Mock-ups: the copy's folder is the Designer's alone, and Aven's
        // store of them is no one's to write.
        ...(role === "designer" || !folder ? [] : [folder]),
        ...(store ? [store] : []),
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
  // Only the member's role decides what it may do: never its app, model,
  // instructions or scope, which you can change.
  const role = found.member.role;
  // The Designer writes its one file: not read-only for the app, but every
  // other path is refused by its rules and sandbox.
  const readOnly = !CREW_ROLE_INFO[role].edits;
  // Avos and its helpers read your own folder until the project has a copy
  // (one without Git never does): read-only, offline, and kept from writing
  // anything there by their sandbox as well as their rules.
  const inYourFolder = !crew.copy && (role === "lead" || role === "helper");
  const refuse = found.retired
    ? "This chat's teammate was removed, so it didn't start."
    : !crew.on
      ? "Avos is off, so this chat didn't start. Open Avos to wake it."
      : // Nothing reads the project until you've said Avos may.
        !avosMayRead(crew)
        ? AVOS_MAY_NOT_READ
        : !crew.copy && !inYourFolder
          ? "The project's copy isn't ready yet, so this chat didn't start. Wait a moment, then send again."
          : undefined;
  const offline = crew.planning === found.member.id;
  // Aven's browser, for a teammate that may use it now: never a removed
  // one, a helper Avos didn't start, or one on Codex (no network at all).
  const browser =
    !offline && !crewChatBrowserOff(sessionId) ? agentBrowserSocket() : null;
  return {
    mode: "auto",
    rules: crewPermissionRules(crew, role, offline),
    sandbox: inYourFolder
      ? avosFolderSandbox(crew, browser)
      : crewSandbox(crew, role, browser, offline),
    noEscalation: true,
    userSettingsOnly: true,
    noMcp: true,
    ...(crew.copy
      ? { workFolder: crew.copy.path }
      : inYourFolder
        ? { workFolder: crew.path }
        : {}),
    ...(readOnly || inYourFolder ? { readOnly: true } : {}),
    ...(refuse ? { refuse } : {}),
  };
}

/**
 * Avos's sandbox in your own folder, before there's a copy: it may write
 * nothing in the project, reaches no host, and reads none of your keys.
 */
export function avosFolderSandbox(
  crew: Pick<Crew, "path">,
  /**
   * Aven's browser socket, when it may look at pages (see
   * `crewMemberUsesBrowser`): its one way out, to pages Aven keeps apart
   * from yours (see `agentBrowserRestricted`). Null for none.
   */
  browserSocket: string | null = null,
): ClaudeSandboxSettings {
  const sandbox = botSandbox({ copy: undefined }, browserSocket);
  const folder = slash(crew.path).replace(/\/+$/, "");
  return {
    ...sandbox,
    network: { ...sandbox.network, allowedDomains: [] },
    filesystem: {
      ...sandbox.filesystem,
      denyWrite: [...(sandbox.filesystem?.denyWrite ?? []), folder],
      denyRead: [...(sandbox.filesystem?.denyRead ?? []), ...NEVER_READ_PATHS],
    },
  };
}

/**
 * A teammate that may not use Aven's browser now: its turns don't offer it,
 * and its sandbox has no way to reach it.
 */
export function crewChatBrowserOff(sessionId: string): boolean {
  const found = crewForChat(sessionId);
  if (!found || found.member.role === "fixer") return false;
  return (
    // A removed teammate's chat starts nothing, so it has no pages either.
    !!found.retired ||
    // Nor one on Codex (no network at all), one planning a goal, or a
    // helper Avos didn't start.
    !crewMemberSeesPages(found.crew, found.member)
  );
}

/**
 * Whether a chat's browser is the sandboxed one whatever folder it runs in:
 * pages of its own in the throwaway profile (none of your sign-ins), no
 * other tabs, no editor, no desktop or simulator. Aven's host decides this
 * by itself for an agent in one of its copies; Avos and a helper read your
 * own folder while the project has no copy, so the window says it for every
 * teammate's chat. It can only ever add the sandbox, never take it away.
 */
export function agentBrowserRestricted(sessionId: string): boolean {
  const found = crewForChat(sessionId);
  return !!found && found.member.role !== "fixer";
}

/**
 * Whether Aven may save nothing for this chat (a page `export` writes files
 * outside the chat's own sandbox): a teammate whose role changes no file,
 * such as Avos, a helper, a Checker or the Researcher. The agent's start
 * says the same (see `spawnChild`); this repeats it at every bind.
 */
export function agentBrowserReadOnly(sessionId: string): boolean {
  const found = crewForChat(sessionId);
  if (!found || found.member.role === "fixer") return false;
  // A removed teammate's role is all that is known of it: it reads only.
  return !!found.retired || !CREW_ROLE_INFO[found.member.role].edits;
}

/**
 * Whether a chat's pages in Aven's browser may reach the web: true for a
 * teammate whose role Access lets read the web now (see `crewRoleUsesWeb`),
 * on an app with a network, and not while it plans a goal. A project bot's
 * chat has no such setting, and a chat of your own isn't a sandboxed one,
 * so both are false: the host applies this only to a bot's or teammate's
 * chat, and read again at every turn, a change in the Team sheet holds
 * from the next one.
 */
export function agentBrowserWeb(sessionId: string): boolean {
  const found = crewForChat(sessionId);
  if (!found || found.retired || found.member.role === "fixer") return false;
  return (
    crewMemberApp(found.member).harness !== "codex" &&
    found.crew.planning !== found.member.id &&
    crewMemberPagesReachWeb(found.crew, found.member)
  );
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
    userSettingsOnly: true,
    noMcp: true,
    ...(bot.copy
      ? { workFolder: bot.copy.path }
      : {
          refuse:
            "The bot's copy isn't ready yet, so its chat didn't start. Wait a moment, then send again.",
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

/**
 * The app a bot's or crew's chat must run on (Claude, or Codex for a crew's
 * Checker): only those enforce its rules. Undefined for any other chat.
 */
export function teammateHarness(sessionId: string): string | undefined {
  if (botForChat(sessionId)) return "claude";
  const crew = crewForChat(sessionId);
  if (!crew || crew.member.role === "fixer") return undefined;
  return crewMemberApp(crew.member).harness;
}

/**
 * Why a bot's or crew's chat can't start its agent as it is now (on another
 * app, outside its copy, its crew off), or null. Paths that don't go through
 * Claude's or Codex's own guard (compacting the context) ask this first.
 */
export function teammateChatRefusal(session: {
  id: string;
  harness: string;
  cwd: string;
  worktreeCwd?: string;
}): string | null {
  const own = teammateHarness(session.id);
  if (own && session.harness !== own)
    return `This chat runs only on its own app, so it didn't start. Switch it back to ${HARNESS_TITLE[own as HarnessId] ?? own}.`;
  return launchRefusal(session.id, session.worktreeCwd ?? session.cwd);
}

/**
 * Claude Code permission rules that some chats launch with, on top of the
 * user's own settings (see `buildClaudeSpawnArgs`). Rules are passed with
 * `--settings` as `{"permissions": {...}}`; Claude Code evaluates deny, then
 * ask, then allow, across every settings source, so an `ask` here prompts
 * even where the user's settings allow the command, and in auto mode too.
 * The prompts reach the user through Aven's normal approval flow.
 *
 * Features register a resolver rather than threading rules through every
 * spawn path, so a resumed, compacted or relaunched conversation keeps them.
 */

export type ClaudePermissionRules = {
  allow?: string[];
  ask?: string[];
  deny?: string[];
};

/**
 * Claude Code's Bash sandbox, as `--settings` takes it (`sandbox.*`; see
 * code.claude.com/docs/en/sandboxing). Sandboxed commands write only in the
 * working folder and the temp folder, and reach only the listed hosts.
 */
export type ClaudeSandboxSettings = {
  enabled: true;
  /** Stop rather than run commands unsandboxed where it cannot start. */
  failIfUnavailable: boolean;
  /** Never retry a command outside the sandbox. */
  allowUnsandboxedCommands: boolean;
  /** Sandboxed commands run without a prompt; deny and ask rules still apply. */
  autoAllowBashIfSandboxed: boolean;
  network?: {
    allowedDomains?: string[];
    allowLocalBinding?: boolean;
    /** Unix socket paths commands may connect to. */
    allowUnixSockets?: string[];
  };
  filesystem?: { denyWrite?: string[] };
};

export type SessionPermissions = {
  /** The permission mode the chat must run in, whatever its picker says. */
  mode: "auto";
  rules: ClaudePermissionRules;
  sandbox?: ClaudeSandboxSettings;
  /**
   * The chat may read and run commands but never write (a crew's Checker or
   * Scout). Claude gets it through `rules` and `sandbox`; Codex runs the
   * chat in its read-only sandbox, never asking to escalate.
   */
  readOnly?: boolean;
  /**
   * No MCP servers: the agent launches with an empty, strict MCP config, so
   * nothing the user connected elsewhere can act for a bot.
   */
  noMcp?: boolean;
  /**
   * The only folder the chat may run in (a bot's or crew's copy). A launch
   * anywhere else, such as the user's own folder, is refused.
   */
  workFolder?: string;
  /** Why the chat may not start now (its crew is off): a launch is refused. */
  refuse?: string;
};

type Resolver = (sessionId: string) => SessionPermissions | undefined;

let resolver: Resolver | null = null;

export function installSessionPermissions(next: Resolver): () => void {
  resolver = next;
  return () => {
    if (resolver === next) resolver = null;
  };
}

export function sessionPermissions(
  sessionId: string,
): SessionPermissions | undefined {
  return resolver?.(sessionId);
}

/**
 * Chats that must never launch without their rules (a crew member's, on or
 * off): if their permissions don't resolve, the launch is refused rather
 * than run unsandboxed. Registered by the features that own them.
 */
const guarded = new Set<(sessionId: string, cwd: string) => boolean>();

export function registerGuardedChats(
  check: (sessionId: string, cwd: string) => boolean,
): () => void {
  guarded.add(check);
  return () => {
    guarded.delete(check);
  };
}

function trimmed(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** `path` is `folder` or inside it. */
function inside(path: string, folder: string): boolean {
  const child = trimmed(path);
  const parent = trimmed(folder);
  return child === parent || child.startsWith(`${parent}/`);
}

/**
 * Why a chat may not launch its agent in `cwd`, or null when it may. Fails
 * closed: a guarded chat whose rules don't resolve, a chat whose rules say
 * no (its crew is off), or one outside its work folder is refused. Every
 * harness asks before it starts or reuses a process.
 */
export function launchRefusal(sessionId: string, cwd: string): string | null {
  const permissions = sessionPermissions(sessionId);
  if (!permissions) {
    for (const check of guarded)
      if (check(sessionId, cwd))
        return "This chat's safety rules couldn't be read, so it didn't start.";
    return null;
  }
  if (permissions.refuse) return permissions.refuse;
  if (permissions.workFolder && !inside(cwd, permissions.workFolder))
    return "This chat runs only in its own copy of the project, so it didn't start.";
  return null;
}

/** A stable text for the rules, so a change relaunches the agent with them. */
export function permissionRulesKey(
  permissions: SessionPermissions | undefined,
): string {
  return permissions
    ? JSON.stringify([
        permissions.mode,
        permissions.rules.allow ?? [],
        permissions.rules.ask ?? [],
        permissions.rules.deny ?? [],
        permissions.sandbox ?? null,
        permissions.readOnly ?? false,
        permissions.noMcp ?? false,
        permissions.workFolder ?? "",
      ])
    : "";
}

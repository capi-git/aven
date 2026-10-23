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

export type SessionPermissions = {
  /** The permission mode the chat must run in, whatever its picker says. */
  mode: "auto";
  rules: ClaudePermissionRules;
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
      ])
    : "";
}

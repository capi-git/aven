import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw } from "../chrome/icons";
import { homeDir } from "../lib/fs";
import {
  listClaudeConnections,
  listCodexConnections,
  type ConnectionState,
  type ProviderConnection,
} from "../lib/harness/providerConnections";
import {
  EMPTY_MCP_DRAFT,
  MCP_NAME_RE,
  draftToSpec,
  manageMcpServer,
  type ClaudeMcpScope,
  type McpProvider,
  type McpServerDraft,
} from "../lib/mcpServers";
import { Segmented, Select } from "./SettingsControls";
import "./SkillsSettings.css";
import "./ProviderConnections.css";

type Provider = McpProvider;

export type Inventory =
  | { status: "loading" }
  | { status: "loaded"; connections: ProviderConnection[] }
  | { status: "error"; message: string };

const PROVIDERS: Array<{
  id: Provider;
  label: string;
  list: (cwd: string) => Promise<ProviderConnection[]>;
  manage: string;
}> = [
  {
    id: "claude",
    label: "Claude",
    list: listClaudeConnections,
    manage:
      "claude.ai connectors appear when Claude Code is signed in with a claude.ai account; manage them on claude.ai.",
  },
  {
    id: "codex",
    label: "Codex",
    list: listCodexConnections,
    manage:
      "ChatGPT apps appear when Codex is signed in with ChatGPT; manage them in ChatGPT.",
  },
];

const STATE_LABEL: Record<ConnectionState, string> = {
  ready: "Connected",
  "needs-sign-in": "Needs sign-in",
  failed: "Failed",
  starting: "Starting",
  inactive: "No tools",
};

const CLAUDE_SCOPES: {
  value: ClaudeMcpScope;
  label: string;
  description: string;
}[] = [
  {
    value: "user",
    label: "All my projects",
    description: "Saved in your personal Claude settings.",
  },
  {
    value: "project",
    label: "This project, shared",
    description: "Saved in the project's .mcp.json for everyone who uses it.",
  },
  {
    value: "local",
    label: "This project, just me",
    description: "Saved privately for you in this project.",
  },
];

/**
 * Checking starts each provider and its servers, so a recent result is reused
 * when Settings reopens. Failures are never reused, and results expire.
 */
const cache = new Map<string, { inventory: Inventory; at: number }>();
const CACHE_MS = 5 * 60_000;

function cached(key: string): Inventory | undefined {
  const entry = cache.get(key);
  if (!entry || Date.now() - entry.at > CACHE_MS) return undefined;
  return entry.inventory;
}

type Notice = { tone: "ok" | "error"; text: string } | null;

export function ProviderConnections({ cwd }: { cwd: string }) {
  const [inventories, setInventories] = useState<Record<Provider, Inventory>>(
    () => ({
      claude: cached(`claude:${cwd}`) ?? { status: "loading" },
      codex: cached(`codex:${cwd}`) ?? { status: "loading" },
    }),
  );
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  // Without a project, both the check and every change use the home folder.
  const [home, setHome] = useState<string | null>(null);
  useEffect(() => {
    if (cwd) return;
    let active = true;
    void homeDir().then(
      (dir) => active && setHome(dir),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [cwd]);
  const folder = cwd || home || "";

  const load = useCallback(
    (provider: (typeof PROVIDERS)[number], force: boolean) => {
      const key = `${provider.id}:${cwd}`;
      const recent = force ? undefined : cached(key);
      if (recent) {
        setInventories((prev) => ({ ...prev, [provider.id]: recent }));
        return () => {};
      }
      let active = true;
      setInventories((prev) => ({
        ...prev,
        [provider.id]: { status: "loading" },
      }));
      // Settings can open without a project; the user's own setup still applies.
      void (cwd ? Promise.resolve(cwd) : homeDir())
        .then((dir) => provider.list(dir))
        .then(
          (connections): Inventory => ({ status: "loaded", connections }),
          (error: unknown): Inventory => ({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          }),
        )
        .then((inventory) => {
          if (inventory.status === "loaded")
            cache.set(key, { inventory, at: Date.now() });
          else cache.delete(key);
          if (active)
            setInventories((prev) => ({ ...prev, [provider.id]: inventory }));
        });
      return () => {
        active = false;
      };
    },
    [cwd],
  );

  useEffect(() => {
    const cleanups = PROVIDERS.map((provider) => load(provider, false));
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [load]);

  const refresh = (ids: Provider[]) => {
    for (const provider of PROVIDERS)
      if (ids.includes(provider.id)) load(provider, true);
  };

  /** One change at a time, reported in plain words, then a fresh check. */
  const run = async (
    label: string,
    work: () => Promise<string>,
    providers: Provider[],
  ) => {
    setBusy(label);
    setNotice(null);
    try {
      const text = await work();
      setNotice({ tone: "ok", text });
      refresh(providers);
      return true;
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const onSignIn = (provider: Provider, row: ProviderConnection) =>
    void run(
      `signin:${provider}:${row.key}`,
      async () => {
        await manageMcpServer(
          { action: "login", provider, name: row.key },
          folder,
        );
        return `Signed in to ${row.name}.`;
      },
      [provider],
    );

  const onRemove = (provider: Provider, row: ProviderConnection) =>
    void run(
      `remove:${provider}:${row.key}`,
      async () => {
        await manageMcpServer(
          {
            action: "remove",
            provider,
            name: row.key,
            ...(row.scope ? { scope: row.scope } : {}),
          },
          folder,
        );
        return `Removed ${row.name} from ${provider === "claude" ? "Claude" : "Codex"}.`;
      },
      [provider],
    );

  const loading = PROVIDERS.some(
    (provider) => inventories[provider.id].status === "loading",
  );

  return (
    <>
      <div className="skills-tool" id="provider-connections">
        <div className="skills-tool-heading provider-connections-heading">
          <h3>MCP servers</h3>
          <span className="provider-connections-actions">
            <button
              type="button"
              className="settings-button"
              disabled={busy !== null}
              aria-expanded={adding}
              onClick={() => {
                setNotice(null);
                setAdding((value) => !value);
              }}
            >
              <Plus aria-hidden className="size-3.5" />
              Add server
            </button>
            <button
              type="button"
              className="settings-button"
              disabled={loading || busy !== null}
              onClick={() => refresh(PROVIDERS.map((provider) => provider.id))}
            >
              <RefreshCw aria-hidden className="size-3.5" />
              {loading ? "Checking…" : "Check again"}
            </button>
          </span>
        </div>
        <p>
          Claude and Codex keep these in their own settings, and tasks use the
          same ones. When a server needs approval or asks a question, Aven shows
          it in the task. Full access approves server tools automatically.
        </p>
        {busy?.startsWith("signin:") ? (
          <p className="provider-connection-notice" role="status">
            Finish signing in in your browser. This waits up to five minutes.
          </p>
        ) : null}
        {notice ? (
          <p
            className="provider-connection-notice"
            data-tone={notice.tone}
            role={notice.tone === "error" ? "alert" : "status"}
          >
            {notice.text}
          </p>
        ) : null}
      </div>
      {adding ? (
        <AddServerForm
          cwd={cwd}
          busy={busy !== null}
          onCancel={() => setAdding(false)}
          onAdd={async (draft, providers, scope) => {
            const added = await run(
              "add",
              async () => {
                const done: string[] = [];
                for (const provider of providers) {
                  try {
                    await manageMcpServer(
                      {
                        action: "add",
                        provider,
                        name: draft.name.trim(),
                        ...(provider === "claude" ? { scope } : {}),
                        server: draftToSpec(draft, provider),
                      },
                      folder,
                    );
                    done.push(provider === "claude" ? "Claude" : "Codex");
                  } catch (error) {
                    const reason =
                      error instanceof Error ? error.message : String(error);
                    const who = provider === "claude" ? "Claude" : "Codex";
                    throw new Error(
                      done.length
                        ? `Added to ${done.join(" and ")}, but ${who} failed: ${reason}`
                        : `${who} couldn’t add it: ${reason}`,
                    );
                  }
                }
                return `Added ${draft.name.trim()} to ${done.join(" and ")}.`;
              },
              providers,
            );
            if (added) setAdding(false);
            else refresh(providers);
          }}
        />
      ) : null}
      {PROVIDERS.map((provider) => (
        <ProviderConnectionSection
          key={provider.id}
          label={provider.label}
          manage={provider.manage}
          inventory={inventories[provider.id]}
          busyKey={busy}
          busyPrefix={`:${provider.id}:`}
          onSignIn={(row) => onSignIn(provider.id, row)}
          onRemove={(row) => onRemove(provider.id, row)}
        />
      ))}
    </>
  );
}

function AddServerForm({
  cwd,
  busy,
  onCancel,
  onAdd,
}: {
  cwd: string;
  busy: boolean;
  onCancel: () => void;
  onAdd: (
    draft: McpServerDraft,
    providers: Provider[],
    scope: ClaudeMcpScope,
  ) => Promise<void>;
}) {
  const [draft, setDraft] = useState<McpServerDraft>(EMPTY_MCP_DRAFT);
  const [targets, setTargets] = useState<Record<Provider, boolean>>({
    claude: true,
    codex: true,
  });
  const [scope, setScope] = useState<ClaudeMcpScope>("user");
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<McpServerDraft>) =>
    setDraft((prev) => ({ ...prev, ...patch }));
  const providers = (["claude", "codex"] as const).filter((id) => targets[id]);

  const submit = () => {
    setError(null);
    const name = draft.name.trim();
    if (!MCP_NAME_RE.test(name)) {
      setError(
        "Use letters, numbers, dots, dashes, or underscores for the name.",
      );
      return;
    }
    if (!providers.length) {
      setError("Choose Claude, Codex, or both.");
      return;
    }
    try {
      for (const provider of providers) draftToSpec(draft, provider);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    void onAdd(draft, providers, scope);
  };

  return (
    <form
      className="skills-tool provider-server-form"
      aria-label="Add MCP server"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="skills-tool-heading">
        <h3>Add a server</h3>
      </div>
      <label className="provider-field">
        <span>Name</span>
        <input
          value={draft.name}
          onChange={(event) => set({ name: event.target.value })}
          placeholder="github"
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
      </label>
      <div className="provider-field">
        <span>Type</span>
        <Segmented
          label="Server type"
          value={draft.kind}
          options={[
            { value: "stdio", label: "Command on this Mac" },
            { value: "http", label: "Remote URL" },
          ]}
          onChange={(kind) => set({ kind })}
        />
      </div>
      {draft.kind === "stdio" ? (
        <>
          <label className="provider-field">
            <span>Command</span>
            <input
              value={draft.command}
              onChange={(event) => set({ command: event.target.value })}
              placeholder="npx"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="provider-field">
            <span>Arguments</span>
            <input
              value={draft.args}
              onChange={(event) => set({ args: event.target.value })}
              placeholder="-y @modelcontextprotocol/server-github"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="provider-field">
            <span>Environment</span>
            <textarea
              value={draft.env}
              onChange={(event) => set({ env: event.target.value })}
              placeholder={"GITHUB_TOKEN=…\nOne NAME=value per line"}
              rows={2}
              spellCheck={false}
            />
          </label>
        </>
      ) : (
        <>
          <label className="provider-field">
            <span>URL</span>
            <input
              value={draft.url}
              onChange={(event) => set({ url: event.target.value })}
              placeholder="https://mcp.example.com/mcp"
              autoComplete="off"
              spellCheck={false}
              inputMode="url"
            />
          </label>
          {targets.claude ? (
            <label className="provider-field">
              <span>Claude headers</span>
              <textarea
                value={draft.headers}
                onChange={(event) => set({ headers: event.target.value })}
                placeholder={"Optional. Authorization: Bearer …\nOne per line"}
                rows={2}
                spellCheck={false}
              />
            </label>
          ) : null}
          {targets.codex ? (
            <label className="provider-field">
              <span>Codex token variable</span>
              <input
                value={draft.bearerTokenEnvVar}
                onChange={(event) =>
                  set({ bearerTokenEnvVar: event.target.value })
                }
                placeholder="Optional, e.g. EXAMPLE_TOKEN"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          ) : null}
          <p className="skills-note">
            Servers that use sign-in show “Sign in” once they’re added.
          </p>
        </>
      )}
      <div className="provider-field">
        <span>Add to</span>
        <span className="provider-targets">
          {PROVIDERS.map((provider) => (
            <label key={provider.id}>
              <input
                type="checkbox"
                checked={targets[provider.id]}
                onChange={(event) =>
                  setTargets((prev) => ({
                    ...prev,
                    [provider.id]: event.target.checked,
                  }))
                }
              />
              {provider.label}
            </label>
          ))}
        </span>
      </div>
      {targets.claude ? (
        <div className="provider-field">
          <span>Claude uses it in</span>
          <Select
            label="Where Claude uses it"
            value={scope}
            options={CLAUDE_SCOPES.map((option) => ({
              ...option,
              disabled: option.value !== "user" && !cwd,
            }))}
            onChange={(value) => setScope(value as ClaudeMcpScope)}
          />
        </div>
      ) : null}
      {targets.codex ? (
        <p className="skills-note">Codex servers apply to all your projects.</p>
      ) : null}
      {error ? (
        <p className="skills-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="provider-form-actions">
        <button
          type="button"
          className="settings-button"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
        <button type="submit" className="settings-button" disabled={busy}>
          {busy ? "Adding…" : "Add server"}
        </button>
      </div>
    </form>
  );
}

export function ProviderConnectionSection({
  label,
  manage,
  inventory,
  busyKey = null,
  busyPrefix = "",
  onSignIn,
  onRemove,
}: {
  label: string;
  manage: string;
  inventory: Inventory;
  busyKey?: string | null;
  busyPrefix?: string;
  onSignIn?: (row: ProviderConnection) => void;
  onRemove?: (row: ProviderConnection) => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const connections =
    inventory.status === "loaded" ? inventory.connections : [];
  const attention = connections.filter(
    (row) => row.state === "needs-sign-in" || row.state === "failed",
  ).length;
  return (
    <div className="skills-tool">
      <div className="skills-tool-heading">
        <h3>{label}</h3>
        <span
          className="skills-status"
          data-state={
            inventory.status === "loaded" && attention === 0
              ? "ready"
              : "neutral"
          }
        >
          {inventory.status === "loading"
            ? "Checking…"
            : inventory.status === "error"
              ? "Could not check"
              : connections.length === 0
                ? "None set up"
                : attention > 0
                  ? `${attention} need${attention === 1 ? "s" : ""} attention`
                  : `${connections.length} available`}
        </span>
      </div>
      {inventory.status === "error" ? (
        <p className="skills-error" role="alert">
          Aven couldn’t start {label} to check its connections.{" "}
          <span className="provider-connection-detail">
            {inventory.message}
          </span>
        </p>
      ) : null}
      {connections.length > 0 ? (
        <ul
          className="skills-permissions provider-connections"
          aria-label={`${label} connections`}
        >
          {connections.map((row) => {
            const id = `${row.source ?? ""}:${row.key}`;
            const working =
              busyKey !== null && busyKey.endsWith(`${busyPrefix}${row.key}`);
            return (
              <li key={id} data-state={row.state}>
                <span className="provider-connection-name">
                  {row.name}
                  {row.source ? (
                    <span className="provider-connection-source">
                      {" "}
                      · {row.source}
                    </span>
                  ) : null}
                  {row.detail ? (
                    <span className="provider-connection-detail">
                      {row.detail}
                    </span>
                  ) : null}
                </span>
                <strong>
                  {STATE_LABEL[row.state]}
                  {row.toolCount !== undefined
                    ? ` · ${row.toolCount} tool${row.toolCount === 1 ? "" : "s"}`
                    : ""}
                </strong>
                {onSignIn && row.canSignIn ? (
                  <button
                    type="button"
                    className="settings-button provider-row-action"
                    disabled={busyKey !== null}
                    onClick={() => onSignIn(row)}
                  >
                    {working ? "Signing in…" : "Sign in"}
                  </button>
                ) : null}
                {onRemove && row.removable ? (
                  confirming === id ? (
                    <span className="provider-row-confirm">
                      <button
                        type="button"
                        className="settings-button settings-button-danger provider-row-action"
                        disabled={busyKey !== null}
                        onClick={() => {
                          setConfirming(null);
                          onRemove(row);
                        }}
                      >
                        Remove
                      </button>
                      <button
                        type="button"
                        className="settings-button provider-row-action"
                        onClick={() => setConfirming(null)}
                      >
                        Keep
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="settings-button provider-row-action"
                      aria-label={`Remove ${row.name}`}
                      disabled={busyKey !== null}
                      onClick={() => setConfirming(id)}
                    >
                      {working ? "Removing…" : "Remove"}
                    </button>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className="skills-note">{manage}</p>
    </div>
  );
}

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Popover } from "../chrome/Popover";
import { ChevronRight, MoreHorizontal, Plus, RefreshCw } from "../chrome/icons";
import { homeDir } from "../lib/fs";
import { harnessDescriptor } from "../lib/harness/descriptors";
import * as connectionLists from "../lib/harness/providerConnections";
import { moveMenuFocus } from "../lib/keyboard";
import {
  EMPTY_MCP_DRAFT,
  MCP_NAME_RE,
  draftToSpec,
  manageMcpServer,
  type ClaudeMcpScope,
  type McpProvider,
  type McpServerDraft,
} from "../lib/mcpServers";
import {
  MCP_AGENT_LABEL,
  buildMcpOverview,
  canTurnOffHere,
  entryLabel,
  mcpHiddenSetting,
  setMcpHidden,
  type McpAction,
  type McpEntry,
  type McpInventory,
  type McpRow,
} from "../lib/mcpOverview";
import { SETTINGS } from "../lib/settings";
import { useSetting } from "../hooks/useSetting";
import { Segmented, Select } from "./SettingsControls";
import "../chrome/Menu.css";
import "./SkillsSettings.css";
import "./ProviderConnections.css";

type Provider = McpProvider;

export type Inventory = McpInventory;

const PROVIDERS = (["claude", "codex"] as const).map((id) => {
  const connections = harnessDescriptor(id).connections!;
  return { id, ...connections, list: connectionLists[connections.list] };
});

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

/** More sign-ins than this fold into one "N need sign-in" line. */
const SIGN_IN_FOLD = 3;

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

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

const ids = (entries: McpEntry[]) => entries.map((entry) => entry.id);

const agentNames = (entries: McpEntry[]) =>
  joinAnd(
    [...new Set(entries.map((entry) => entry.provider))].map(
      (provider) => MCP_AGENT_LABEL[provider],
    ),
  );

function setServerEnabled(
  entry: McpEntry,
  folder: string,
  enabled: boolean,
): Promise<{ note?: string } | void> {
  return entry.provider === "claude"
    ? connectionLists.setClaudeServerEnabled(
        folder,
        entry.connection.key,
        enabled,
      )
    : connectionLists.setCodexServerEnabled(
        folder,
        entry.connection.key,
        enabled,
      );
}

/** Where a turn-off applies, in the words the notice uses. */
function turnedOffWhere(entries: McpEntry[]): string {
  const claude = entries.some((entry) => entry.provider === "claude");
  const codex = entries.some((entry) => entry.provider === "codex");
  if (claude && codex) return "in Codex, and for Claude in this project";
  return claude ? "for Claude in this project" : "in Codex";
}

/**
 * Turns each entry off or on in turn, returning the agents' notes. When one
 * fails after others changed, the error says what did change, as Remove's
 * does.
 */
async function setEachEnabled(
  entries: McpEntry[],
  folder: string,
  enabled: boolean,
  name: string,
): Promise<string[]> {
  const notes: string[] = [];
  const done: McpEntry[] = [];
  for (const entry of entries) {
    try {
      const result = await setServerEnabled(entry, folder, enabled);
      if (result?.note) notes.push(result.note);
      done.push(entry);
    } catch (error) {
      if (!done.length) throw error;
      const where = enabled
        ? `in ${joinAnd(done.map(entryLabel))}`
        : turnedOffWhere(done);
      throw new Error(
        `Turned ${enabled ? "on" : "off"} ${name} ${where}, but ${entryLabel(entry)} failed: ${errorText(error)}`,
      );
    }
  }
  return notes;
}

const BUSY_LABEL: Record<McpAction["kind"], string> = {
  "sign-in": "Signing in…",
  remove: "Removing…",
  "turn-off": "Turning off…",
  hide: "Hiding…",
  "turn-on": "Turning on…",
  show: "Showing…",
  check: "Checking…",
};

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
  const hidden = useSetting(mcpHiddenSetting);
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
          (error: unknown): Inventory =>
            // An agent that isn't installed has nothing to fix here.
            error instanceof connectionLists.ProviderNotInstalledError
              ? { status: "missing" }
              : { status: "error", message: errorText(error) },
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

  // Claude turns servers off per project, so it needs one open.
  const claudeProject = !!cwd;
  const overview = useMemo(
    () => buildMcpOverview(inventories, hidden, { claudeProject }),
    [inventories, hidden, claudeProject],
  );

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
      setNotice({ tone: "error", text: errorText(error) });
      refresh(providers);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const providersOf = (entries: McpEntry[]) => [
    ...new Set(entries.map((entry) => entry.provider)),
  ];

  const onAction = (row: McpRow, action: McpAction) => {
    const label = `${action.kind}:${row.id}`;
    // Exactly the entries the action names; never the rest of the row.
    const targets = [...row.entries, ...row.copies].filter((entry) =>
      action.targets.includes(entry.id),
    );
    switch (action.kind) {
      case "check":
        setNotice(null);
        refresh(row.agent ? [row.agent] : providersOf(targets));
        return;
      case "sign-in": {
        const entry = targets[0];
        if (!entry) return;
        void run(label, async () => {
          await manageMcpServer(
            {
              action: "login",
              provider: entry.provider,
              name: entry.connection.key,
            },
            folder,
          );
          return `Signed in to ${row.name}.`;
        }, [entry.provider]);
        return;
      }
      case "remove": {
        void run(
          label,
          async () => {
            const done: McpEntry[] = [];
            for (const entry of targets) {
              try {
                await manageMcpServer(
                  {
                    action: "remove",
                    provider: entry.provider,
                    name: entry.connection.key,
                    ...(entry.connection.scope
                      ? { scope: entry.connection.scope }
                      : {}),
                  },
                  folder,
                );
                done.push(entry);
              } catch (error) {
                throw new Error(
                  done.length
                    ? `Removed ${row.name} from ${joinAnd(done.map(entryLabel))}, but ${entryLabel(entry)} failed: ${errorText(error)}`
                    : errorText(error),
                );
              }
            }
            return `Removed ${row.name} from ${joinAnd(targets.map(entryLabel))}.`;
          },
          providersOf(targets),
        );
        return;
      }
      case "turn-off":
      case "hide": {
        const on = targets.filter((entry) => entry.connection.state !== "off");
        const switchable =
          action.kind === "turn-off"
            ? on.filter((entry) => canTurnOffHere(entry, claudeProject))
            : [];
        const tucked = on.filter((entry) => !switchable.includes(entry));
        // Claude could turn it off in a project, just not without one.
        const needsProject = tucked.some(
          (entry) => entry.provider === "claude" && entry.connection.canTurnOff,
        )
          ? " Open a project to turn it off for Claude there."
          : "";
        if (!switchable.length) {
          setMcpHidden(ids(tucked), true);
          setNotice({
            tone: "ok",
            text: `Hid ${row.name} in Aven. ${agentNames(tucked)} still ${tucked.length > 1 ? "load" : "loads"} it.${needsProject}`,
          });
          return;
        }
        void run(
          label,
          async () => {
            const notes = await setEachEnabled(
              switchable,
              folder,
              false,
              row.name,
            );
            if (tucked.length) setMcpHidden(ids(tucked), true);
            return [
              `Turned off ${row.name} ${turnedOffWhere(switchable)}.`,
              tucked.length
                ? `${agentNames(tucked)} can’t turn it off here, so Aven hides it there.${needsProject}`
                : "",
              ...notes,
            ]
              .filter(Boolean)
              .join(" ");
          },
          providersOf(switchable),
        );
        return;
      }
      case "turn-on": {
        const off = targets.filter((entry) => entry.connection.state === "off");
        const shown = ids([...row.entries, ...row.copies]).filter((id) =>
          hidden.includes(id),
        );
        if (shown.length) setMcpHidden(shown, false);
        if (!off.length) return;
        void run(
          label,
          async () => {
            const notes = await setEachEnabled(off, folder, true, row.name);
            return [`Turned on ${row.name}.`, ...notes].join(" ");
          },
          providersOf(off),
        );
        return;
      }
      case "show":
        setMcpHidden(action.targets, false);
        setNotice({ tone: "ok", text: `${row.name} is listed again.` });
        return;
    }
  };

  const onHideCopies = (row: McpRow) => {
    setMcpHidden(
      row.copies.map((entry) => entry.id),
      true,
    );
    setNotice({
      tone: "ok",
      text: `Hid the copy of ${row.name} in Aven. It stays in ${joinAnd([...new Set(row.copies.map((copy) => `the ${copy.connection.plugin} plugin`))])}.`,
    });
  };

  const checking = overview.checking.map((id) => MCP_AGENT_LABEL[id]);
  const anyRows =
    overview.needsYou.length +
      overview.signIn.length +
      overview.working.length +
      overview.off.length >
    0;
  const rowProps = { busy, onAction, onHideCopies };

  return (
    <div
      className="mcp-page"
      id={SETTINGS.agentConnections.id}
      tabIndex={-1}
      aria-label="MCP servers"
    >
      <div className="mcp-toolbar">
        <p className="mcp-toolbar-status" role="status">
          {checking.length ? `Checking ${joinAnd(checking)}…` : ""}
        </p>
        <span className="mcp-toolbar-actions">
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
            disabled={checking.length > 0 || busy !== null}
            onClick={() => {
              setNotice(null);
              refresh(PROVIDERS.map((provider) => provider.id));
            }}
          >
            <RefreshCw aria-hidden className="size-3.5" />
            {checking.length ? "Checking…" : "Check again"}
          </button>
        </span>
      </div>
      {busy?.startsWith("sign-in:") ? (
        <p className="mcp-notice" role="status">
          Finish signing in in your browser. This waits up to five minutes.
        </p>
      ) : null}
      {notice ? (
        <p
          className="mcp-notice"
          data-tone={notice.tone}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      ) : null}
      {adding ? (
        <section className="settings-group">
          <div className="settings-group-surface">
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
                            ...(harnessDescriptor(provider).connections!
                              .supportsScope
                              ? { scope }
                              : {}),
                            server: draftToSpec(draft, provider),
                          },
                          folder,
                        );
                        done.push(
                          harnessDescriptor(provider).connections!.label,
                        );
                      } catch (error) {
                        const who =
                          harnessDescriptor(provider).connections!.label;
                        throw new Error(
                          done.length
                            ? `Added to ${done.join(" and ")}, but ${who} failed: ${errorText(error)}`
                            : `${who} couldn’t add it: ${errorText(error)}`,
                        );
                      }
                    }
                    return `Added ${draft.name.trim()} to ${done.join(" and ")}.`;
                  },
                  providers,
                );
                if (added) setAdding(false);
              }}
            />
          </div>
        </section>
      ) : null}

      {!anyRows && checking.length ? <McpSkeleton /> : null}
      {overview.empty ? (
        <section className="settings-group">
          <div className="settings-group-surface mcp-empty">
            <p>
              No MCP servers yet. Add one to give Claude and Codex more tools.
            </p>
          </div>
        </section>
      ) : null}

      {overview.needsYou.length || overview.signIn.length ? (
        <McpGroup
          title="Needs you"
          count={overview.needsYou.length + overview.signIn.length}
        >
          {overview.needsYou.map((row) => (
            <McpRowView key={row.id} row={row} pinned {...rowProps} />
          ))}
          {overview.signIn.length > SIGN_IN_FOLD ? (
            <SignInFold rows={overview.signIn} {...rowProps} />
          ) : (
            overview.signIn.map((row) => (
              <McpRowView key={row.id} row={row} pinned {...rowProps} />
            ))
          )}
        </McpGroup>
      ) : null}

      {overview.working.length ? (
        <McpGroup title="Working" count={overview.working.length}>
          {overview.working.map((row) => (
            <McpRowView key={row.id} row={row} {...rowProps} />
          ))}
        </McpGroup>
      ) : null}

      {overview.off.length ? (
        <McpOffGroup rows={overview.off} {...rowProps} />
      ) : null}

      {overview.accountConnectors.length ? (
        <p className="mcp-footnote">
          {overview.accountConnectors
            .map((agent) =>
              agent === "claude"
                ? "claude.ai connectors come with your Claude account; manage them on claude.ai."
                : "ChatGPT apps come with your Codex sign-in; manage them in ChatGPT.",
            )
            .join(" ")}
        </p>
      ) : null}
      {overview.missing.length ? (
        <p className="mcp-footnote" data-mcp-missing>
          {`${joinAnd(overview.missing.map((agent) => MCP_AGENT_LABEL[agent]))} ${
            overview.missing.length > 1 ? "aren’t" : "isn’t"
          } installed.`}
        </p>
      ) : null}
    </div>
  );
}

type RowProps = {
  busy: string | null;
  onAction: (row: McpRow, action: McpAction) => void;
  onHideCopies: (row: McpRow) => void;
};

function McpGroup({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section className="settings-group mcp-group" aria-labelledby={titleId}>
      <header className="settings-group-header">
        <h2 id={titleId}>
          {title} <span className="mcp-count">{count}</span>
        </h2>
      </header>
      <div className="settings-group-surface">
        <ul className="mcp-list">{children}</ul>
      </div>
    </section>
  );
}

/** Turned off and hidden servers: folded until asked for. */
function McpOffGroup({ rows, ...rowProps }: { rows: McpRow[] } & RowProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const turnedOff = rows.filter((row) => row.state === "off");
  const hiddenRows = rows.filter((row) => row.state === "hidden");
  const title =
    turnedOff.length && hiddenRows.length
      ? "Turned off or hidden"
      : turnedOff.length
        ? "Turned off"
        : "Hidden";
  const claude = turnedOff.some((row) =>
    row.entries.some((entry) => entry.provider === "claude"),
  );
  const codex = turnedOff.some((row) =>
    row.entries.some((entry) => entry.provider === "codex"),
  );
  const explain = [
    claude ? "Claude turns a server off for one project at a time." : "",
    codex ? "Codex turns it off in every project." : "",
    hiddenRows.length
      ? "Hidden servers still run; Aven just doesn’t list them."
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <section className="settings-group mcp-group mcp-group-off">
      <header className="settings-group-header">
        <h2>
          <button
            type="button"
            className="mcp-fold mcp-group-fold"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((value) => !value)}
          >
            <span>
              {title} <span className="mcp-count">{rows.length}</span>
            </span>
            <ChevronRight aria-hidden className="mcp-fold-chevron" />
          </button>
        </h2>
        {open && explain ? <p>{explain}</p> : null}
      </header>
      {open ? (
        <div className="settings-group-surface" id={listId}>
          <ul className="mcp-list">
            {rows.map((row) => (
              <McpRowView key={row.id} row={row} {...rowProps} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** Many sign-ins read as one line until opened. */
function SignInFold({ rows, ...rowProps }: { rows: McpRow[] } & RowProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const names = rows.map((row) => row.name);
  const preview =
    names.length > 3
      ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`
      : joinAnd(names);
  return (
    <li className="mcp-fold-item" data-state="needs-sign-in">
      <button
        type="button"
        className="mcp-fold"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRight aria-hidden className="mcp-fold-chevron" />
        <span className="mcp-dot" aria-hidden />
        <span className="mcp-fold-label">{rows.length} need sign-in</span>
        {open ? null : <span className="mcp-fold-preview">{preview}</span>}
      </button>
      {open ? (
        <ul className="mcp-list mcp-list-nested" id={listId}>
          {rows.map((row) => (
            <McpRowView key={row.id} row={row} pinned {...rowProps} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function McpRowView({
  row,
  pinned = false,
  busy,
  onAction,
  onHideCopies,
}: { row: McpRow; pinned?: boolean } & RowProps) {
  const [details, setDetails] = useState(false);
  // The Remove being confirmed, with exactly the entries it removes.
  const [confirming, setConfirming] = useState<McpAction | null>(null);
  const [menu, setMenu] = useState(false);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const detailsId = useId();
  const working = busy?.endsWith(`:${row.id}`) ? busy.split(":")[0] : null;
  const disabled = busy !== null;
  const removeFrom = confirming
    ? joinAnd(
        row.entries
          .filter((entry) => confirming.targets.includes(entry.id))
          .map(entryLabel),
      )
    : "";

  const pick = (action: McpAction) => {
    if (action.kind === "remove") setConfirming(action);
    else onAction(row, action);
  };

  return (
    <li
      className="mcp-row"
      data-state={row.state}
      data-pinned={pinned || undefined}
      data-open={menu || !!confirming || undefined}
      data-busy={working ? true : undefined}
    >
      <div className="mcp-row-text">
        <span className="mcp-row-name">{row.name}</span>
        {row.context ? (
          <span className="mcp-row-context">{row.context}</span>
        ) : null}
        {row.problem ? (
          <p className="mcp-row-problem">
            {row.problem.text}
            {row.details.length ? (
              <>
                {" "}
                <button
                  type="button"
                  className="mcp-link"
                  aria-expanded={details}
                  aria-controls={detailsId}
                  onClick={() => setDetails((value) => !value)}
                >
                  {details ? "Hide details" : "Details"}
                </button>
              </>
            ) : null}
          </p>
        ) : null}
        {row.note ? (
          <p className="mcp-row-note">
            {row.note}{" "}
            <button
              type="button"
              className="mcp-link"
              onClick={() => onHideCopies(row)}
            >
              Hide copy
            </button>
          </p>
        ) : null}
        {row.hint ? <p className="mcp-row-note">{row.hint}</p> : null}
        {details ? (
          <pre className="mcp-row-details" id={detailsId}>
            {row.details.join("\n")}
          </pre>
        ) : null}
      </div>
      <span className="mcp-row-side">
        {confirming ? (
          <>
            <span className="mcp-row-question">Remove from {removeFrom}?</span>
            <button
              type="button"
              className="settings-button settings-button-danger mcp-action"
              disabled={disabled}
              onClick={() => {
                setConfirming(null);
                onAction(row, confirming);
              }}
            >
              Remove
            </button>
            <button
              type="button"
              className="settings-button mcp-action"
              onClick={() => setConfirming(null)}
            >
              Keep
            </button>
          </>
        ) : (
          <>
            <span className="mcp-row-status">
              <span className="mcp-dot" aria-hidden />
              {working ? BUSY_LABEL[working as McpAction["kind"]] : row.status}
            </span>
            {working ? null : (
              <span className="mcp-row-actions">
                {row.primary ? (
                  <button
                    type="button"
                    className="settings-button mcp-action"
                    data-primary
                    disabled={disabled}
                    aria-label={`${row.primary.label} ${row.name}`}
                    onClick={() => pick(row.primary!)}
                  >
                    {row.primary.label}
                  </button>
                ) : null}
                {row.more.length ? (
                  <button
                    ref={moreRef}
                    type="button"
                    className="settings-button mcp-action mcp-more"
                    disabled={disabled}
                    aria-label={`More for ${row.name}`}
                    aria-haspopup="menu"
                    aria-expanded={menu}
                    onClick={() => setMenu((value) => !value)}
                  >
                    <MoreHorizontal aria-hidden className="size-3.5" />
                  </button>
                ) : null}
              </span>
            )}
          </>
        )}
      </span>
      {menu ? (
        <Popover
          anchor={moreRef}
          side="bottom"
          align="end"
          width={220}
          autoFocus
          tabIndex={-1}
          role="menu"
          aria-label={`More for ${row.name}`}
          onKeyDown={moveMenuFocus}
          onDismiss={(reason) => {
            setMenu(false);
            if (reason === "escape") moreRef.current?.focus();
          }}
          className="aven-menu"
        >
          {row.more.map((action) => (
            <button
              key={action.kind + action.label}
              type="button"
              role="menuitem"
              className={`aven-menu-item${action.kind === "remove" ? " aven-menu-item-danger" : ""}`}
              onClick={() => {
                setMenu(false);
                moreRef.current?.focus();
                pick(action);
              }}
            >
              <span className="aven-menu-label">{action.label}</span>
            </button>
          ))}
        </Popover>
      ) : null}
    </li>
  );
}

function McpSkeleton() {
  return (
    <section className="settings-group" aria-hidden>
      <div className="settings-group-surface">
        <ul className="mcp-list">
          {[0, 1, 2].map((index) => (
            <li key={index} className="mcp-row mcp-skeleton">
              <div className="mcp-row-text">
                <span className="mcp-skeleton-bar" />
                <span className="mcp-skeleton-bar mcp-skeleton-short" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
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

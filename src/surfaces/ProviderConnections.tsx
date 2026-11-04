import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Popover } from "../chrome/Popover";
import { ChevronRight, MoreHorizontal, Plus, RefreshCw } from "../chrome/icons";
import { errorText } from "../lib/errors";
import { homeDir } from "../lib/fs";
import {
  getHarnessAvailabilitySnapshot,
  isHarnessAvailable,
  probeHarnessAvailability,
  subscribeHarnessAvailability,
} from "../lib/harness/availability";
import { harnessDescriptor } from "../lib/harness/descriptors";
import * as connectionLists from "../lib/harness/providerConnections";
import { moveMenuFocus } from "../lib/keyboard";
import {
  EMPTY_MCP_DRAFT,
  MCP_NAME_RE,
  draftHoldsKey,
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
import {
  MCP_LABEL_MAX,
  mcpLabelsSetting,
  nameWithoutLabel,
  serverNameFor,
  setMcpLabel,
} from "../lib/mcpLabels";
import { MCP_PRESETS, type McpPreset } from "../lib/mcpPresets";
import {
  loadSharedList,
  rowReach,
  type RowReach,
  type SharedList,
} from "../lib/mcpShared";
import type { HarnessId } from "../lib/session";
import { scrubSecrets } from "../lib/scrubSecrets";
import { SETTINGS } from "../lib/settings";
import { useSetting } from "../hooks/useSetting";
import { Segmented, Select } from "./SettingsControls";
import "../chrome/Menu.css";
import "./SkillsSettings.css";
import "./ProviderConnections.css";

type Provider = McpProvider;

export type Inventory = McpInventory;

/**
 * Pi comes last and quietly: it is only asked, never waited for, and shows
 * nothing unless it is installed. Codex can wait five minutes on a sign-in
 * while adding, so adding goes to it last.
 */
const PROVIDERS = (["claude", "codex", "pi"] as const).map((id) => {
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

/** Providers that take servers another way, on a row only when installed. */
const OTHER_PROVIDERS: readonly HarnessId[] = [
  "cursor",
  "grok",
  "fx",
  "opencode",
  "omp",
];

const ADD_ORDER: readonly Provider[] = ["claude", "pi", "codex"];

/** More sign-ins than this fold into one "N need sign-in" line. */
const SIGN_IN_FOLD = 3;

/** Codex may sign in to a remote server while adding it. */
const ADD_WITH_SIGN_IN = "add-with-sign-in";

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

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

const ids = (entries: McpEntry[]) => entries.map((entry) => entry.id);

/** "Codex isn’t installed.", for agents Aven found no CLI for. */
const notInstalled = (agents: readonly Provider[]) =>
  `${joinAnd(agents.map((agent) => MCP_AGENT_LABEL[agent]))} ${
    agents.length > 1 ? "aren’t" : "isn’t"
  } installed.`;

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

/** An action's full name for a screen reader, where the row isn't in view. */
function actionName(action: McpAction, row: McpRow): string {
  return action.kind === "sign-in" && action.agent
    ? `Sign in to ${row.name} for ${MCP_AGENT_LABEL[action.agent]}`
    : `${action.label} ${row.name}`;
}

/**
 * What a finished sign-in means, from the provider's fresh answer. It says so
 * when the provider disagrees, and names who still needs a sign-in.
 */
function signInResult(row: McpRow, entry: McpEntry, fresh: Inventory): string {
  const agent = MCP_AGENT_LABEL[entry.provider];
  const now =
    fresh.status === "loaded"
      ? fresh.connections.find(
          (connection) => connection.key === entry.connection.key,
        )
      : undefined;
  if (now?.state === "needs-sign-in")
    throw new Error(
      `${agent} still says ${row.name} needs sign-in. Try again, or check again in a minute.`,
    );
  if (now?.state === "failed")
    return `Signed in for ${agent}, but ${row.name} still isn’t working.`;
  const others = row.entries.filter(
    (other) =>
      other.id !== entry.id &&
      other.connection.state === "needs-sign-in" &&
      other.connection.canSignIn,
  );
  const next = [
    ...new Set(
      others.map((other) =>
        other.provider === entry.provider
          ? entryLabel(other)
          : MCP_AGENT_LABEL[other.provider],
      ),
    ),
  ];
  return [
    `Signed in to ${row.name} for ${agent}.`,
    next.length ? `${joinAnd(next)} still needs sign-in.` : "",
  ]
    .filter(Boolean)
    .join(" ");
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
  const [inventories, setInventories] = useState<
    Partial<Record<Provider, Inventory>>
  >(() => {
    const pi = cached(`pi:${cwd}`);
    return {
      claude: cached(`claude:${cwd}`) ?? { status: "loading" },
      codex: cached(`codex:${cwd}`) ?? { status: "loading" },
      ...(pi ? { pi } : {}),
    };
  });
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const hidden = useSetting(mcpHiddenSetting);
  const labels = useSetting(mcpLabelsSetting);
  const [shared, setShared] = useState<SharedList>({ servers: [], own: {} });
  useEffect(() => {
    void probeHarnessAvailability();
  }, []);
  const available = useSyncExternalStore(
    subscribeHarnessAvailability,
    getHarnessAvailabilitySnapshot,
  );
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

  const ask = useCallback(
    (provider: (typeof PROVIDERS)[number]): Promise<Inventory> => {
      const key = `${provider.id}:${cwd}`;
      // Settings can open without a project; the user's own setup still applies.
      return (cwd ? Promise.resolve(cwd) : homeDir())
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
          return inventory;
        });
    },
    [cwd],
  );

  const load = useCallback(
    (provider: (typeof PROVIDERS)[number], force: boolean) => {
      const recent = force ? undefined : cached(`${provider.id}:${cwd}`);
      if (recent) {
        setInventories((prev) => ({ ...prev, [provider.id]: recent }));
        return () => {};
      }
      let active = true;
      if (provider.id !== "pi")
        setInventories((prev) => ({
          ...prev,
          [provider.id]: { status: "loading" },
        }));
      void ask(provider).then((inventory) => {
        if (active)
          setInventories((prev) => ({ ...prev, [provider.id]: inventory }));
      });
      return () => {
        active = false;
      };
    },
    [ask, cwd],
  );

  useEffect(() => {
    const cleanups = PROVIDERS.map((provider) => load(provider, false));
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [load]);

  const refresh = (ids: Provider[]) => {
    for (const provider of PROVIDERS)
      if (ids.includes(provider.id)) load(provider, true);
  };

  /** A fresh check that the caller can read the answer of. */
  const recheck = async (id: Provider): Promise<Inventory> => {
    const provider = PROVIDERS.find((candidate) => candidate.id === id)!;
    setInventories((prev) => ({ ...prev, [id]: { status: "loading" } }));
    const inventory = await ask(provider);
    setInventories((prev) => ({ ...prev, [id]: inventory }));
    return inventory;
  };

  const installed = useMemo(() => {
    const ids = new Set<HarnessId>(
      OTHER_PROVIDERS.filter((id) => isHarnessAvailable(id)),
    );
    for (const provider of PROVIDERS)
      if (inventories[provider.id]?.status === "loaded") ids.add(provider.id);
    return ids;
    // `available` changes whenever the availability store does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, inventories]);

  // Claude turns servers off per project, so it needs one open.
  const claudeProject = !!cwd;
  const overview = useMemo(
    () => buildMcpOverview(inventories, hidden, { claudeProject }),
    [inventories, hidden, claudeProject],
  );

  // What other providers get, read again whenever a check finishes.
  const stillChecking = overview.checking.length > 0;
  useEffect(() => {
    if (stillChecking || !folder) return;
    let active = true;
    void loadSharedList(folder).then((list) => active && setShared(list));
    return () => {
      active = false;
    };
  }, [stillChecking, folder, inventories]);

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
      setNotice({ tone: "error", text: scrubSecrets(errorText(error)) });
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
        // No refresh after: the result comes from a check made here.
        void run(label, async () => {
          try {
            await manageMcpServer(
              {
                action: "login",
                provider: entry.provider,
                name: entry.connection.key,
              },
              folder,
            );
          } catch (error) {
            refresh([entry.provider]);
            throw error;
          }
          setBusy(`check:${row.id}`);
          return signInResult(row, entry, await recheck(entry.provider));
        }, []);
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
            // Nothing left under this name: its account name goes with it.
            if (done.length === row.entries.length)
              setMcpLabel(labelKey(row), "");
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

  /** Writes a row's settings to the providers that don't have it yet. */
  const onAddElsewhere = (row: McpRow, reach: RowReach) => {
    const { server, name } = reach;
    if (!server || !name) return;
    const done: string[] = [];
    void run(
      `add-elsewhere:${row.id}`,
      async () => {
        for (const provider of ADD_ORDER.filter((id) =>
          reach.addTo.includes(id),
        )) {
          const who = MCP_AGENT_LABEL[provider];
          try {
            await manageMcpServer(
              {
                action: "add",
                provider,
                name,
                ...(provider === "claude" ? { scope: "user" as const } : {}),
                server,
              },
              folder,
            );
            done.push(who);
          } catch (error) {
            throw new Error(
              done.length
                ? `Added ${row.name} to ${joinAnd(done)}, but ${who} failed: ${errorText(error)}`
                : `${who} couldn’t add ${row.name}: ${errorText(error)}`,
            );
          }
        }
        return `Added ${row.name} to ${joinAnd(done)}.`;
      },
      reach.addTo,
    );
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
  const rowProps = {
    busy,
    onAction,
    onHideCopies,
    onAddElsewhere,
    labels,
    shared,
    installed,
  };
  const missingShown = overview.missing.filter((agent) => agent !== "pi");
  const existingNames = new Set(
    [
      ...overview.needsYou,
      ...overview.signIn,
      ...overview.working,
      ...overview.off,
    ].flatMap((row) => row.entries.map((entry) => entry.connection.key)),
  );

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
      {busy === ADD_WITH_SIGN_IN ? (
        <p className="mcp-notice" role="status">
          If your browser opens, finish signing in there. This waits up to five
          minutes.
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
              missing={overview.missing}
              piInstalled={inventories.pi?.status === "loaded"}
              existing={existingNames}
              busy={busy !== null}
              onCancel={() => setAdding(false)}
              onAdd={async (draft, providers, scope, label) => {
                const added = await run(
                  draft.kind === "http" && providers.includes("codex")
                    ? ADD_WITH_SIGN_IN
                    : "add",
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
                            ? `Added to ${done.join(" and ")}, but ${who} failed: ${errorText(error)} Add server again to finish.`
                            : `${who} couldn’t add it: ${errorText(error)}`,
                        );
                      }
                    }
                    return `Added ${draft.name.trim()} to ${done.join(" and ")}.`;
                  },
                  providers,
                );
                if (added) {
                  if (label) setMcpLabel(draft.name.trim(), label);
                  setAdding(false);
                }
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
              No MCP servers yet. Add one to give your providers more tools.
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
      {missingShown.length ? (
        <p className="mcp-footnote" data-mcp-missing>
          {notInstalled(missingShown)}
        </p>
      ) : null}
    </div>
  );
}

type RowProps = {
  busy: string | null;
  onAction: (row: McpRow, action: McpAction) => void;
  onHideCopies: (row: McpRow) => void;
  onAddElsewhere: (row: McpRow, reach: RowReach) => void;
  labels: Readonly<Record<string, string>>;
  shared: SharedList;
  installed: ReadonlySet<HarnessId>;
};

/** What a row's account name is kept under: its server's name. */
const labelKey = (row: McpRow) =>
  row.id.replace(/^hidden:/, "").replace(/#\d+$/, "");

/** A ready-made server keeps the service's own spelling on its row. */
function rowTitle(name: string, label: string | undefined): string {
  const base = nameWithoutLabel(name, label);
  return MCP_PRESETS.find((preset) => preset.id === base)?.label ?? base;
}

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
  onAddElsewhere,
  labels,
  shared,
  installed,
}: { row: McpRow; pinned?: boolean } & RowProps) {
  const [details, setDetails] = useState(false);
  const [naming, setNaming] = useState(false);
  const label = labels[labelKey(row)];
  const reach = useMemo(
    () => rowReach(row, shared, installed),
    [row, shared, installed],
  );
  // The Remove being confirmed, with exactly the entries it removes.
  const [confirming, setConfirming] = useState<McpAction | null>(null);
  const [menu, setMenu] = useState(false);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const detailsId = useId();
  const working = busy?.endsWith(`:${row.id}`) ? busy.split(":")[0] : null;
  // Only for what the user set up: an account's own servers name themselves.
  const canName = row.entries.some((entry) => entry.connection.removable);
  const addLabel = reach.addTo.length
    ? `Add to ${joinAnd(ADD_ORDER.filter((id) => reach.addTo.includes(id)).map((id) => MCP_AGENT_LABEL[id]))}`
    : "";
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
        <span className="mcp-row-name">
          {rowTitle(row.name, label)}
          {label ? <span className="mcp-row-label">{label}</span> : null}
        </span>
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
        {reach.line ? (
          <p
            className="mcp-row-note"
            data-mcp-reach
            title="Each provider signs in for itself. Aven never copies a key between them."
          >
            {reach.line}
          </p>
        ) : null}
        {details ? (
          <pre className="mcp-row-details" id={detailsId}>
            {row.details.join("\n")}
          </pre>
        ) : null}
      </div>
      <span className="mcp-row-side">
        {naming ? (
          <AccountNameForm
            server={row.name}
            value={label ?? ""}
            onDone={(next) => {
              setNaming(false);
              if (next !== null) setMcpLabel(labelKey(row), next);
            }}
          />
        ) : confirming ? (
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
              {working
                ? working === "add-elsewhere"
                  ? "Adding…"
                  : BUSY_LABEL[working as McpAction["kind"]]
                : row.status}
            </span>
            {working ? null : (
              <span className="mcp-row-actions">
                {row.primary ? (
                  <button
                    type="button"
                    className="settings-button mcp-action"
                    data-primary
                    disabled={disabled}
                    aria-label={actionName(row.primary, row)}
                    onClick={() => pick(row.primary!)}
                  >
                    {row.primary.label}
                  </button>
                ) : null}
                {row.more.length || addLabel || canName ? (
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
          {addLabel ? (
            <button
              type="button"
              role="menuitem"
              className="aven-menu-item"
              onClick={() => {
                setMenu(false);
                moreRef.current?.focus();
                onAddElsewhere(row, reach);
              }}
            >
              <span className="aven-menu-label">{addLabel}</span>
            </button>
          ) : null}
          {canName ? (
            <button
              type="button"
              role="menuitem"
              className="aven-menu-item"
              onClick={() => {
                setMenu(false);
                setNaming(true);
              }}
            >
              <span className="aven-menu-label">
                {label ? "Rename account" : "Name this account"}
              </span>
            </button>
          ) : null}
        </Popover>
      ) : null}
    </li>
  );
}

/** A short name for a row, such as Personal or Work. Empty removes it. */
function AccountNameForm({
  server,
  value,
  onDone,
}: {
  server: string;
  value: string;
  onDone: (next: string | null) => void;
}) {
  const [text, setText] = useState(value);
  return (
    <form
      className="mcp-account-form"
      onSubmit={(event) => {
        event.preventDefault();
        onDone(text);
      }}
    >
      <input
        aria-label={`Account name for ${server}`}
        value={text}
        maxLength={MCP_LABEL_MAX}
        placeholder="Personal or Work"
        autoFocus
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onDone(null);
        }}
      />
      <button type="submit" className="settings-button mcp-action">
        Save
      </button>
    </form>
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

/**
 * A box of `NAME=value` or `Header: value` lines that can hold secrets. It is
 * hidden once there is text to hide, as a password field would be, and can be
 * shown to check a line.
 */
function SecretLines({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="provider-field">
      <span>
        {label}
        {value ? (
          <>
            {" "}
            <button
              type="button"
              className="mcp-link"
              aria-label={`${shown ? "Hide" : "Show"} ${label}`}
              onClick={() => setShown((prev) => !prev)}
            >
              {shown ? "Hide" : "Show"}
            </button>
          </>
        ) : null}
      </span>
      <textarea
        aria-label={label}
        value={value}
        data-masked={(value && !shown) || undefined}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={2}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
    </div>
  );
}

function AddServerForm({
  cwd,
  missing,
  piInstalled,
  existing,
  busy,
  onCancel,
  onAdd,
}: {
  cwd: string;
  /** Agents that aren't installed: offered unticked, and not to be ticked. */
  missing: readonly Provider[];
  piInstalled: boolean;
  /** Names already in a provider's list. */
  existing: ReadonlySet<string>;
  busy: boolean;
  onCancel: () => void;
  onAdd: (
    draft: McpServerDraft,
    providers: Provider[],
    scope: ClaudeMcpScope,
    label: string,
  ) => Promise<void>;
}) {
  const [draft, setDraft] = useState<McpServerDraft>(EMPTY_MCP_DRAFT);
  const [targets, setTargets] = useState<Record<Provider, boolean>>({
    claude: true,
    codex: true,
    pi: true,
  });
  const [account, setAccount] = useState("");
  const [custom, setCustom] = useState(false);
  const [tokenNote, setTokenNote] = useState<string | null>(null);
  const [scope, setScope] = useState<ClaudeMcpScope>("user");
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<McpServerDraft>) =>
    setDraft((prev) => ({ ...prev, ...patch }));
  // An agent found missing after the form opened is unticked too.
  // Pi gets no keys from Aven, and its server names can't have dots.
  const piWarning =
    piInstalled && targets.pi
      ? draftHoldsKey(draft)
        ? "Pi won’t get this one: it uses a private key."
        : draft.name.includes(".")
          ? "Pi won’t get this one: its server names can’t have dots."
          : null
      : null;
  const chosen: Record<Provider, boolean> = {
    claude: targets.claude && !missing.includes("claude"),
    codex: targets.codex && !missing.includes("codex"),
    pi: targets.pi && piInstalled && !piWarning,
  };
  const providers = ADD_ORDER.filter((id) => chosen[id]);
  const offered = PROVIDERS.filter(
    (provider) => provider.id !== "pi" || piInstalled,
  );
  const presets = MCP_PRESETS.filter(
    (preset) => !existing.has(serverNameFor(preset.id, account)),
  );

  const addPreset = (preset: McpPreset) => {
    setError(null);
    const next: McpServerDraft = {
      ...EMPTY_MCP_DRAFT,
      name: serverNameFor(preset.id, account),
      kind: "http",
      url: preset.url,
    };
    // A token can't be one click: open the form with the address filled in.
    if (preset.token) {
      setDraft(next);
      setTokenNote(preset.token);
      setCustom(true);
      return;
    }
    const to = ADD_ORDER.filter(
      (id) =>
        targets[id] && !missing.includes(id) && (id !== "pi" || piInstalled),
    );
    if (!to.length) {
      setError("Choose Claude, Codex, or both.");
      return;
    }
    void onAdd(next, to, "user", account);
  };

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
      setError(errorText(reason));
      return;
    }
    void onAdd(draft, providers, scope, account);
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
        <span>Account (optional)</span>
        <input
          value={account}
          maxLength={MCP_LABEL_MAX}
          onChange={(event) => setAccount(event.target.value)}
          placeholder="Personal or Work"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      {presets.length ? (
        <div className="provider-field">
          <span>Ready-made</span>
          <span className="mcp-presets">
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="settings-button mcp-action"
                disabled={busy}
                title={preset.url}
                onClick={() => addPreset(preset)}
              >
                {preset.label}
              </button>
            ))}
          </span>
        </div>
      ) : null}
      {custom ? null : (
        <button
          type="button"
          className="mcp-link mcp-custom-link"
          onClick={() => setCustom(true)}
        >
          Add your own
        </button>
      )}
      {custom ? (
        <>
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
          {tokenNote ? <p className="skills-note">{tokenNote}</p> : null}
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
              <SecretLines
                label="Environment"
                value={draft.env}
                onChange={(env) => set({ env })}
                placeholder={"GITHUB_TOKEN=…\nOne NAME=value per line"}
              />
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
              {chosen.claude ? (
                <SecretLines
                  label="Claude headers"
                  value={draft.headers}
                  onChange={(headers) => set({ headers })}
                  placeholder={
                    "Optional. Authorization: Bearer …\nOne per line"
                  }
                />
              ) : null}
              {chosen.codex ? (
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
              {chosen.codex && draft.bearerTokenEnvVar.trim() ? (
                <p className="skills-note" data-mcp-token-note>
                  Aven opened from the Dock can’t pass on shell variables, so
                  this token probably won’t reach Codex. Leave it empty to sign
                  in.
                </p>
              ) : null}
              <p className="skills-note">
                Servers that use sign-in show “Sign in” once they’re added.
              </p>
            </>
          )}
          <div className="provider-field">
            <span>Add to</span>
            <span className="provider-targets">
              {offered.map((provider) => (
                <label
                  key={provider.id}
                  data-missing={missing.includes(provider.id) || undefined}
                >
                  <input
                    type="checkbox"
                    checked={chosen[provider.id]}
                    disabled={missing.includes(provider.id)}
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
          {piWarning ? <p className="skills-note">{piWarning}</p> : null}
          {missing.filter((agent) => agent !== "pi").length ? (
            <p className="skills-note" data-mcp-missing>
              {notInstalled(missing.filter((agent) => agent !== "pi"))}
            </p>
          ) : null}
          {chosen.claude ? (
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
          {chosen.codex ? (
            <p className="skills-note">
              Codex servers apply to all your projects.
            </p>
          ) : null}
        </>
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
        {custom ? (
          <button type="submit" className="settings-button" disabled={busy}>
            {busy ? "Adding…" : "Add server"}
          </button>
        ) : null}
      </div>
    </form>
  );
}

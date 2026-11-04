/**
 * A short name for each connection, such as "Personal" or "Work". Only Aven
 * keeps these, by the server's own name, and no provider ever sees them.
 */
import { normalizeServerName } from "./mcpOverview";
import { defineStoredSetting } from "./settingsRegistry";

const LABELS_KEY = "aven.mcpLabels";
export const MCP_LABEL_MAX = 24;

let labelsRaw: string | null | undefined;
let labelsValue: Readonly<Record<string, string>> = {};

export const mcpLabelsSetting = defineStoredSetting<
  Readonly<Record<string, string>>
>({
  key: LABELS_KEY,
  defaultValue: {},
  // The same text gives the same object, so React sees no change.
  parse: (raw) => {
    if (raw === labelsRaw) return labelsValue;
    labelsRaw = raw;
    const next: Record<string, string> = {};
    try {
      const value: unknown = raw ? JSON.parse(raw) : {};
      if (value && typeof value === "object" && !Array.isArray(value))
        for (const [name, label] of Object.entries(value))
          if (typeof label === "string" && label) next[name] = label;
    } catch {
      // Unreadable storage only means the labels are gone.
    }
    labelsValue = next;
    return next;
  },
  serialize: (value) => JSON.stringify(value),
  changeEvent: "aven:mcp-labels-change",
  storageChanges: true,
});

export function cleanMcpLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").slice(0, MCP_LABEL_MAX).trim();
}

/** An empty label removes it. */
export function setMcpLabel(serverName: string, label: string): void {
  const key = normalizeServerName(serverName);
  const next = { ...mcpLabelsSetting.load() };
  const clean = cleanMcpLabel(label);
  if (clean) next[key] = clean;
  else delete next[key];
  mcpLabelsSetting.save(next);
}

export function mcpLabelFor(
  labels: Readonly<Record<string, string>>,
  serverName: string,
): string | undefined {
  return labels[normalizeServerName(serverName)];
}

/**
 * The name for a server under an account: "notion" and "Work" give
 * "notion-work", so the same service can be added once per account. Letters
 * outside a-z are dropped, as the providers' names can't hold them.
 */
export function serverNameFor(base: string, label: string): string {
  const slug = cleanMcpLabel(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `${base}-${slug}`.slice(0, 64) : base;
}

/**
 * A row's name without the account part its label already says, so
 * "notion-work" labelled "Work" reads as "notion".
 */
export function nameWithoutLabel(
  name: string,
  label: string | undefined,
): string {
  if (!label) return name;
  const suffix = serverNameFor("", label);
  return suffix.length > 1 && name.toLowerCase().endsWith(suffix)
    ? name.slice(0, -suffix.length)
    : name;
}

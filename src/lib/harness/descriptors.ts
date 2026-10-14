import type { HarnessId } from "../session";

type BinaryResolver = Extract<
  keyof typeof import("./child"),
  `resolve${string}Binary`
>;

export type HarnessDescriptor = {
  title: string;
  icon: { key: HarnessId; monochrome: boolean };
  cli: { name: string; install?: string; resolve: BinaryResolver };
  defaultModel: {
    id: string;
    /** Priority tiers; catalog order breaks ties within each tier. */
    nativeIds: readonly (readonly string[])[];
    preferId: boolean;
  };
  supportsAttachments: boolean;
  supportsAccessMode: boolean;
  automaticCatalog: boolean;
  automaticToolUpdates: boolean;
  setup: { description: string; guided: boolean; supportsTest: boolean };
  connections?: {
    label: string;
    manage: string;
    list: "listClaudeConnections" | "listCodexConnections";
    supportsScope: boolean;
  };
  usage?: {
    fetch: "fetchClaudeRateLimits" | "fetchCodexRateLimits";
    scopedWeekly: boolean;
  };
  hiddenModelSettings?: readonly string[];
  emptyCatalogLabel?: string;
};

/** Static provider facts are available before live adapters are registered. */
const DESCRIPTORS: Record<HarnessId, HarnessDescriptor> = {
  claude: {
    title: "Claude Code",
    icon: { key: "claude", monochrome: false },
    cli: { name: "Claude Code CLI", resolve: "resolveClaudeBinary" },
    defaultModel: {
      id: "claude:sonnet-5",
      nativeIds: [["claude-sonnet-5"], ["sonnet"]],
      preferId: true,
    },
    supportsAttachments: true,
    supportsAccessMode: true,
    automaticCatalog: true,
    automaticToolUpdates: true,
    setup: {
      description: "Connect your Claude Code account.",
      guided: true,
      supportsTest: true,
    },
    connections: {
      label: "Claude",
      list: "listClaudeConnections",
      manage:
        "claude.ai connectors appear when Claude Code is signed in with a claude.ai account; manage them on claude.ai.",
      supportsScope: true,
    },
    usage: { fetch: "fetchClaudeRateLimits", scopedWeekly: true },
  },
  codex: {
    title: "Codex",
    icon: { key: "codex", monochrome: false },
    cli: { name: "Codex CLI", resolve: "resolveCodexBinary" },
    defaultModel: { id: "", nativeIds: [], preferId: false },
    supportsAttachments: true,
    supportsAccessMode: true,
    automaticCatalog: true,
    automaticToolUpdates: true,
    setup: {
      description: "Connect with ChatGPT or your OpenAI API account.",
      guided: true,
      supportsTest: false,
    },
    connections: {
      label: "Codex",
      list: "listCodexConnections",
      manage:
        "ChatGPT apps appear when Codex is signed in with ChatGPT; manage them in ChatGPT.",
      supportsScope: false,
    },
    usage: { fetch: "fetchCodexRateLimits", scopedWeekly: false },
    emptyCatalogLabel: "Loading Codex models…",
  },
  cursor: {
    title: "Cursor",
    icon: { key: "cursor", monochrome: true },
    cli: { name: "Cursor CLI", resolve: "resolveCursorBinary" },
    defaultModel: {
      id: "cursor:composer-2.5",
      nativeIds: [["composer-2.5"], ["default", "auto"]],
      preferId: false,
    },
    supportsAttachments: true,
    supportsAccessMode: true,
    automaticCatalog: false,
    automaticToolUpdates: false,
    setup: {
      description: "Use the Cursor agent CLI.",
      guided: false,
      supportsTest: false,
    },
  },
  grok: {
    title: "Grok Build",
    icon: { key: "grok", monochrome: true },
    cli: {
      name: "Grok Build CLI",
      install: "curl -fsSL https://x.ai/cli/install.sh | bash",
      resolve: "resolveGrokBinary",
    },
    defaultModel: {
      id: "grok:grok-4.6",
      nativeIds: [["grok-4.6"]],
      preferId: true,
    },
    supportsAttachments: true,
    supportsAccessMode: true,
    automaticCatalog: false,
    automaticToolUpdates: false,
    setup: {
      description: "Connect Grok Build from xAI.",
      guided: false,
      supportsTest: false,
    },
  },
  opencode: {
    title: "OpenCode",
    icon: { key: "opencode", monochrome: true },
    cli: { name: "OpenCode CLI", resolve: "resolveOpenCodeBinary" },
    defaultModel: { id: "opencode:glm-5", nativeIds: [], preferId: true },
    supportsAttachments: true,
    supportsAccessMode: true,
    automaticCatalog: false,
    automaticToolUpdates: false,
    setup: {
      description: "Connect the models you use in OpenCode.",
      guided: false,
      supportsTest: false,
    },
    hiddenModelSettings: ["agent"],
  },
  pi: {
    title: "Pi",
    icon: { key: "pi", monochrome: true },
    cli: {
      name: "Pi CLI",
      install: "npm i -g @earendil-works/pi-coding-agent",
      resolve: "resolvePiBinary",
    },
    defaultModel: { id: "pi:default", nativeIds: [], preferId: true },
    supportsAttachments: true,
    supportsAccessMode: true,
    automaticCatalog: false,
    automaticToolUpdates: false,
    setup: {
      description: "Use your Pi provider configuration.",
      guided: false,
      supportsTest: false,
    },
  },
  omp: {
    title: "omp",
    icon: { key: "omp", monochrome: false },
    cli: {
      name: "omp CLI",
      install: "curl -fsSL https://omp.sh/install | sh",
      resolve: "resolveOmpBinary",
    },
    defaultModel: { id: "omp:default", nativeIds: [], preferId: true },
    supportsAttachments: true,
    supportsAccessMode: true,
    automaticCatalog: false,
    automaticToolUpdates: false,
    setup: {
      description: "Use your oh-my-pi provider configuration.",
      guided: false,
      supportsTest: false,
    },
  },
  fx: {
    title: "fx",
    icon: { key: "fx", monochrome: true },
    cli: {
      name: "fx CLI",
      install: "curl -fsSL https://fx.sh/setup.sh | bash",
      resolve: "resolveFxBinary",
    },
    defaultModel: {
      id: "fx:zai/glm-5.2-fast",
      nativeIds: [
        ["zai/glm-5.2-fast"],
        ["zai/glm-5.2"],
        ["zai/glm-4.7-flash"],
        ["zai/glm-4.7"],
        ["openai/gpt-5.2"],
      ],
      preferId: true,
    },
    supportsAttachments: false,
    supportsAccessMode: false,
    automaticCatalog: false,
    automaticToolUpdates: false,
    setup: {
      description: "Connect your fx CLI configuration.",
      guided: false,
      supportsTest: false,
    },
  },
};

export const HARNESS_IDS = Object.keys(DESCRIPTORS) as HarnessId[];

export function harnessDescriptor(id: HarnessId): HarnessDescriptor {
  return DESCRIPTORS[id];
}

/** Preserve native preferences, catalog order and the pre-catalog fallback. */
export function pickHarnessDefaultModel(
  id: HarnessId,
  models: readonly { id: string; nativeId?: string }[],
): string {
  const choice = harnessDescriptor(id).defaultModel;
  for (const nativeIds of choice.nativeIds) {
    const match = models.find(
      (model) => model.nativeId != null && nativeIds.includes(model.nativeId),
    );
    if (match) return match.id;
  }
  return (
    (choice.preferId
      ? models.find((model) => model.id === choice.id)?.id
      : undefined) ??
    models[0]?.id ??
    choice.id
  );
}

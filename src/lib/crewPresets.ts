/**
 * Ready-made crew members: a title ("Designer"; its role's when it has
 * none), a mark, a role, a one-line job, instructions to start from and,
 * for some, the paths they work in. Adding one is one click; everything
 * stays editable afterwards. What a member may do still comes from its role
 * alone (see `crewChatPermissions`).
 */

/** Security's focus, as its editable instructions start out. */
export const SECURITY_INSTRUCTIONS = [
  "Review the change for security problems. A must-fix item is a real problem this change brings in. Look for:",
  "- secrets or keys in code or config",
  "- injection: SQL, shell, path, HTML/XSS",
  "- missing or weakened auth and permission checks",
  "- unsafe dependencies added, or lockfile entries from unknown registries",
  "- dangerous file and network operations",
  "- insecure defaults",
  "- sensitive data written to logs",
  "- new postinstall scripts, package scripts or hooks",
  "- changes to CI, release or deploy files",
  "- anything touching .git, its hooks or its config",
  "Hardening ideas and small risks go under later.",
].join("\n");

/** The roles a ready-made member can have (the Fixer is the project's bot). */
export type CrewPresetRole = "builder" | "checker" | "security" | "scout";

export type CrewPreset = {
  /** Saved on the member, so the gallery knows it's in the crew. */
  key: string;
  role: CrewPresetRole;
  /** Its mark, a sigil key (see `dotSigils`). */
  mark: string;
  /** A title of its own, for a Builder with a job: "Designer". */
  label?: string;
  job: string;
  instructions: string;
  scope?: readonly string[];
};

export const CREW_PRESETS: readonly CrewPreset[] = [
  {
    key: "builder",
    role: "builder",
    mark: "builder",
    job: "Builds the cards you give the crew",
    instructions:
      "Keep each change small and to the card. Match the code around it, and run the tests before you hand over.",
  },
  {
    key: "checker",
    role: "checker",
    mark: "checker",
    job: "Checks every build before you see it",
    instructions:
      "Run the tests, type checks and lint, and try what the Builder says to check. Only real problems are must-fix.",
  },
  {
    key: "scout",
    role: "scout",
    mark: "scout",
    job: "Finds small ideas worth building",
    instructions:
      "Look for small, safe improvements: rough edges, missing empty states, small bugs. Skip anything big or risky.",
  },
  {
    key: "designer",
    role: "builder",
    mark: "designer",
    label: "Designer",
    job: "Builds UI cards; follows your design tokens",
    instructions:
      "Follow the project's design tokens and existing components. Check light and dark themes and narrow widths. Keep words on screen plain.",
    scope: [
      "src/components",
      "src/styles",
      "src/ui",
      "public",
      "**/*.css",
      "**/*.scss",
      "**/*.tsx",
      "**/*.jsx",
      "**/*.vue",
      "**/*.svelte",
      "**/*.html",
    ],
  },
  {
    key: "tester",
    role: "builder",
    mark: "tester",
    label: "Tester",
    job: "Adds and fixes tests for each change",
    instructions:
      "Add or fix tests for the card's change. Prefer small, fast tests that fail for the right reason. Never change what the code does just to make a test pass.",
    scope: ["**/*.test.*", "**/*.spec.*", "test", "tests", "__tests__", "e2e"],
  },
  {
    key: "scribe",
    role: "builder",
    mark: "scribe",
    label: "Scribe",
    job: "Keeps the docs in step with changes",
    instructions:
      "Keep the README, docs and changelog notes in step with what changed. Plain words and short sentences, no marketing.",
    scope: ["docs", "doc", "README*", "CHANGELOG*", "**/*.md", "**/*.mdx"],
  },
  {
    key: "security",
    role: "security",
    mark: "security",
    job: "Reviews each passed build for security",
    instructions: SECURITY_INSTRUCTIONS,
  },
];

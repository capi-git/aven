/**
 * Ready-made connections: official hosted MCP servers, each address taken from
 * the service's own documentation (the `docs` link says where). Hosted servers
 * sign in through the provider, so Aven holds no keys for them.
 */
export type McpPreset = {
  /** The server's name in each provider's list. */
  id: string;
  label: string;
  url: string;
  /** Where the address was confirmed. */
  docs: string;
  /** The service asks for a token, so one click can't finish it. */
  token?: string;
};

export const MCP_PRESETS: readonly McpPreset[] = [
  {
    id: "notion",
    label: "Notion",
    url: "https://mcp.notion.com/mcp",
    docs: "https://developers.notion.com/docs/get-started-with-mcp",
  },
  {
    id: "github",
    label: "GitHub",
    url: "https://api.githubcopilot.com/mcp/",
    docs: "https://github.com/github/github-mcp-server",
    token: "GitHub usually needs a personal access token here.",
  },
  {
    id: "vercel",
    label: "Vercel",
    url: "https://mcp.vercel.com",
    docs: "https://vercel.com/docs/agent-resources/vercel-mcp",
  },
  {
    id: "supabase",
    label: "Supabase",
    url: "https://mcp.supabase.com/mcp",
    docs: "https://supabase.com/docs/guides/getting-started/mcp",
  },
  {
    id: "linear",
    label: "Linear",
    url: "https://mcp.linear.app/mcp",
    docs: "https://linear.app/docs/mcp",
  },
  {
    id: "sentry",
    label: "Sentry",
    url: "https://mcp.sentry.dev/mcp",
    docs: "https://mcp.sentry.dev/",
  },
  {
    id: "stripe",
    label: "Stripe",
    url: "https://mcp.stripe.com",
    docs: "https://docs.stripe.com/mcp",
  },
  {
    id: "atlassian",
    label: "Atlassian",
    url: "https://mcp.atlassian.com/v2/mcp",
    docs: "https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/",
  },
  {
    id: "figma",
    label: "Figma",
    url: "https://mcp.figma.com/mcp",
    docs: "https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/",
  },
];

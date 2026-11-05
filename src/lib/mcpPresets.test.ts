import { describe, expect, it } from "vitest";
import { MCP_NAME_RE } from "./mcpServers";
import { MCP_PRESETS } from "./mcpPresets";

describe("ready-made connections", () => {
  it("are hosted, with a name every provider can hold", () => {
    expect(new Set(MCP_PRESETS.map((p) => p.id)).size).toBe(MCP_PRESETS.length);
    for (const preset of MCP_PRESETS) {
      expect(preset.id).toMatch(MCP_NAME_RE);
      expect(preset.id).not.toContain(".");
      expect(new URL(preset.url).protocol).toBe("https:");
      expect(new URL(preset.url).search).toBe("");
      expect(new URL(preset.docs).protocol).toBe("https:");
    }
  });

  it("start with the ones asked for, and leave Framer to its skill", () => {
    const ids = MCP_PRESETS.map((p) => p.id);
    for (const id of ["notion", "github", "vercel", "supabase", "linear"])
      expect(ids).toContain(id);
    expect(ids).not.toContain("framer");
  });
});

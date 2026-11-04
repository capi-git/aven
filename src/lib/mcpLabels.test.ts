import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanMcpLabel,
  mcpLabelFor,
  mcpLabelsSetting,
  nameWithoutLabel,
  serverNameFor,
  setMcpLabel,
} from "./mcpLabels";

describe("account names", () => {
  let stored: Map<string, string>;
  beforeEach(() => {
    stored = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
      removeItem: (key: string) => void stored.delete(key),
    });
  });

  it("keeps them under an aven key, by server name", () => {
    setMcpLabel("Notion-Work", "  Work  ");
    expect(JSON.parse(stored.get("aven.mcpLabels")!)).toEqual({
      "notion-work": "Work",
    });
    expect(mcpLabelFor(mcpLabelsSetting.load(), "notion-work")).toBe("Work");
    setMcpLabel("Notion-Work", "");
    expect(JSON.parse(stored.get("aven.mcpLabels")!)).toEqual({});
  });

  it("ignores what it can't read", () => {
    stored.set("aven.mcpLabels", "not json");
    expect(mcpLabelsSetting.load()).toEqual({});
    stored.set("aven.mcpLabels", '{"a":1,"b":"Work"}');
    expect(mcpLabelsSetting.load()).toEqual({ b: "Work" });
  });

  it("cuts long names", () => {
    expect(cleanMcpLabel("a  b")).toBe("a b");
    expect(cleanMcpLabel("x".repeat(40))).toHaveLength(24);
  });

  it("makes a server name for each account", () => {
    expect(serverNameFor("notion", "")).toBe("notion");
    expect(serverNameFor("notion", "Work")).toBe("notion-work");
    expect(serverNameFor("notion", "My Team!")).toBe("notion-my-team");
    // Nothing a provider's name could hold.
    expect(serverNameFor("notion", "仕事")).toBe("notion");
  });

  it("doesn't say the account twice on a row", () => {
    expect(nameWithoutLabel("notion-work", "Work")).toBe("notion");
    expect(nameWithoutLabel("notion", "Work")).toBe("notion");
    expect(nameWithoutLabel("notion-work", undefined)).toBe("notion-work");
  });
});

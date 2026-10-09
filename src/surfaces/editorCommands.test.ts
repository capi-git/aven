import { describe, expect, it, vi } from "vitest";

describe("deferred editor shortcuts", () => {
  it("does nothing before an editor loads, then forwards commands synchronously", async () => {
    const commands = await import("./editorCommands");
    const event = { key: "f" } as KeyboardEvent;
    expect(commands.handleEditorFindKey(event)).toBe(false);
    expect(commands.openFindInActiveEditor()).toBe(false);
    expect(commands.indentFocusedEditor("more")).toBe(false);
    const handleFindKey = vi.fn(() => true);
    const openFind = vi.fn(() => true);
    const indent = vi.fn(() => true);
    commands.registerEditorCommands({ handleFindKey, openFind, indent });
    expect(commands.handleEditorFindKey(event)).toBe(true);
    expect(commands.openFindInActiveEditor()).toBe(true);
    expect(commands.indentFocusedEditor("less")).toBe(true);
    expect(handleFindKey).toHaveBeenCalledWith(event);
    expect(indent).toHaveBeenCalledWith("less");
  });
});

// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import capability from "../../src-tauri/capabilities/browser-toolbar.json";

const nativeInvoke = vi.fn(async (_command: string, _args?: unknown) => {});

describe("browser toolbar native permissions", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it.each(["main", "window-2"])(
    "grants the real Tauri focus commands used by trusted workspace %s",
    async (label) => {
      vi.stubGlobal("__TAURI_INTERNALS__", {
        invoke: nativeInvoke,
        metadata: {
          currentWindow: { label },
          currentWebview: { label },
        },
      });
      // Use the installed API wrappers: mocking these methods would miss the
      // real plugin command names that caused the PiP return's ACL failure.
      const owner = getCurrentWindow();
      await owner.unminimize();
      await owner.show();
      await owner.setFocus();
      await getCurrentWebview().setFocus();
      const permissions = nativeInvoke.mock.calls.map(([command, args]) => {
        expect(args).toEqual({ label });
        const [plugin, action] = command.split("|");
        return `${plugin.replace("plugin:", "core:")}:allow-${action.replaceAll("_", "-")}`;
      });
      expect(permissions).toHaveLength(4);
      expect(new Set(capability.permissions)).toEqual(new Set(permissions));
    },
  );

  it("keeps focus grants exclusive to local workspace webviews", () => {
    expect(capability.local).toBe(true);
    expect(capability.webviews).toEqual(["main", "window-*"]);
    // Window-level matching would also authorize remote native children.
    expect(capability).not.toHaveProperty("windows");
    expect(capability).not.toHaveProperty("remote");
    expect(capability.permissions).not.toContain("core:window:default");
    expect(capability.permissions).not.toContain("core:webview:default");
  });
});

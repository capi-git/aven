import { beforeEach, describe, expect, it, vi } from "vitest";

const listen = vi.hoisted(() => vi.fn(() => Promise.resolve(() => {})));
vi.mock("@tauri-apps/api/event", () => ({ listen }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "window-2" }),
}));

import { listenInThisWindow } from "./windowMenuEvents";

describe("window menu events", () => {
  beforeEach(() => listen.mockClear());

  it("only hears menu commands addressed to the current window", async () => {
    const handler = vi.fn();
    const unlisten = await listenInThisWindow("toggle_sidebar", handler);
    expect(listen).toHaveBeenCalledExactlyOnceWith("toggle_sidebar", handler, {
      target: "window-2",
    });
    expect(typeof unlisten).toBe("function");
  });
});

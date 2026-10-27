// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
  mac: true,
  tauri: true,
  invoke: vi.fn(),
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: host.invoke,
  isTauri: () => host.tauri,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: host.listen }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onFocusChanged: async () => () => {} }),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ listen: host.listen }),
}));
vi.mock("../lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/platform")>()),
  get IS_MAC() {
    return host.mac;
  },
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render() {
  const { IosSimulatorPane } = await import("./IosSimulatorPane");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(IosSimulatorPane, {
        project: "/work/pom",
        visible: true,
        onOpenFile: () => {},
      }),
    );
  });
  // Let the support check settle.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return container;
}

beforeEach(() => {
  vi.resetModules();
  host.mac = true;
  host.tauri = true;
  host.invoke.mockReset();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

describe("the iPhone pane", () => {
  it("only says where iPhone apps run when this is not a Mac", async () => {
    host.mac = false;
    const pane = await render();
    expect(pane.textContent).toBe("iPhone apps run on a Mac with Xcode.");
    expect(host.invoke).not.toHaveBeenCalled();
  });

  it("asks for Xcode when it is not installed", async () => {
    host.invoke.mockImplementation(async (command: string) =>
      command === "ios_sim_support"
        ? {
            xcode: false,
            live: false,
            developerDir: null,
            reason: "Install Xcode to run iPhone apps",
          }
        : null,
    );
    const pane = await render();
    expect(pane.textContent).toBe("Install Xcode to run iPhone apps");
    expect(host.invoke.mock.calls.map(([command]) => command)).toEqual([
      "ios_sim_support",
    ]);
  });

  it("offers the remembered device and Run once Xcode answers", async () => {
    host.invoke.mockImplementation(async (command: string) => {
      switch (command) {
        case "ios_sim_support":
          return { xcode: true, live: false, developerDir: "/X", reason: "x" };
        case "ios_sim_devices":
          return {
            devices: [
              {
                udid: "AAAA",
                name: "iPhone 18 Pro",
                family: "iphone",
                runtime: "iOS 27.0",
                booted: true,
                state: "Booted",
              },
            ],
            suggested: "AAAA",
          };
        case "ios_sim_project":
          return {
            containers: [{ kind: "project", path: "/work/pom/Pom.xcodeproj" }],
            container: { kind: "project", path: "/work/pom/Pom.xcodeproj" },
            schemes: ["Pom"],
            error: null,
          };
        case "ios_sim_state":
          return {
            status: {
              phase: "idle",
              message: "",
              udid: null,
              bundleId: null,
              builtMs: null,
              errors: [],
              logPath: null,
            },
            logs: [],
          };
        default:
          return null;
      }
    });
    const pane = await render();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(pane.querySelector(".ios-sim-chip")?.textContent).toContain(
      "iPhone 18 Pro",
    );
    // One scheme: no scheme picker.
    expect(pane.querySelectorAll(".ios-sim-chip")).toHaveLength(1);
    expect(pane.querySelector(".ios-sim-run")?.textContent).toBe("Run");
    expect(pane.textContent).toContain("Basic mode");
    // Suggested, not picked: Aven may boot it but never restarts the home
    // screen of one someone else is running.
    expect(host.invoke).toHaveBeenCalledWith("ios_sim_use_device", {
      project: "/work/pom",
      udid: "AAAA",
      picked: false,
    });
  });
});

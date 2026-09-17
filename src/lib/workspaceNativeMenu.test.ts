// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  showWorkspaceNativeMenu,
  supportsWorkspaceNativeMenu,
  type WorkspaceNativeMenuItem,
} from "./workspaceNativeMenu";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  create: vi.fn(),
  popup: vi.fn(),
  close: vi.fn(),
  get: vi.fn(),
  scaleFactor: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/api/menu", () => ({ Menu: { new: mocks.create } }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ scaleFactor: mocks.scaleFactor }),
}));
vi.mock("./platform", () => ({ IS_MAC: true }));

type NativeItem = {
  id?: string;
  text?: string;
  enabled?: boolean;
  checked?: boolean;
  action?: () => void;
};
let options: { items: NativeItem[] };
let anchor: HTMLButtonElement;
const items: WorkspaceNativeMenuItem[] = [
  { id: "summary", label: "Loading usage…", disabled: true },
  { separator: true },
  { id: "refresh", label: "Refresh", disabled: true },
  { id: "selected", label: "Selected", checked: true },
];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.isTauri.mockReturnValue(true);
  mocks.scaleFactor.mockResolvedValue(2);
  mocks.popup.mockResolvedValue(undefined);
  mocks.close.mockResolvedValue(undefined);
  mocks.create.mockImplementation(async (value) => {
    options = value;
    return { popup: mocks.popup, close: mocks.close, get: mocks.get };
  });
  vi.stubGlobal("devicePixelRatio", 2.5);
  anchor = document.createElement("button");
  anchor.getBoundingClientRect = () => new DOMRect(400, 10, 40, 24);
  document.body.append(anchor);
});
afterEach(() => {
  anchor.remove();
  vi.unstubAllGlobals();
});

describe("native workspace menus", () => {
  it("uses AppKit coordinates at the current webview zoom and returns one enabled choice", async () => {
    mocks.popup.mockImplementation(async () => {
      options.items[0].action?.();
      options.items[3].action?.();
      options.items[2].action?.();
    });
    expect(await showWorkspaceNativeMenu(anchor, items)).toBe("selected");
    expect(mocks.popup.mock.calls[0][0]).toMatchObject({ x: 500, y: 42.5 });
    expect(options.items[3]).toMatchObject({ text: "Selected", checked: true });
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(
      document.querySelector('[role="menu"], [data-popover-side]'),
    ).toBeNull();
  });

  it("returns null for dismissal and releases the menu after popup failure", async () => {
    expect(await showWorkspaceNativeMenu(anchor, items)).toBeNull();
    mocks.popup.mockRejectedValueOnce(new Error("Cannot open menu"));
    await expect(showWorkspaceNativeMenu(anchor, items)).rejects.toThrow(
      "Cannot open menu",
    );
    expect(mocks.close).toHaveBeenCalledTimes(2);
    expect(mocks.popup).toHaveBeenCalledTimes(2);
  });

  it("does not open on unsupported runtimes or after the anchor unmounts", async () => {
    mocks.isTauri.mockReturnValue(false);
    expect(supportsWorkspaceNativeMenu()).toBe(false);
    await expect(showWorkspaceNativeMenu(anchor, items)).rejects.toThrow(
      "unavailable",
    );
    mocks.isTauri.mockReturnValue(true);
    mocks.create.mockImplementationOnce(async (value) => {
      options = value;
      anchor.remove();
      return { popup: mocks.popup, close: mocks.close, get: mocks.get };
    });
    expect(await showWorkspaceNativeMenu(anchor, items)).toBeNull();
    expect(mocks.popup).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("makes no resource-table calls while AppKit tracks the popup", async () => {
    let dismiss!: () => void;
    mocks.popup.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          dismiss = resolve;
        }),
    );
    const result = showWorkspaceNativeMenu(anchor, items);
    await vi.waitFor(() => expect(mocks.popup).toHaveBeenCalledOnce());
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
    options.items[3].action?.();
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
    dismiss();
    expect(await result).toBe("selected");
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.popup).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});

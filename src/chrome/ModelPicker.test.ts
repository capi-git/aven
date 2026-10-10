// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/** What the picker looked like in the commit that first showed it. */
const firstFrame = vi.hoisted(() => ({
  tab: null as string | null,
  highlighted: [] as string[],
  scrolled: [] as string[],
}));

vi.mock("../lib/harness/availability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/harness/availability")>()),
  probeHarnessAvailability: vi.fn(async () => {}),
  isHarnessAvailable: () => true,
}));
vi.mock("../lib/harness/registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/harness/registry")>()),
  refreshHarnessCatalogs: vi.fn(async () => {}),
}));
// Snapshot the DOM from a layout effect on the popover's mount. It runs in
// the same commit as the picker's own layout effects, before any paint and
// before passive effects could correct the first frame.
vi.mock("./Popover", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./Popover")>();
  const react = await import("react");
  return {
    ...actual,
    Popover: (props: Parameters<typeof actual.Popover>[0]) => {
      react.useLayoutEffect(() => {
        firstFrame.tab =
          document
            .querySelector('[role="tab"][aria-selected="true"]')
            ?.getAttribute("title") ?? null;
        const rows = document.querySelector('[role="listbox"]')?.children;
        firstFrame.highlighted = [...(rows ?? [])]
          .filter((row) => row.classList.contains("bg-content/10"))
          .map((row) => row.textContent ?? "");
        firstFrame.scrolled = [...scrolled];
      }, []);
      return react.createElement(actual.Popover, props);
    },
  };
});

const scrolled: string[] = [];
const { ModelPicker } = await import("./ModelPicker");
const { modelsFor } = await import("../lib/models");
const { HARNESS_TITLE } = await import("../lib/session");

let root: Root;
let host: HTMLDivElement;
let storage: Map<string, string>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  scrolled.length = 0;
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(
    function (this: HTMLElement) {
      scrolled.push(this.textContent ?? "");
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("opens on the remembered tab with the current model highlighted and in view", async () => {
  const claude = modelsFor("claude");
  expect(claude.length).toBeGreaterThan(1);
  const current = claude[claude.length - 1];
  await act(async () =>
    root.render(
      createElement(ModelPicker, {
        harness: "claude",
        model: current.id,
        onChange: vi.fn(),
      }),
    ),
  );
  // Another picker remembered a provider tab after this one mounted.
  storage.set("monocode.modelPickerTab", "claude");
  await act(async () =>
    host.querySelector<HTMLButtonElement>("button[aria-haspopup]")!.click(),
  );

  expect(firstFrame.tab).toBe(HARNESS_TITLE.claude);
  expect(firstFrame.highlighted).toHaveLength(1);
  expect(firstFrame.highlighted[0]).toContain(current.name);
  expect(firstFrame.scrolled.at(-1)).toContain(current.name);
});

it("never paints the first row highlighted before moving to the current model", async () => {
  storage.set("monocode.modelPickerTab", "claude");
  const claude = modelsFor("claude");
  const current = claude[claude.length - 1];
  await act(async () =>
    root.render(
      createElement(ModelPicker, {
        harness: "claude",
        model: current.id,
        onChange: vi.fn(),
      }),
    ),
  );
  await act(async () =>
    host.querySelector<HTMLButtonElement>("button[aria-haspopup]")!.click(),
  );
  expect(firstFrame.highlighted).toEqual([
    expect.stringContaining(current.name),
  ]);
  expect(firstFrame.scrolled).toEqual([expect.stringContaining(current.name)]);
});

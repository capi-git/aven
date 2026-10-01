import { beforeEach, expect, it, vi } from "vitest";
import { HARNESSES } from "../session";

const resolvers = vi.hoisted(() => ({
  resolveClaudeBinary: vi.fn(),
  resolveCodexBinary: vi.fn(),
  resolveCursorBinary: vi.fn(),
  resolveFxBinary: vi.fn(),
  resolveGrokBinary: vi.fn(),
  resolveOmpBinary: vi.fn(),
  resolveOpenCodeBinary: vi.fn(),
  resolvePiBinary: vi.fn(),
}));
vi.mock("./child", () => resolvers);
vi.mock("./registry", () => ({ isLiveHarness: () => true }));

let store: typeof import("./availability");

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  for (const resolver of Object.values(resolvers))
    resolver.mockReset().mockRejectedValue(new Error("not installed"));
  store = await import("./availability");
});

it("immediately exposes a newly installed chosen provider to store subscribers without probing any CLI", () => {
  const snapshots: boolean[] = [];
  const unsubscribe = store.subscribeHarnessAvailability(() => {
    snapshots.push(store.isHarnessAvailable("codex"));
  });
  store.recordHarnessAvailability("codex", true);
  expect(snapshots).toEqual([true]);
  expect(store.isHarnessAvailable("codex")).toBe(true);
  expect(
    HARNESSES.filter((id) => id !== "codex").every(
      (id) => !store.isHarnessAvailable(id),
    ),
  ).toBe(true);
  for (const resolver of Object.values(resolvers))
    expect(resolver).not.toHaveBeenCalled();
  expect(store.hasProbedHarnessAvailability()).toBe(false);
  unsubscribe();
});

it("emits only for an availability change and retains other provider results", () => {
  const listener = vi.fn();
  const unsubscribe = store.subscribeHarnessAvailability(listener);
  store.recordHarnessAvailability("claude", true);
  store.recordHarnessAvailability("codex", true);
  store.recordHarnessAvailability("codex", true);
  store.recordHarnessAvailability("codex", false);
  store.recordHarnessAvailability("codex", false);
  expect(listener).toHaveBeenCalledTimes(3);
  expect(store.getHarnessAvailabilitySnapshot()).toBe(3);
  expect(store.isHarnessAvailable("claude")).toBe(true);
  expect(store.isHarnessAvailable("codex")).toBe(false);
  for (const resolver of Object.values(resolvers))
    expect(resolver).not.toHaveBeenCalled();
  unsubscribe();
  store.recordHarnessAvailability("codex", true);
  expect(listener).toHaveBeenCalledTimes(3);
});

it("does not refresh the full-probe TTL when a selected provider is checked", async () => {
  let now = 1_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  await store.probeHarnessAvailability();
  for (const resolver of Object.values(resolvers))
    expect(resolver).toHaveBeenCalledTimes(1);
  now += 20_000;
  store.recordHarnessAvailability("codex", true);
  now += 15_000;
  await store.probeHarnessAvailability();
  for (const resolver of Object.values(resolvers))
    expect(resolver).toHaveBeenCalledTimes(2);
});

it("keeps fresh setup evidence when an older full probe finishes, while accepting unaffected providers", async () => {
  let reject!: (reason: Error) => void;
  resolvers.resolveCodexBinary.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  resolvers.resolveClaudeBinary.mockResolvedValueOnce("/cli/claude");
  const pending = store.probeHarnessAvailability();
  store.recordHarnessAvailability("codex", true);
  reject(new Error("older probe did not find Codex"));
  await pending;
  expect(store.isHarnessAvailable("codex")).toBe(true);
  expect(store.isHarnessAvailable("claude")).toBe(true);
});

it("treats a same-value setup result as newer evidence without emitting a duplicate notification", async () => {
  let resolve!: (path: string) => void;
  resolvers.resolveCodexBinary.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const pending = store.probeHarnessAvailability();
  store.recordHarnessAvailability("codex", false);
  expect(store.getHarnessAvailabilitySnapshot()).toBe(0);
  resolve("/old/cli/codex");
  await pending;
  expect(store.isHarnessAvailable("codex")).toBe(false);
});

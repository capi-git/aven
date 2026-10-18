import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
const registry = vi.hoisted(() => ({
  getHarness: vi.fn<(id: string) => { live: boolean } | undefined>(),
}));
vi.mock("./registry", () => registry);

let store: typeof import("./availability");

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  for (const resolver of Object.values(resolvers))
    resolver.mockReset().mockRejectedValue(new Error("not installed"));
  registry.getHarness.mockReset().mockReturnValue({ live: true });
  store = await import("./availability");
});

afterEach(() => {
  vi.useRealTimers();
});

/** A lookup that never answers until the test says so. */
function stuck(resolver: (typeof resolvers)[keyof typeof resolvers]) {
  let answer!: (path: { path: string }) => void;
  resolver.mockImplementation(
    () =>
      new Promise((done) => {
        answer = done;
      }),
  );
  return (path: string) => answer({ path });
}

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

it("records each provider as it answers, without waiting for a stuck one", async () => {
  vi.useFakeTimers();
  const finishCursor = stuck(resolvers.resolveCursorBinary);
  resolvers.resolveClaudeBinary.mockResolvedValue({ path: "/cli/claude" });
  const listener = vi.fn();
  store.subscribeHarnessAvailability(listener);
  let settled = false;
  void store.probeHarnessAvailability().then(() => {
    settled = true;
  });
  await vi.advanceTimersByTimeAsync(0);
  // Claude is usable straight away; Cursor's lookup is still out.
  expect(store.isHarnessAvailable("claude")).toBe(true);
  expect(listener).toHaveBeenCalled();
  expect(store.isCheckingHarnessAvailability("claude")).toBe(false);
  expect(store.isCheckingHarnessAvailability("cursor")).toBe(true);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(store.HARNESS_LOOKUP_TIMEOUT_MS);
  expect(settled).toBe(true);
  expect(store.hasProbedHarnessAvailability()).toBe(true);
  expect(store.isCheckingHarnessAvailability("cursor")).toBe(false);
  // Its answer still counts when it finally arrives.
  finishCursor("/cli/cursor-agent");
  await vi.advanceTimersByTimeAsync(0);
  expect(store.isHarnessAvailable("cursor")).toBe(true);
});

it("lets later probes finish while a lookup is stuck, without asking that CLI again", async () => {
  vi.useFakeTimers();
  stuck(resolvers.resolveCodexBinary);
  const first = store.probeHarnessAvailability();
  await vi.advanceTimersByTimeAsync(store.HARNESS_LOOKUP_TIMEOUT_MS);
  await first;
  resolvers.resolveClaudeBinary.mockResolvedValue({ path: "/cli/claude" });
  let settled = false;
  void store.probeHarnessAvailability({ force: true }).then(() => {
    settled = true;
  });
  await vi.advanceTimersByTimeAsync(0);
  // The newer probe still learns about everything else at once.
  expect(store.isHarnessAvailable("claude")).toBe(true);
  await vi.advanceTimersByTimeAsync(store.HARNESS_LOOKUP_TIMEOUT_MS);
  expect(settled).toBe(true);
  expect(resolvers.resolveCodexBinary).toHaveBeenCalledTimes(1);
  expect(resolvers.resolveClaudeBinary).toHaveBeenCalledTimes(2);
});

it("is checking until a probe answers, and not once a setup check has", async () => {
  expect(store.isCheckingHarnessAvailability("claude")).toBe(true);
  store.recordHarnessAvailability("codex", true);
  expect(store.isCheckingHarnessAvailability("codex")).toBe(false);
  await store.probeHarnessAvailability();
  expect(store.isCheckingHarnessAvailability("claude")).toBe(false);
  expect(store.isHarnessAvailable("claude")).toBe(false);
});

it("looks providers up in a webview that never registered them", async () => {
  // The hover sidebar renders project rows, and so this dialog, without
  // registering any provider adapters.
  registry.getHarness.mockReturnValue(undefined);
  resolvers.resolveClaudeBinary.mockResolvedValue({ path: "/cli/claude" });
  await store.probeHarnessAvailability();
  expect(store.isHarnessAvailable("claude")).toBe(true);
  expect(resolvers.resolveCodexBinary).toHaveBeenCalledOnce();
});

it("does not look up a registered provider that is not live", async () => {
  registry.getHarness.mockImplementation((id) =>
    id === "cursor" ? { live: false } : { live: true },
  );
  resolvers.resolveCursorBinary.mockResolvedValue({ path: "/cli/agent" });
  await store.probeHarnessAvailability();
  expect(store.isHarnessAvailable("cursor")).toBe(false);
  expect(resolvers.resolveCursorBinary).not.toHaveBeenCalled();
});

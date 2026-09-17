import { it, expect, vi } from "vitest";
import { listenerGroup } from "./listenerGroup";
function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
it("rolls back early success and late success after a registration failure; retry installs once", async () => {
  const late = deferred<() => void>(),
    failed = deferred<() => void>(),
    a = vi.fn(),
    b = vi.fn();
  const group = listenerGroup([
    Promise.resolve(a),
    failed.promise,
    late.promise,
  ]);
  const result = expect(group.ready).rejects.toThrow("failed");
  failed.reject(new Error("failed"));
  await result;
  expect(a).toHaveBeenCalledTimes(1);
  late.resolve(b);
  await Promise.resolve();
  expect(b).toHaveBeenCalledTimes(1);
  group.dispose();
  expect(a).toHaveBeenCalledTimes(1);
  const next = vi.fn();
  const retry = listenerGroup([Promise.resolve(next)]);
  await retry.ready;
  retry.dispose();
  expect(next).toHaveBeenCalledTimes(1);
});
it("disposes late registrations after unmount without waiting for all listeners", async () => {
  const late = deferred<() => void>(),
    cleanup = vi.fn();
  const group = listenerGroup([late.promise]);
  group.dispose();
  late.resolve(cleanup);
  await group.ready;
  expect(cleanup).toHaveBeenCalledTimes(1);
});

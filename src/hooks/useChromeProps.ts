import { useInsertionEffect, useRef } from "react";

/** Compare small, data-only chrome projections; never traverse sessions/transcripts or React nodes. */
export function equalChromeData(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object")
    return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => equalChromeData(value, right[index]))
    );
  }
  if (left instanceof Set || right instanceof Set) {
    return (
      left instanceof Set &&
      right instanceof Set &&
      left.size === right.size &&
      [...left].every((value) => right.has(value))
    );
  }
  if (
    Object.getPrototypeOf(left) !== Object.prototype ||
    Object.getPrototypeOf(right) !== Object.prototype
  )
    return false;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(b, key) &&
        equalChromeData(a[key], b[key]),
    )
  );
}

/**
 * Feed memoized chrome stable projections and callback proxies. The proxies
 * dispatch to the latest committed props, so skipping a render never keeps an
 * old workspace callback. Other props retain normal React identity semantics.
 */
export function useChromeProps<T extends object>(
  props: T,
  dataKeys: readonly (keyof T)[],
): T {
  const current = useRef(props);
  // Publish before child layout effects announce selection/navigation changes.
  useInsertionEffect(() => {
    current.current = props;
  });
  const callbacks = useRef(new Map<keyof T, (...args: unknown[]) => unknown>());
  const previous = useRef(props);
  const next = { ...props };
  for (const key of Object.keys(props) as (keyof T)[]) {
    const value = props[key];
    if (
      typeof key === "string" &&
      key.startsWith("on") &&
      typeof value === "function"
    ) {
      let callback = callbacks.current.get(key);
      if (!callback) {
        callback = (...args: unknown[]) => {
          const latest = current.current[key];
          return typeof latest === "function"
            ? Reflect.apply(latest, undefined, args)
            : undefined;
        };
        callbacks.current.set(key, callback);
      }
      (next as Record<keyof T, unknown>)[key] = callback;
    } else if (
      dataKeys.includes(key) &&
      equalChromeData(previous.current[key], value)
    ) {
      next[key] = previous.current[key];
    }
  }
  previous.current = next;
  return next;
}

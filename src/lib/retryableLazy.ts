import { createElement, lazy, useState, type ComponentType } from "react";

const failed = new Set<() => void>();

/** A lazily loaded view that can also start loading before it is shown. */
export type RetryableLazyComponent<P extends object> = ComponentType<P> & {
  /**
   * Load the view now, such as once the window is idle after startup, so
   * showing it later renders at once instead of suspending. A failure stays
   * quiet here; showing the view loads it again and reports any error.
   */
  preload(): Promise<void>;
};

/**
 * Like `React.lazy`, but a failed import is not cached forever.
 * `retryFailedLazyImports` starts each failed one over, so an error
 * boundary's Retry loads the view again instead of rethrowing the old error.
 * A view that loaded keeps its component, so retrying never remounts it.
 */
export function retryableLazy<P extends object>(
  load: () => Promise<ComponentType<P>>,
): RetryableLazyComponent<P> {
  let loaded: ComponentType<P> | undefined;
  let loading: Promise<ComponentType<P>> | undefined;
  const start = () =>
    (loading ??= load().then(
      (component) => (loaded = component),
      (error: unknown) => {
        loading = undefined;
        throw error;
      },
    ));
  const create = () =>
    lazy(() =>
      start().then(
        (component) => ({ default: component }),
        (error: unknown) => {
          failed.add(reset);
          throw error;
        },
      ),
    );
  let Lazy = create();
  function reset() {
    Lazy = create();
  }
  function RetryableLazy(props: P) {
    // Once loaded, a new mount renders the view directly. Each mount keeps
    // the type it started with, since switching types would remount it.
    const [type] = useState<ComponentType<P>>(() => loaded ?? Lazy);
    return createElement(type, props);
  }
  RetryableLazy.preload = () =>
    start().then(
      () => undefined,
      () => undefined,
    );
  return RetryableLazy;
}

/** Let every import that failed load again on its next render. */
export function retryFailedLazyImports() {
  const resets = [...failed];
  failed.clear();
  for (const reset of resets) reset();
}

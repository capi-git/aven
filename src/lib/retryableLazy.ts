import { createElement, lazy, type ComponentType } from "react";

const failed = new Set<() => void>();

/**
 * Like `React.lazy`, but a failed import is not cached forever.
 * `retryFailedLazyImports` starts each failed one over, so an error
 * boundary's Retry loads the view again instead of rethrowing the old error.
 * A view that loaded keeps its component, so retrying never remounts it.
 */
export function retryableLazy<P extends object>(
  load: () => Promise<ComponentType<P>>,
): ComponentType<P> {
  const create = () =>
    lazy(() =>
      load().then(
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
  return function RetryableLazy(props: P) {
    return createElement(Lazy as ComponentType<P>, props);
  };
}

/** Let every import that failed load again on its next render. */
export function retryFailedLazyImports() {
  const resets = [...failed];
  failed.clear();
  for (const reset of resets) reset();
}

import { Component, type ReactNode } from "react";
import { logError } from "../lib/errors";
import { retryFailedLazyImports } from "../lib/retryableLazy";
import { RotateCcw } from "./icons";

type Props = {
  children?: ReactNode;
  /** Names the view in the log, such as "terminal" or "file editor". */
  label: string;
  /** Show nothing on failure, for decoration the reader can do without. */
  quiet?: boolean;
  /** Extra classes for the failure state, such as positioning in its slot. */
  className?: string;
  /** A new value clears a failure, for a slot that now shows something else. */
  resetKey?: unknown;
};

type State = { failed: boolean; resetKey: unknown };

/**
 * Contains a view that failed to load or render, usually a lazy chunk, so
 * the rest of the window keeps working. Retry loads the view again.
 */
export class SurfaceBoundary extends Component<Props, State> {
  override state: State = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  static getDerivedStateFromProps(
    props: Props,
    state: State,
  ): Partial<State> | null {
    return props.resetKey === state.resetKey
      ? null
      : { failed: false, resetKey: props.resetKey };
  }

  override componentDidCatch(error: unknown) {
    logError(`Couldn't load the ${this.props.label} view`, error);
  }

  override componentWillUnmount() {
    // A slot that closed after a failure, such as a quiet overlay with no
    // Retry, loads its view again the next time it opens.
    if (this.state.failed) retryFailedLazyImports();
  }

  retry = () => {
    retryFailedLazyImports();
    this.setState({ failed: false });
  };

  override render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.quiet) return null;
    return (
      <div
        role="alert"
        className={`grid h-full w-full place-items-center p-6 ${this.props.className ?? ""}`.trim()}
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-ui-label text-content/60">
            Couldn’t load this view
          </p>
          <button
            type="button"
            onClick={this.retry}
            className="flex h-7 items-center gap-1.5 rounded-md bg-(--aven-control-bg) px-2.5 text-ui-label text-content hover:bg-(--aven-control-hover) active:bg-(--aven-control-pressed)"
          >
            <RotateCcw className="size-3" strokeWidth={1.75} />
            Retry
          </button>
        </div>
      </div>
    );
  }
}

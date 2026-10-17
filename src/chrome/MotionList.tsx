import { Component, createRef, type ComponentPropsWithoutRef } from "react";
import {
  captureRows,
  playRows,
  sameKeys,
  type RowSnapshot,
} from "../lib/listMotion";

type Props = ComponentPropsWithoutRef<"ul"> & {
  /** The rows' `data-motion-key`s, in order. */
  motionKeys: readonly string[];
  /** Anything else that moves rows, such as their statuses. */
  motionState?: string;
};

/**
 * A `<ul>` whose rows glide to a new place when their order, membership or
 * state changes, and whose new rows fade in (see `listMotion.ts`). A class,
 * for `getSnapshotBeforeUpdate`: the only moment React offers to read where
 * the rows are before it moves them. Renders with unchanged keys read
 * nothing.
 */
export class MotionList extends Component<Props> {
  private list = createRef<HTMLUListElement>();

  override getSnapshotBeforeUpdate(previous: Props): RowSnapshot | null {
    if (
      sameKeys(previous.motionKeys, this.props.motionKeys) &&
      previous.motionState === this.props.motionState
    )
      return null;
    return captureRows(
      this.list.current,
      previous.motionKeys,
      this.props.motionKeys,
    );
  }

  override componentDidUpdate(
    _previous: Props,
    _state: unknown,
    snapshot: RowSnapshot | null,
  ) {
    if (snapshot) playRows(this.list.current, snapshot);
  }

  override render() {
    const { motionKeys: _keys, motionState: _state, ...rest } = this.props;
    return <ul ref={this.list} {...rest} />;
  }
}

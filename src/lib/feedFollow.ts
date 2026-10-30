/**
 * A feed that follows its newest entry while you're at the bottom, and
 * leaves you where you are while you read further up: what arrives then is
 * counted for an "N new" pill instead. Pure, so the rule can be tested
 * without a browser's layout.
 */

/** How near the bottom still counts as at the bottom, in pixels. */
export const FEED_BOTTOM_SLACK = 24;

export type FeedMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

export function atFeedBottom(metrics: FeedMetrics): boolean {
  return (
    metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <=
    FEED_BOTTOM_SLACK
  );
}

export type FeedFollow = {
  /** You're at (or near) the bottom: new entries keep it there. */
  following: boolean;
  /** Entries that arrived while you were reading further up. */
  unseen: number;
};

export const FEED_FOLLOW_START: FeedFollow = { following: true, unseen: 0 };

/** You scrolled: back at the bottom, nothing is unseen any more. */
export function feedScrolled(
  state: FeedFollow,
  metrics: FeedMetrics,
): FeedFollow {
  const following = atFeedBottom(metrics);
  if (following)
    return state.following && !state.unseen ? state : FEED_FOLLOW_START;
  return state.following ? { following: false, unseen: state.unseen } : state;
}

/**
 * `added` entries arrived. Following: scroll to the newest. Reading further
 * up: stay put, and count them.
 */
export function feedGrew(
  state: FeedFollow,
  added: number,
): { state: FeedFollow; scrollToBottom: boolean } {
  if (added <= 0) return { state, scrollToBottom: false };
  if (state.following) return { state, scrollToBottom: true };
  return {
    state: { following: false, unseen: state.unseen + added },
    scrollToBottom: false,
  };
}

/** "3 new ↓". */
export function unseenLabel(count: number): string {
  return `${count} new ↓`;
}

/** A long entry folds to about four lines, with Show more. */
export const FEED_FOLD_CHARS = 280;
export const FEED_FOLD_LINES = 4;

export function feedEntryFolds(text: string): boolean {
  return (
    text.length > FEED_FOLD_CHARS || text.split("\n").length > FEED_FOLD_LINES
  );
}

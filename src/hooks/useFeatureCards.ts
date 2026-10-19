import { useEffect, useSyncExternalStore } from "react";
import {
  featureBoardState,
  loadFeatureCards,
  subscribeFeatureCards,
  type FeatureBoardState,
} from "../lib/featureCards";

const noSubscription = () => () => {};

/**
 * A project's board cards while `live`. A board coming on screen reads them
 * again, so a card added from another window shows; a hidden board keeps
 * what it last drew.
 */
export function useFeatureCards(
  project: string,
  live = true,
): FeatureBoardState {
  useEffect(() => {
    if (live) void loadFeatureCards(project, { refresh: true });
  }, [project, live]);
  const read = () => featureBoardState(project);
  return useSyncExternalStore(
    live ? subscribeFeatureCards : noSubscription,
    read,
    read,
  );
}

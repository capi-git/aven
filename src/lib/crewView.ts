/**
 * A team member's one word, most urgent first: Needs you, Ready, Working,
 * then Paused or Watching. Agent marks take their state from it.
 */
export type CrewStatus =
  "needs-you" | "ready" | "working" | "watching" | "paused";

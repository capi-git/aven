import { EVERY_DAY, WEEKDAYS, type ScheduleRule } from "./scheduledAgents";

/**
 * Ready-made automations offered in the Automations view. Choosing one fills
 * in the name, prompt and timing; the project, agent, model and access level
 * keep the editor's usual defaults so the user picks them.
 *
 * Prompts are safe by default: they read, summarise and propose. Anything
 * that changes shared state (pushing, merging, posting, deleting) is left to
 * the user.
 */
export type AutomationExample = {
  id: string;
  name: string;
  /** One line shown on the example card. */
  summary: string;
  prompt: string;
  schedule: ScheduleRule;
};

const MONDAY = 1;
const FRIDAY = 5;

export const AUTOMATION_EXAMPLES: readonly AutomationExample[] = [
  {
    id: "morning-briefing",
    name: "Morning briefing",
    summary: "What changed since yesterday and what needs attention first.",
    prompt: [
      "Give me a short morning briefing for this project.",
      "",
      "Summarise what changed since yesterday morning: new commits on the main branch, pull requests that were opened, updated or are waiting for review, and any failing or flaky checks.",
      "",
      "End with a short list of what needs my attention first, most urgent at the top, and say why.",
      "",
      "This is read-only: do not change files, push, merge, comment or close anything.",
    ].join("\n"),
    schedule: { kind: "weekly", days: WEEKDAYS, time: "08:30" },
  },
  {
    id: "nightly-tests",
    name: "Nightly test run",
    summary: "Run the tests and propose a fix on a branch if anything fails.",
    prompt: [
      "Run this project's test suite.",
      "",
      "If everything passes, say so in one line.",
      "",
      "If anything fails, find the most likely cause. Create a new local branch named nightly-fix/<short-description>, make the smallest fix you are confident in, and run the tests again. Report what failed, why, and what you changed.",
      "",
      "Do not push, merge or open a pull request, and do not touch the main branch. If you are not confident in a fix, describe the options instead of changing code.",
    ].join("\n"),
    schedule: { kind: "weekly", days: EVERY_DAY, time: "02:00" },
  },
  {
    id: "dependency-check",
    name: "Dependency check",
    summary: "Find outdated or vulnerable packages and prepare safe updates.",
    prompt: [
      "Check this project's dependencies for outdated or vulnerable packages.",
      "",
      "Summarise what you found, grouped by risk: security issues first, then major, minor and patch updates.",
      "",
      "On a new local branch named deps/<date>, apply only patch and minor updates that you judge safe, then run the tests. Keep the update only if the tests pass. Leave major upgrades as a list with notes on what might break.",
      "",
      "Do not push, merge or open a pull request.",
    ].join("\n"),
    schedule: { kind: "weekly", days: [MONDAY], time: "09:00" },
  },
  {
    id: "issue-triage",
    name: "Issue triage",
    summary: "Suggest labels and priority for new GitHub issues.",
    prompt: [
      "Review the GitHub issues opened in this repository since the last weekday.",
      "",
      "For each one, suggest labels and a priority (high, medium or low) with a one-line reason. Point out likely duplicates.",
      "",
      "For issues missing information needed to act on them, draft a short, friendly reply asking for it.",
      "",
      "Only report back to me. Do not post comments, apply labels, assign, or close anything.",
    ].join("\n"),
    schedule: { kind: "weekly", days: WEEKDAYS, time: "09:00" },
  },
  {
    id: "weekly-changelog",
    name: "Weekly changelog",
    summary: "Draft plain-language release notes from this week's changes.",
    prompt: [
      "Draft release notes for the changes merged into the main branch over the past 7 days.",
      "",
      "Write in plain language for people who use the product, not for developers. Group the notes into New, Improved and Fixed, and leave out internal refactors unless they change behaviour.",
      "",
      "List anything you were unsure how to describe at the end.",
      "",
      "Only show me the draft. Do not edit files, commit, tag, push or publish anything.",
    ].join("\n"),
    schedule: { kind: "weekly", days: [FRIDAY], time: "16:00" },
  },
  {
    id: "stale-todos-docs",
    name: "Stale TODOs and docs",
    summary: "Spot recent TODOs and docs that no longer match the code.",
    prompt: [
      "Look for two kinds of loose ends in this project.",
      "",
      "1. TODO and FIXME comments added in the last day or so (use the git history to tell what is new).",
      "2. Documentation, README sections or code comments that no longer match what the code does.",
      "",
      "For each, give the file and a concrete suggested fix. Keep the list short and skip anything trivial.",
      "",
      "Do not change any files.",
    ].join("\n"),
    schedule: { kind: "interval", hours: 24 },
  },
];

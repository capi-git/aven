import { describe, expect, it } from "vitest";
import { AUTOMATION_EXAMPLES } from "./automationExamples";
import {
  describeSchedule,
  nextRunAt,
  normalizeScheduleRule,
} from "./scheduledAgents";

describe("automation examples", () => {
  it("offers the six starting points", () => {
    expect(AUTOMATION_EXAMPLES.map((example) => example.name)).toEqual([
      "Morning briefing",
      "Nightly test run",
      "Dependency check",
      "Issue triage",
      "Weekly changelog",
      "Stale TODOs and docs",
    ]);
  });

  it.each(AUTOMATION_EXAMPLES.map((example) => [example.name, example]))(
    "%s has a name, prompt and a schedule that runs",
    (_, example) => {
      expect(example.id).toMatch(/^[a-z0-9-]+$/);
      expect(example.name.trim()).not.toBe("");
      expect(example.summary.trim()).not.toBe("");
      expect(example.prompt.trim()).not.toBe("");
      // Stored rules are cleaned on load; an example must survive that as is.
      expect(normalizeScheduleRule(example.schedule)).toEqual(example.schedule);
      expect(nextRunAt(example.schedule, new Date(2026, 9, 6, 12))).not.toBe(
        null,
      );
    },
  );

  it("keeps every prompt from changing shared state on its own", () => {
    for (const example of AUTOMATION_EXAMPLES)
      expect(example.prompt).toMatch(/do not|only/i);
  });

  it("uses unique ids", () => {
    const ids = AUTOMATION_EXAMPLES.map((example) => example.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("describes the intended timings", () => {
    expect(
      AUTOMATION_EXAMPLES.map((example) => describeSchedule(example.schedule)),
    ).toEqual([
      "Weekdays at 08:30",
      "Every day at 02:00",
      "Mon at 09:00",
      "Weekdays at 09:00",
      "Fri at 16:00",
      "Every 24 hours",
    ]);
  });
});

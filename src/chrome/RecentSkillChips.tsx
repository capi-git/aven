import { memo } from "react";
import type { Skill } from "../lib/skills";

/** How many recently used skills the empty composer offers. */
export const RECENT_SKILL_CHIPS = 4;

/**
 * The project's most recently used skills, offered while the message is
 * empty. Choosing one starts the message with it, as the `/` picker does.
 * Memoized: the composer renders on every keystroke, these chips do not.
 */
export const RecentSkillChips = memo(function RecentSkillChips({
  skills,
  onPick,
}: {
  skills: readonly Skill[];
  onPick: (skill: Skill) => void;
}) {
  if (skills.length === 0) return null;
  return (
    <div
      role="group"
      aria-label="Recent skills"
      data-recent-skills
      className="composer-recent-skills"
    >
      {skills.map((skill) => (
        <button
          key={skill.invocation}
          type="button"
          aria-label={`Use /${skill.invocation}`}
          title={
            skill.description
              ? `/${skill.invocation}: ${skill.description}`
              : `/${skill.invocation}`
          }
          // Keep the caret in the message field.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(skill)}
          className="composer-recent-skill"
        >
          <span className="composer-recent-skill-slash" aria-hidden="true">
            /
          </span>
          <span className="min-w-0 truncate">{skill.invocation}</span>
        </button>
      ))}
    </div>
  );
});

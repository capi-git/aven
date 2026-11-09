import { memo } from "react";
import type { AvosHelperMark } from "../lib/avos";
import { CrewCritter } from "./CrewCritter";
import "./AvosHelperMarks.css";

/** At most this many faces; the rest as "+2". */
const SHOWN = 3;

/**
 * Avos's helpers at work, as small faces beside Avos: in the sidebar row
 * and on its tab. A helper that just started pops out from Avos's side
 * (`.avos-helper-mark` animates as it mounts), so handing work off reads
 * as Avos doing it. Each face says its own state: working, needs you,
 * ready.
 */
export const AvosHelperMarks = memo(function AvosHelperMarks({
  path,
  helpers,
  stacked = false,
}: {
  path: string;
  helpers: readonly AvosHelperMark[];
  /** Overlapping, to stay narrow (a tab). */
  stacked?: boolean;
}) {
  if (!helpers.length) return null;
  const shown = helpers.slice(0, SHOWN);
  const more = helpers.length - shown.length;
  return (
    <span
      className="avos-helper-marks"
      data-stacked={stacked || undefined}
      data-avos-helpers={helpers.length}
      aria-label={`${helpers.length} ${helpers.length === 1 ? "helper" : "helpers"} at work`}
    >
      {shown.map((helper) => (
        <span
          key={helper.id}
          className="avos-helper-mark"
          data-avos-helper-mark={helper.id}
          data-state={helper.state}
        >
          <CrewCritter
            path={path}
            role={helper.role}
            {...(helper.critter ? { critter: helper.critter } : {})}
            state={helper.state}
            className="avos-helper-mark-face"
          />
        </span>
      ))}
      {more > 0 ? <span className="avos-helper-more">+{more}</span> : null}
    </span>
  );
});

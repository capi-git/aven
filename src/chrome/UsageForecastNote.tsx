import {
  formatForecastShort,
  usageOutlook,
  type UsagePace,
} from "../lib/usageForecast";
import "./UsageForecastNote.css";

/**
 * One window's projection as a quiet line under its reading: how long the
 * limit lasts at this pace (amber when it comes soon), or that the window
 * resets first. Nothing when there is not enough to tell.
 */
export function UsageForecastNote({
  pace,
  now,
}: {
  pace: UsagePace | undefined;
  now: number;
}) {
  const outlook = usageOutlook(pace, now);
  if (!outlook) return null;
  return (
    <span className="usage-forecast-note" data-state={outlook.state}>
      {outlook.state === "clear"
        ? "Lasts until reset at this pace"
        : formatForecastShort(outlook)}
    </span>
  );
}

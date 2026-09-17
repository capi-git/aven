import { memo, useEffect, useState } from "react";
import { HARNESS_TITLE, type HarnessId } from "../lib/session";
import { HarnessIcon } from "./HarnessIcon";
import "./ProviderMarks.css";

/** Reuses the provider artwork; animation is CSS-only and only for busy tasks. */
export const ProviderMarks = memo(function ProviderMarks({
  harnesses,
  busyHarnesses = [],
  dimmed = false,
}: {
  harnesses: readonly HarnessId[];
  busyHarnesses?: readonly HarnessId[];
  dimmed?: boolean;
}) {
  const [visible, setVisible] = useState(
    () => document.visibilityState !== "hidden",
  );
  const working = busyHarnesses.length > 0;
  useEffect(() => {
    if (!working) return;
    const update = () => setVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, [working]);
  const unique = [...new Set(harnesses)];
  const shown = unique.slice(0, 3);
  if (!shown.length) return null;
  const label = unique
    .map(
      (harness) =>
        `${HARNESS_TITLE[harness]}${busyHarnesses.includes(harness) ? " working" : ""}`,
    )
    .join(" + ");
  return (
    <span
      className="provider-marks"
      data-dimmed={dimmed}
      data-paused={!visible}
      role="img"
      aria-label={label}
      title={label}
    >
      {shown.map((harness) => (
        <span
          key={harness}
          className="provider-mark"
          data-provider={harness}
          data-working={busyHarnesses.includes(harness)}
        >
          <HarnessIcon harness={harness} className="provider-mark-art" />
        </span>
      ))}
      {unique.length > shown.length ? (
        <span className="provider-marks-extra">
          +{unique.length - shown.length}
        </span>
      ) : null}
    </span>
  );
});

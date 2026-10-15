import { useSyncExternalStore } from "react";
import { minuteClockNow, subscribeMinuteClock } from "../lib/minuteClock";

/** The current time, re-rendering the caller once a minute. Keep callers small. */
export function useMinuteClock(): number {
  return useSyncExternalStore(
    subscribeMinuteClock,
    minuteClockNow,
    minuteClockNow,
  );
}

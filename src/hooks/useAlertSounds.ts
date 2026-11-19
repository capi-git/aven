import { useEffect, useState } from "react";
import {
  ALERT_SOUNDS_CHANGE_EVENT,
  loadAlertSounds,
  type AlertSounds,
} from "../lib/sounds";

/** The chosen alert sounds, kept current across windows. */
export function useAlertSounds(): AlertSounds {
  const [sounds, setSounds] = useState(loadAlertSounds);
  useEffect(() => {
    const refresh = () => setSounds(loadAlertSounds());
    window.addEventListener(ALERT_SOUNDS_CHANGE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(ALERT_SOUNDS_CHANGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return sounds;
}

import { useState } from "react";
import { useAlertSounds } from "../hooks/useAlertSounds";
import { Play } from "../chrome/icons";
import { errorText } from "../lib/errors";
import type { NotificationPreferences } from "../lib/notifications";
import { SETTINGS } from "../lib/settingDefinitions";
import {
  ALERT_SOUND_BUILT_INS,
  alertSoundFor,
  chooseAlertSoundFile,
  playAlertSoundChoice,
  saveAlertSounds,
  type AlertEvent,
  type AlertSound,
  type AlertSounds,
} from "../lib/sounds";
import { Row, Select, Toggle } from "./SettingsControls";

type PreferenceKey = "needsInput" | "failures" | "finished";

const EVENTS: readonly {
  event: AlertEvent;
  preference: PreferenceKey;
  setting: (typeof SETTINGS)["alertNeedsYou" | "alertFinished" | "alertFailed"];
}[] = [
  {
    event: "needsYou",
    preference: "needsInput",
    setting: SETTINGS.alertNeedsYou,
  },
  {
    event: "finished",
    preference: "finished",
    setting: SETTINGS.alertFinished,
  },
  { event: "failed", preference: "failures", setting: SETTINGS.alertFailed },
];

const CHOOSE_FILE = "choose-file";

/**
 * One row per alert: whether it may interrupt you, and its sound. The sound
 * picker shows only while the alert is on and Sounds is on.
 */
export function AlertSoundRows({
  preferences,
  onPreference,
  soundsEnabled,
}: {
  preferences: NotificationPreferences;
  onPreference: (key: PreferenceKey, value: boolean) => void;
  soundsEnabled: boolean;
}) {
  const sounds = useAlertSounds();
  return (
    <>
      {EVENTS.map(({ event, preference, setting }) => (
        <AlertSoundRow
          key={event}
          event={event}
          setting={setting}
          on={preferences[preference]}
          onChange={(value) => onPreference(preference, value)}
          sounds={sounds}
          soundsEnabled={soundsEnabled}
        />
      ))}
    </>
  );
}

function AlertSoundRow({
  event,
  setting,
  on,
  onChange,
  sounds,
  soundsEnabled,
}: {
  event: AlertEvent;
  setting: (typeof EVENTS)[number]["setting"];
  on: boolean;
  onChange: (value: boolean) => void;
  sounds: AlertSounds;
  soundsEnabled: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const sound = alertSoundFor(event, sounds);
  const file = sounds.files[event];
  const options = [
    { value: "none", label: "None" },
    ...ALERT_SOUND_BUILT_INS.map(({ value, label }) => ({ value, label })),
    ...(file ? [{ value: "file", label: file.name }] : []),
    { value: CHOOSE_FILE, label: "Choose file…" },
  ];
  const choose = async () => {
    try {
      const picked = await chooseAlertSoundFile(event);
      if (!picked) return;
      saveAlertSounds({ [event]: "file", files: { [event]: picked } });
      setError(null);
      playAlertSoundChoice("file", picked);
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  const showSound = on && soundsEnabled;
  return (
    <Row {...setting.row}>
      {showSound && error ? (
        <span className="text-ui-label text-content/45">{error}</span>
      ) : null}
      {showSound && sound !== "none" ? (
        <button
          type="button"
          className="settings-button settings-sound-play"
          aria-label={`Play ${setting.label} sound`}
          title="Play"
          onClick={() => playAlertSoundChoice(sound, file)}
        >
          <Play className="size-3" aria-hidden />
        </button>
      ) : null}
      {showSound ? (
        <div className="settings-sound-picker">
          <Select
            label={`${setting.label} sound`}
            value={sound}
            options={options}
            onChange={(value) => {
              if (value === CHOOSE_FILE) {
                void choose();
                return;
              }
              setError(null);
              const next = value as AlertSound;
              saveAlertSounds({ [event]: next });
              playAlertSoundChoice(next, file);
            }}
          />
        </div>
      ) : null}
      <Toggle label={setting.label} on={on} onChange={onChange} />
    </Row>
  );
}

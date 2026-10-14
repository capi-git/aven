import { useSyncExternalStore } from "react";

export function useSetting<T>(setting: {
  load: () => T;
  subscribe: (onChange: () => void) => () => void;
  getServerSnapshot: () => T;
}): T {
  return useSyncExternalStore(
    setting.subscribe,
    setting.load,
    setting.getServerSnapshot,
  );
}

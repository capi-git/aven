import type { SettingsSectionId } from "./settings";

/** Shared with settings rows so search always targets the rendered control. */
export function settingSearchAnchor(label: string): string {
  return `setting-${label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

type SettingCopy = {
  section: SettingsSectionId;
  label: string;
  description: string;
  rowDescription?: string;
  keywords: string;
  nativeGlass?: boolean;
};

export function defineSetting<const T extends SettingCopy>(definition: T) {
  const id = settingSearchAnchor(definition.label);
  return {
    ...definition,
    id,
    nativeGlass: definition.nativeGlass,
    row: {
      id,
      label: definition.label,
      description: definition.rowDescription ?? definition.description,
    },
  };
}

type StoredSettingDefinition<T> = {
  key: string;
  defaultValue: T;
  parse: (raw: string | null) => T;
  serialize: (value: T) => string;
  changeEvent?: string;
  eventDetail?: boolean;
  storageChanges?: boolean;
  normalizeSave?: (value: T) => T;
};

/** Storage failure keeps the default; notification still follows a save attempt. */
export function defineStoredSetting<T>(definition: StoredSettingDefinition<T>) {
  const load = (): T => {
    try {
      return definition.parse(localStorage.getItem(definition.key));
    } catch {
      return definition.defaultValue;
    }
  };
  const save = (value: T): void => {
    const next = definition.normalizeSave?.(value) ?? value;
    try {
      localStorage.setItem(definition.key, definition.serialize(next));
    } catch {
      // private mode / quota
    }
    if (typeof window === "undefined" || !definition.changeEvent) return;
    window.dispatchEvent(
      definition.eventDetail
        ? new CustomEvent<T>(definition.changeEvent, { detail: next })
        : new Event(definition.changeEvent),
    );
  };
  const subscribe = (onChange: () => void) => {
    if (typeof window === "undefined") return () => {};
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === definition.key) onChange();
    };
    if (definition.changeEvent)
      window.addEventListener(definition.changeEvent, onChange);
    if (definition.storageChanges)
      window.addEventListener("storage", onStorage);
    return () => {
      if (definition.changeEvent)
        window.removeEventListener(definition.changeEvent, onChange);
      if (definition.storageChanges)
        window.removeEventListener("storage", onStorage);
    };
  };
  return {
    ...definition,
    load,
    save,
    subscribe,
    getServerSnapshot: (): T => definition.defaultValue,
  };
}

/** Older toggles treat unknown values as false; newer ones retain the default. */
export function storedBoolean(defaultValue: boolean, invalidValue = false) {
  return {
    defaultValue,
    parse: (raw: string | null): boolean => {
      if (raw == null) return defaultValue;
      if (raw === "1" || raw === "true") return true;
      if (raw === "0" || raw === "false") return false;
      return invalidValue;
    },
    serialize: (value: boolean) => (value ? "1" : "0"),
  };
}

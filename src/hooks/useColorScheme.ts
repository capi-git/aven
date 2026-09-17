import { useEffect, useState } from "react";
import {
  isLightScheme,
  SCHEME_CHANGE_EVENT,
  type ColorScheme,
} from "../lib/appearance";

/** Subscribes to color scheme changes triggered by applyThemePreference(). */
export function useColorScheme(): ColorScheme {
  const [scheme, setScheme] = useState<ColorScheme>(() =>
    isLightScheme() ? "light" : "dark",
  );
  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<ColorScheme>).detail;
      setScheme(detail === "light" ? "light" : "dark");
    };
    window.addEventListener(SCHEME_CHANGE_EVENT, onChange);
    // A parent's layout effect may apply a workspace after this hook renders.
    setScheme(isLightScheme() ? "light" : "dark");
    return () => window.removeEventListener(SCHEME_CHANGE_EVENT, onChange);
  }, []);
  return scheme;
}

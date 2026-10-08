import { useEffect, useState } from "react";
import {
  loadBundledChangelog,
  loadedBundledChangelog,
} from "../lib/releaseNotes";

/** The bundled changelog, or null while its chunk loads ("" if it failed). */
export function useBundledChangelog(): string | null {
  const [changelog, setChangelog] = useState(loadedBundledChangelog);
  useEffect(() => {
    if (changelog !== null) return;
    let live = true;
    loadBundledChangelog().then(
      (text) => {
        if (live) setChangelog(text);
      },
      () => {
        if (live) setChangelog("");
      },
    );
    return () => {
      live = false;
    };
  }, [changelog]);
  return changelog;
}

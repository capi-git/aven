import { memo, useEffect, useMemo, useSyncExternalStore } from "react";

type Props = {
  name: string;
  isDir: boolean;
  isOpen?: boolean;
  isRoot?: boolean;
  size?: number;
};

type IconNames = typeof import("./fileIconNames");

/**
 * The Material icon pack inlines every glyph — ~1.1 MB for 16px decorations.
 * After first paint, load only its name lookup plus the SVGs common files and
 * folders use. The full SVG set loads only when a rarer
 * icon is actually shown. Until a glyph is available, hold a same-sized blank
 * so nothing reflows when it arrives.
 */
let iconNames: IconNames | null = null;
let fullSvgs: Readonly<Record<string, string>> | null = null;
let namesLoad: Promise<void> | null = null;
let fullLoad: Promise<void> | null = null;
let version = 0;
const listeners = new Set<() => void>();

function notify() {
  version += 1;
  for (const listener of listeners) listener();
}

function loadNames() {
  if (iconNames || namesLoad) return;
  namesLoad = import("./fileIconNames").then(
    (mod) => {
      iconNames = mod;
      notify();
    },
    () => {
      namesLoad = null;
    },
  );
}

function loadFullSvgs() {
  if (fullSvgs || fullLoad) return;
  fullLoad = import("material-icon-svgs").then(
    (mod) => {
      fullSvgs = mod.iconData;
      notify();
    },
    () => {
      fullLoad = null;
    },
  );
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  loadNames();
  return () => {
    listeners.delete(onStoreChange);
  };
}

function getSnapshot() {
  return version;
}

/** Filename maps to the matching Material Icon Theme icon. */
export const FileTypeIcon = memo(function FileTypeIcon({
  name,
  isDir,
  isOpen = false,
  isRoot = false,
  size = 16,
}: Props) {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const iconName = iconNames
    ? iconNames.iconNameFor(name, isDir, isOpen, isRoot)
    : "";
  const svg = iconName
    ? (iconNames?.FILE_ICON_SVGS[iconName] ?? fullSvgs?.[iconName] ?? "")
    : "";
  const needsFullSet = !!iconName && !svg && !fullSvgs;
  useEffect(() => {
    if (needsFullSet) loadFullSvgs();
  }, [needsFullSet]);
  // React compares this prop by identity. A fresh object replaces the SVG
  // subtree even when the glyph is unchanged (for example, on resize).
  const markup = useMemo(() => ({ __html: svg }), [svg]);

  if (!svg) {
    return (
      <span
        aria-hidden
        className="inline-block shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className="material-icon inline-block shrink-0 align-middle"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={markup}
    />
  );
});

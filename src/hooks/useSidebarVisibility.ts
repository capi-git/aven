import { useEffect, useState } from "react";
import { nativeBrowser } from "../lib/browser";
import { sidebarOnScreen } from "../lib/sidebarVisibility";
import { useHoverRevealPanel } from "./useHoverRevealPanel";
import { useFloatingSidebarLayer } from "./useNativeFloatingSidebar";

/**
 * How the workspace sidebar shows: docked (`pinned`), as the DOM hover peek,
 * or, where `allowNativeLayer` holds and the layer attaches, as the native
 * floating layer above live browser pages.
 *
 * The native layer's reveal state comes from `useNativeFloatingSidebar`,
 * which needs this hook's layer label first, so the caller reports it back
 * through `setFloatingSidebarRevealed`.
 */
export function useSidebarVisibility({
  pinned,
  allowNativeLayer,
}: {
  pinned: boolean;
  allowNativeLayer: boolean;
}) {
  // On macOS the hover peek is a native layer above live browser pages; the
  // DOM peek below remains for other platforms and builds without it. While
  // the sidebar is pinned its card cannot open, so the layer (a WebKit
  // process of its own) is only created once the sidebar is first unpinned;
  // the DOM peek covers the moment it takes to attach. Then it stays.
  const [layerWanted, setLayerWanted] = useState(!pinned);
  if (!pinned && !layerWanted) setLayerWanted(true);
  const floatingSidebarLayer = useFloatingSidebarLayer(
    allowNativeLayer && layerWanted,
  );
  const nativeSidebar = floatingSidebarLayer !== null;
  // Rest on the edge briefly before revealing, so a pointer passing the edge
  // does not flash the sidebar; a short grace on leave absorbs the gap
  // between the edge strip and the panel without feeling laggy.
  const sidebarHover = useHoverRevealPanel({
    pinned,
    enabled: !nativeSidebar,
    enterDelay: 150,
    leaveDelay: 90,
  });
  const [floatingSidebarRevealed, setFloatingSidebarRevealed] = useState(false);
  const sidebarShown = sidebarOnScreen({
    hoverVisible: sidebarHover.visible,
    native: nativeSidebar,
    pinned,
    floatingRevealed: floatingSidebarRevealed,
  });
  useEffect(() => {
    if (!sidebarHover.revealed) return;
    // Native pages draw above the workspace, so leaving the peek for one
    // never reaches this document as a pointer event.
    const unlisten = Promise.resolve()
      .then(() => nativeBrowser.listenPointer(sidebarHover.pointerLeft))
      .catch(() => undefined);
    return () => void unlisten.then((stop) => stop?.());
  }, [sidebarHover.revealed, sidebarHover.pointerLeft]);
  return {
    floatingSidebarLayer,
    nativeSidebar,
    sidebarHover,
    sidebarShown,
    setFloatingSidebarRevealed,
  };
}

import type { ReactNode } from "react";
import { useSidePanelOpen } from "../hooks/useSidePanelOpen";

/**
 * Renders `children` with whether the side panel is open. A toggle drawn by
 * the app goes inside it, so showing or hiding the panel redraws the toggle
 * and not the app around it.
 */
export function SidePanelOpen({
  children,
}: {
  children: (open: boolean) => ReactNode;
}) {
  return children(useSidePanelOpen());
}

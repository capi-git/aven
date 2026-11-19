import { useState } from "react";
import { useProjectAppearance } from "../hooks/useProjectAppearance";
import { appearanceTone } from "../lib/markTones";
import type { ProjectAppearance } from "../lib/projectAppearance";
import { AgentMark } from "./AgentMark";
import "./ProjectMark.css";

type Props = {
  /** Project folder; resolved through the shared appearance store. */
  path?: string | null;
  /** Already-resolved appearance, when the caller has it. */
  appearance?: ProjectAppearance | null;
  /**
   * The project is open (expanded in the sidebar). Kept for callers; the
   * mark looks the same either way.
   */
  open?: boolean;
  /**
   * The sidebar draws a project as its name alone: only a logo the person
   * chose stands before it, and nothing otherwise.
   */
  logoOnly?: boolean;
  className?: string;
};

/**
 * A project's mark: its logo when one is set, otherwise a still orb in its
 * colour. It stands for the project, so it never moves on its own. Renders nothing for folders
 * without a project identity.
 */
export function ProjectMark({
  path,
  appearance: given,
  logoOnly = false,
  className = "",
}: Props) {
  const resolved = useProjectAppearance(given === undefined ? path : null);
  const appearance = given === undefined ? resolved : given;
  // A logo file deleted outside Aven falls back to the orb.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!appearance) return null;
  const logo =
    appearance.logoSrc && appearance.logoSrc !== failedSrc
      ? appearance.logoSrc
      : null;
  if (logoOnly && !logo) return null;
  return (
    <span
      className={`project-mark ${className}`}
      data-kind={logo ? "logo" : "orb"}
      aria-hidden
    >
      {logo ? (
        <img
          key={logo}
          src={logo}
          alt=""
          draggable={false}
          className="project-mark-logo"
          onError={() => setFailedSrc(logo)}
        />
      ) : (
        <AgentMark
          tone={appearanceTone(appearance)}
          className="project-mark-orb"
        />
      )}
    </span>
  );
}

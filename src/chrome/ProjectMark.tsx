import { useState } from "react";
import { useProjectAppearance } from "../hooks/useProjectAppearance";
import type { ProjectAppearance } from "../lib/projectAppearance";
import { ProjectMascot } from "./ProjectMascot";
import "./ProjectMark.css";

type Props = {
  /** Project folder; resolved through the shared appearance store. */
  path?: string | null;
  /** Already-resolved appearance, when the caller has it. */
  appearance?: ProjectAppearance | null;
  /** Steps the mascot's two frames while an agent works. Logos stay still. */
  active?: boolean;
  className?: string;
};

/**
 * A project's mark: its logo when one is set, otherwise its pixel mascot in the
 * project colour. Renders nothing for folders without a project identity.
 */
export function ProjectMark({
  path,
  appearance: given,
  active = false,
  className = "",
}: Props) {
  const resolved = useProjectAppearance(given === undefined ? path : null);
  const appearance = given === undefined ? resolved : given;
  // A logo file deleted outside Aven falls back to the mascot.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!appearance) return null;
  const logo =
    appearance.logoSrc && appearance.logoSrc !== failedSrc
      ? appearance.logoSrc
      : null;
  return (
    <span
      className={`project-mark ${className}`}
      data-kind={logo ? "logo" : "mascot"}
      data-active={(active && !logo) || undefined}
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
        <ProjectMascot
          project={appearance.key}
          name={appearance.mascot}
          color={appearance.color}
          active={active}
          className="project-mark-mascot"
        />
      )}
    </span>
  );
}

import { useState } from "react";
import { useMascotReaction } from "../hooks/useMascotReaction";
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
  /**
   * Lets the mascot react once when one of the project's turns ends. Only
   * marks the user watches for news use it: the sidebar and Home's tiles.
   */
  reacts?: boolean;
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
  reacts = false,
  className = "",
}: Props) {
  const resolved = useProjectAppearance(given === undefined ? path : null);
  const appearance = given === undefined ? resolved : given;
  // A logo file deleted outside Aven falls back to the mascot.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const logo =
    appearance?.logoSrc && appearance.logoSrc !== failedSrc
      ? appearance.logoSrc
      : null;
  // Logos stay still, so only a mascot watches for reactions.
  const reaction = useMascotReaction(reacts && !logo ? appearance?.key : null);
  if (!appearance) return null;
  return (
    <span
      className={`project-mark ${className}`}
      data-kind={logo ? "logo" : "mascot"}
      data-active={(active && !logo && !reaction) || undefined}
      data-reaction={reaction?.kind}
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
          active={active && !reaction}
          reaction={reaction?.kind}
          reactionId={reaction?.id}
          className="project-mark-mascot"
        />
      )}
    </span>
  );
}

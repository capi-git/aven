import { useState } from "react";
import { useMascotReaction } from "../hooks/useMascotReaction";
import { useProjectAppearance } from "../hooks/useProjectAppearance";
import { appearanceSigil } from "../lib/dotSigils";
import type { ProjectAppearance } from "../lib/projectAppearance";
import { DotMark } from "./DotMark";
import "./ProjectMark.css";

type Props = {
  /** Project folder; resolved through the shared appearance store. */
  path?: string | null;
  /** Already-resolved appearance, when the caller has it. */
  appearance?: ProjectAppearance | null;
  /** Sweeps a light across the mark while an agent works. Logos stay still. */
  active?: boolean;
  /**
   * Lets the mark react once when one of the project's turns ends. Only
   * marks the user watches for news use it: the sidebar and Home's tiles.
   */
  reacts?: boolean;
  className?: string;
};

/**
 * A project's mark: its logo when one is set, otherwise its sigil in dots.
 * Renders nothing for folders without a project identity.
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
  // A logo file deleted outside Aven falls back to the sigil.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const logo =
    appearance?.logoSrc && appearance.logoSrc !== failedSrc
      ? appearance.logoSrc
      : null;
  // Logos stay still, so only a sigil watches for reactions.
  const reaction = useMascotReaction(reacts && !logo ? appearance?.key : null);
  if (!appearance) return null;
  return (
    <span
      className={`project-mark ${className}`}
      data-kind={logo ? "logo" : "mark"}
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
        <DotMark
          sigil={appearanceSigil(appearance)}
          state={active && !reaction ? "working" : "still"}
          reaction={reaction?.kind}
          reactionId={reaction?.id}
          className="project-mark-dots"
        />
      )}
    </span>
  );
}

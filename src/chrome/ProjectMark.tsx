import { useState } from "react";
import { useProjectAppearance } from "../hooks/useProjectAppearance";
import type { OrbLook } from "@yogesharc/thinking-orbs";
import { appearanceTone } from "../lib/markTones";
import type { ProjectAppearance } from "../lib/projectAppearance";
import { ThinkingOrb } from "./ThinkingOrb";
import "./ProjectMark.css";

const RESTING: OrbLook = { state: "idle" };
const WORKING: OrbLook = { state: "working" };

type Props = {
  /** Project folder; resolved through the shared appearance store. */
  path?: string | null;
  /** Already-resolved appearance, when the caller has it. */
  appearance?: ProjectAppearance | null;
  /**
   * An agent works in the project and nothing else on screen says so: the
   * orb moves. Logos stay as they are.
   */
  working?: boolean;
  /** Only a logo the person chose; nothing otherwise (Tiles draw a letter). */
  logoOnly?: boolean;
  className?: string;
};

/**
 * A project's mark: its logo when one is set, otherwise a Thinking Orb in
 * the project's colour (Customize project › colour). It rests still, and
 * moves only while `working`. Renders nothing for folders without a project
 * identity.
 */
export function ProjectMark({
  path,
  appearance: given,
  working = false,
  logoOnly = false,
  className = "",
}: Props) {
  const resolved = useProjectAppearance(given === undefined ? path : null);
  const appearance = given === undefined ? resolved : given;
  // A logo file deleted outside Aven falls back to the Stack.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!appearance) return null;
  const logo =
    appearance.logoSrc && appearance.logoSrc !== failedSrc
      ? appearance.logoSrc
      : null;
  if (logoOnly && !logo) return null;
  const tone = appearanceTone(appearance);
  return (
    <span
      className={`project-mark ${className}`}
      data-kind={logo ? "logo" : "orb"}
      data-tone={!logo && tone !== "grey" ? tone : undefined}
      data-working={!logo && working ? "" : undefined}
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
        <ThinkingOrb
          look={working ? WORKING : RESTING}
          moving={working}
          className="project-mark-orb"
        />
      )}
    </span>
  );
}

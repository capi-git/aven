import { useState } from "react";
import { useProjectAppearance } from "../hooks/useProjectAppearance";
import { appearanceTone } from "../lib/markTones";
import type { ProjectAppearance } from "../lib/projectAppearance";
import { StackMark } from "./StackMark";
import "./ProjectMark.css";

type Props = {
  /** Project folder; resolved through the shared appearance store. */
  path?: string | null;
  /** Already-resolved appearance, when the caller has it. */
  appearance?: ProjectAppearance | null;
  /**
   * The project is open (expanded in the sidebar): its Stack fans out.
   * Logos stay as they are.
   */
  open?: boolean;
  className?: string;
};

/**
 * A project's mark: its logo when one is set, otherwise its Stack, three
 * pages in its colour. It stands for the project, never its agents (they
 * are Bot), so it never moves on its own. Renders nothing for folders
 * without a project identity.
 */
export function ProjectMark({
  path,
  appearance: given,
  open = false,
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
  return (
    <span
      className={`project-mark ${className}`}
      data-kind={logo ? "logo" : "stack"}
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
        <StackMark
          tone={appearanceTone(appearance)}
          open={open}
          className="project-mark-stack"
        />
      )}
    </span>
  );
}

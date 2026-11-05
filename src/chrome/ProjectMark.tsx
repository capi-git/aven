import { useState } from "react";
import { useMascotReaction } from "../hooks/useMascotReaction";
import { useProjectAppearance } from "../hooks/useProjectAppearance";
import { appearanceSigil } from "../lib/dotSigils";
import { appearanceTone } from "../lib/markTones";
import type { ProjectAppearance } from "../lib/projectAppearance";
import { DotMark } from "./DotMark";
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
  /**
   * The mark stands for the project's agent rather than the project, as on
   * Home's agent tiles or beside a working copy: it keeps the project's
   * sigil in dots, which `active` and `reacts` move. Elsewhere a project is
   * its Stack, which stays still.
   */
  asAgent?: boolean;
  /** With `asAgent`: sweeps a light across the dots while an agent works. */
  active?: boolean;
  /**
   * With `asAgent`: lets the dots react once when one of the project's
   * turns ends. Only marks the user watches for news use it.
   */
  reacts?: boolean;
  className?: string;
};

/**
 * A project's mark: its logo when one is set, otherwise its Stack, three
 * pages in its colour. Renders nothing for folders without a project
 * identity.
 */
export function ProjectMark({
  path,
  appearance: given,
  open = false,
  asAgent = false,
  active = false,
  reacts = false,
  className = "",
}: Props) {
  const resolved = useProjectAppearance(given === undefined ? path : null);
  const appearance = given === undefined ? resolved : given;
  // A logo file deleted outside Aven falls back to the Stack.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const logo =
    appearance?.logoSrc && appearance.logoSrc !== failedSrc
      ? appearance.logoSrc
      : null;
  const dots = asAgent && !logo;
  // Only dots move, so only they watch for reactions.
  const reaction = useMascotReaction(dots && reacts ? appearance?.key : null);
  if (!appearance) return null;
  const working = dots && active && !reaction;
  return (
    <span
      className={`project-mark ${className}`}
      data-kind={logo ? "logo" : dots ? "mark" : "stack"}
      data-active={working || undefined}
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
      ) : dots ? (
        <DotMark
          sigil={appearanceSigil(appearance)}
          tone={appearanceTone(appearance)}
          state={working ? "working" : "still"}
          reaction={reaction?.kind}
          reactionId={reaction?.id}
          className="project-mark-dots"
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

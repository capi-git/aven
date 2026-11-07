import { memo, type CSSProperties } from "react";
import { HELM_WORK_DOTS, type HelmWork } from "../lib/composerHelm";
import { DOT_VIEW_BOX } from "../lib/dotSigils";
// Its look and motion, wherever it is drawn first.
import "./ComposerHelm.css";

/**
 * The work dots: a 5×5 grid drawing what an agent is doing (`HelmWork`), as
 * beside the Bot in the message box and on a working project's row. Pointed
 * at, the middle nine light as Stop over the rest when `stop` is set. Each
 * pattern is a few paths whose opacity moves; nothing runs in script.
 */
export const WorkDots = memo(function WorkDots({
  work,
  stop = false,
  className,
}: {
  work: HelmWork;
  /** The dots are the Stop button. */
  stop?: boolean;
  className?: string;
}) {
  const lit = (kind: string, paths: readonly string[]) =>
    paths.map((d, index) => (
      <path
        key={`${work}-${index}`}
        className={`helm-work-lit ${kind}`}
        d={d}
        style={{ "--i": index } as CSSProperties}
      />
    ));
  return (
    <svg
      className={className ? `helm-work-dots ${className}` : "helm-work-dots"}
      viewBox={DOT_VIEW_BOX}
      aria-hidden
      focusable="false"
    >
      <g className="helm-work-art">
        <path className="helm-work-grid" d={HELM_WORK_DOTS.grid} />
        {work === "think"
          ? lit("helm-work-ripple", HELM_WORK_DOTS.rings)
          : null}
        {work === "write" ? lit("helm-work-line", HELM_WORK_DOTS.lines) : null}
        {work === "tool"
          ? lit("helm-work-sweep", HELM_WORK_DOTS.diagonals)
          : null}
        {work === "held" ? lit("helm-work-held", [HELM_WORK_DOTS.grid]) : null}
        {work === "needs" ? (
          <path className="helm-work-bang" d={HELM_WORK_DOTS.bang} />
        ) : null}
        {/* From the outside in. */}
        {work === "stopping"
          ? lit("helm-work-out", [...HELM_WORK_DOTS.rings].reverse())
          : null}
      </g>
      {stop ? (
        <path className="helm-work-stop-dots" d={HELM_WORK_DOTS.stop} />
      ) : null}
    </svg>
  );
});

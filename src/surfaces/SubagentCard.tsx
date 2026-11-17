import { memo, useEffect, useState } from "react";
import { AgentMark, type AgentState } from "../chrome/AgentMark";
import { ChevronDown } from "../chrome/icons";
import { helperClock } from "../lib/helperAgents";
import type { Block } from "../lib/session";
import {
  subagentElapsedMs,
  subagentHeaderLine,
  subagentIsActive,
  subagentRowLine,
  subagentState,
  subagentTypeLabel,
  type SubagentState,
} from "../lib/subagentRuns";
import { visibleInterval } from "../lib/visibleInterval";
import { AgentMarkdown } from "./AgentMarkdown";
import "./SubagentCard.css";

/** A clock that moves once a second while `running`, and only while seen. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    return visibleInterval(() => setNow(Date.now()), 1000);
  }, [running]);
  return now;
}

function markState(state: SubagentState): AgentState {
  if (subagentIsActive(state)) return "working";
  if (state === "failed") return "needs";
  return "still";
}

/**
 * The subagents a chat started side by side, as one card: the count and how
 * many still run, the longest time among them, then a row each with its
 * name, what it is doing now, its agent type and its own time. A finished
 * row opens on click to show what the subagent reported back.
 */
export const SubagentCard = memo(function SubagentCard({
  blocks,
  live,
  cwd,
  onOpenFile,
}: {
  blocks: Block[];
  /** The turn still runs. */
  live: boolean;
  cwd?: string;
  onOpenFile?: (path: string) => void;
}) {
  const states = blocks.map((block) => subagentState(block, live));
  const running = states.some(subagentIsActive);
  const now = useNow(running);
  const [folded, setFolded] = useState(false);
  const times = blocks.map((block, index) =>
    subagentElapsedMs(block, states[index], now),
  );
  const longest = times.reduce<number | undefined>(
    (max, ms) => (ms === undefined ? max : Math.max(max ?? 0, ms)),
    undefined,
  );
  const count = blocks.length;
  const name = count === 1 ? "1 subagent" : `${count} subagents`;
  const line = subagentHeaderLine(states);

  return (
    <div
      className="subagent-card"
      data-subagent-card
      data-running={running || undefined}
    >
      <button
        type="button"
        className="subagent-card-head"
        aria-expanded={!folded}
        aria-label={folded ? `Show the ${name}` : `Hide the ${name}`}
        onClick={() => setFolded((value) => !value)}
      >
        <AgentMark
          state={running ? "working" : "still"}
          className="subagent-card-mark"
        />
        <span className="subagent-card-name">{name}</span>
        {line ? <span className="subagent-card-line">{line}</span> : null}
        {longest !== undefined ? (
          <span className="subagent-card-time">{helperClock(longest)}</span>
        ) : null}
        <ChevronDown
          className="subagent-card-chevron size-3.5"
          data-folded={folded || undefined}
          strokeWidth={1.75}
        />
      </button>
      {folded
        ? null
        : blocks.map((block, index) => (
            <SubagentRow
              key={block.id}
              block={block}
              state={states[index]}
              elapsedMs={times[index]}
              cwd={cwd}
              onOpenFile={onOpenFile}
            />
          ))}
    </div>
  );
});

function SubagentRow({
  block,
  state,
  elapsedMs,
  cwd,
  onOpenFile,
}: {
  block: Block;
  state: SubagentState;
  elapsedMs?: number;
  cwd?: string;
  onOpenFile?: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const title = block.text || block.tool?.title || "Subagent";
  const line = subagentRowLine(block, state);
  const typeLabel = subagentTypeLabel(block.tool?.agentType);
  // Codex names a subagent by its type ("Worker subagent"): say it once.
  const type = title.toLowerCase().includes(typeLabel.toLowerCase())
    ? ""
    : typeLabel;
  // What it reported back, once it is done; while it runs the detail is its
  // latest step, which the line already says in plain words.
  const report = subagentIsActive(state) ? "" : (block.tool?.detail ?? "");
  const canOpen = report.trim().length > 0;
  const content = (
    <>
      <AgentMark state={markState(state)} className="subagent-row-mark" />
      <span className="subagent-row-name" title={title}>
        {title}
      </span>
      <span
        className="subagent-row-line"
        data-state={state}
        title={line || undefined}
      >
        {line}
      </span>
      {type ? <span className="subagent-row-type">{type}</span> : null}
      <span className="subagent-row-time">
        {elapsedMs !== undefined ? helperClock(elapsedMs) : ""}
      </span>
    </>
  );

  return (
    <div className="subagent-row" data-subagent-row data-subagent-state={state}>
      {canOpen ? (
        <button
          type="button"
          className="subagent-row-head"
          aria-expanded={open}
          aria-label={
            open ? `Hide what ${title} reported` : `Show what ${title} reported`
          }
          onClick={() => setOpen((value) => !value)}
        >
          {content}
        </button>
      ) : (
        <div className="subagent-row-head">{content}</div>
      )}
      {open && canOpen ? (
        <div className="subagent-row-report">
          <AgentMarkdown text={report} cwd={cwd} onOpenFile={onOpenFile} />
        </div>
      ) : null}
    </div>
  );
}

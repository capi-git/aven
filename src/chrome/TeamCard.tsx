import {
  memo,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import {
  memberVoice,
  providerShortName,
  teamMascots,
  type DiscussionVoice,
} from "../lib/discussionVoices";
import type { HarnessId } from "../lib/session";
import type { TeamKind } from "../lib/teamRuns";
import { visibleInterval } from "../lib/visibleInterval";
import { useMotionOnChange } from "../hooks/useMotionOnChange";
import { RoleBadge } from "./AgentRoles";
import { DiscussionAvatar } from "./DiscussionAvatar";
import "./TeamCard.css";

/**
 * One card family for a team in the chat it started from: a discussion's
 * live card, a race's lanes and result, an orchestration's agents and
 * result. Each reads the same way: a header with the members' mascots, the
 * title and a badge, a status line, a row per member, and actions at the
 * bottom. The cards render only `TeamRun` data, never transcripts.
 */
export type TeamCardTone = "live" | "needs-you" | "ready" | "done" | "stopped";

/** The members' mascots on tiles; two are linked as a pair. */
export function TeamFaces({
  voices,
  typing = [],
}: {
  voices: readonly DiscussionVoice[];
  /** Members whose mascot steps, as it does while that side is typing. */
  typing?: readonly string[];
}) {
  const pair = voices.length === 2;
  return (
    <span className="team-card-faces" data-pair={pair || undefined} aria-hidden>
      {voices.map((voice, index) => (
        <span key={voice.sessionId} className="team-card-face">
          {pair && index === 1 ? (
            <span className="team-card-link">
              <i />
              <i />
              <i />
            </span>
          ) : null}
          <span
            className="team-card-tile"
            style={{ "--discussion-voice": voice.color } as CSSProperties}
          >
            <DiscussionAvatar
              voice={voice}
              typing={typing.includes(voice.sessionId)}
            />
          </span>
        </span>
      ))}
    </span>
  );
}

export function TeamCard({
  kind,
  tone,
  faces,
  title,
  badge,
  status,
  statusTitle,
  members,
  actions,
  children,
  attributes,
  accent,
  bare = false,
}: {
  kind: TeamKind;
  tone: TeamCardTone;
  faces: ReactNode;
  title: ReactNode;
  badge?: ReactNode;
  /** The status line under the title. */
  status?: ReactNode;
  statusTitle?: string;
  /** One row per member (`TeamCardMember`). */
  members?: ReactNode;
  /** At the bottom, left to right. */
  actions?: ReactNode;
  /** Between the rows and the actions. */
  children?: ReactNode;
  /** Data attributes the card's own checks look for. */
  attributes?: Record<string, string | undefined>;
  /** The colour its live badge glows in; the theme's accent otherwise. */
  accent?: string;
  /** Inside a turn's own padded row, as an orchestration's card is. */
  bare?: boolean;
}) {
  // A changed count or status word rolls into place.
  const badgeRef = useRef<HTMLSpanElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  useMotionOnChange(badgeRef, typeof badge === "string" ? badge : undefined);
  useMotionOnChange(statusRef, typeof status === "string" ? status : undefined);
  return (
    <div className={bare ? undefined : "team-card-row"}>
      <div
        className="team-card"
        data-team-card={kind}
        data-state={tone}
        style={
          accent ? ({ "--team-accent": accent } as CSSProperties) : undefined
        }
        {...attributes}
      >
        <div className="team-card-head">
          {faces}
          <div className="team-card-heading">
            <div className="team-card-title-line">
              <span
                className="team-card-title"
                title={typeof title === "string" ? title : undefined}
              >
                {title}
              </span>
              {badge ? (
                <span
                  ref={badgeRef}
                  className="team-card-badge"
                  data-tone={tone}
                >
                  {badge}
                </span>
              ) : null}
            </div>
            {status ? (
              <div
                ref={statusRef}
                className="team-card-status"
                title={statusTitle}
              >
                {status}
              </div>
            ) : null}
          </div>
        </div>
        {members ? <ul className="team-card-members">{members}</ul> : null}
        {children}
        {actions ? <div className="team-card-actions">{actions}</div> : null}
      </div>
    </div>
  );
}

/** One member's row: its mascot, name, what it is doing, state and numbers. */
export const TeamCardMember = memo(function TeamCardMember({
  voice,
  name,
  nameTitle = voice.fullName || name,
  detail,
  state,
  tone,
  meta,
  onOpen,
  attributes,
}: {
  voice: DiscussionVoice;
  name: string;
  /** The name's tooltip: the agent's full name ("Claude Code · Opus 4.6"). */
  nameTitle?: string;
  /** A second line: what it is doing, or its result. */
  detail?: string;
  state: string;
  tone?: "live" | "needs-you" | "done" | "failed" | "muted";
  /** Numbers on the right: time, lines changed, files. */
  meta?: ReactNode;
  /** Opens the member's chat. */
  onOpen?: () => void;
  attributes?: Record<string, string | undefined>;
}) {
  const body = (
    <>
      <span
        className="team-card-member-face"
        style={{ "--discussion-voice": voice.color } as CSSProperties}
        aria-hidden
      >
        <DiscussionAvatar voice={voice} typing={tone === "live"} />
      </span>
      <span className="team-card-member-text">
        {voice.role ? (
          // The role it was brought in with, beside its name.
          <span className="team-card-member-line">
            <span className="team-card-member-name" title={nameTitle}>
              {name}
            </span>
            <RoleBadge role={voice.role} />
          </span>
        ) : (
          <span className="team-card-member-name" title={nameTitle}>
            {name}
          </span>
        )}
        {detail ? (
          <span className="team-card-member-detail" title={detail}>
            {detail}
          </span>
        ) : null}
      </span>
      <span className="team-card-member-state" data-tone={tone}>
        {state}
      </span>
      {meta ? <span className="team-card-member-meta">{meta}</span> : null}
    </>
  );
  return (
    <li className="team-card-member" {...attributes}>
      {onOpen ? (
        <button
          type="button"
          className="team-card-member-open"
          title={`Open “${voice.title}”`}
          onClick={onOpen}
        >
          {body}
        </button>
      ) : (
        <span className="team-card-member-open">{body}</span>
      )}
    </li>
  );
});

/**
 * The team family's one button: on the cards, in the message-box bar
 * (`compact`), in the floating panel and on the board.
 */
export function TeamCardButton({
  variant = "default",
  size = "regular",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost" | "needs-you";
  size?: "regular" | "compact";
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      type="button"
      className={`team-card-button aven-press ${className}`}
      data-variant={variant === "default" ? undefined : variant}
      data-size={size === "compact" ? "compact" : undefined}
      {...props}
    />
  );
}

/** "4:05": minutes and seconds. */
export function clockText(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * A member's clock: its turn's length once ended, else the time since it
 * started, ticking once a second while shown. Only this leaf re-renders.
 */
export function MemberClock({
  startedAt,
  durationMs,
  running,
}: {
  startedAt?: number;
  durationMs?: number;
  running: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!running || startedAt == null) return;
    return visibleInterval(() => setNow(Date.now()), 1000);
  }, [running, startedAt]);
  const ms =
    !running && durationMs != null
      ? durationMs
      : startedAt != null
        ? now - startedAt
        : undefined;
  if (ms == null || !Number.isFinite(ms)) return null;
  return (
    <span className="team-card-clock" role="timer" aria-live="off">
      {clockText(Math.max(0, Math.round(ms / 1000)))}
    </span>
  );
}

/** "+12 −3" in the diff colours. */
export function LineChanges({
  additions,
  deletions,
}: {
  additions?: number;
  deletions?: number;
}) {
  if (additions == null && deletions == null) return null;
  return (
    <span className="team-card-lines">
      <span data-sign="add">+{additions ?? 0}</span>{" "}
      <span data-sign="del">−{deletions ?? 0}</span>
    </span>
  );
}

/**
 * A team's members as small overlapping mascots, for a row that stands for
 * the whole team (Home, Activity, the sidebar).
 */
export const TeamMiniFaces = memo(function TeamMiniFaces({
  members,
  active = false,
}: {
  members: readonly { sessionId: string; harness: HarnessId }[];
  /** The mascots step, as a working chat's does. */
  active?: boolean;
}) {
  const mascots = teamMascots(members.map((member) => member.sessionId));
  return (
    <span className="team-mini-faces" aria-hidden>
      {members.slice(0, 4).map((member, index) => (
        <DiscussionAvatar
          key={member.sessionId}
          voice={memberVoice(
            {
              sessionId: member.sessionId,
              harness: member.harness,
              label: providerShortName(member.harness),
              stateLabel: "",
            },
            mascots[index],
            index === 0,
          )}
          typing={active}
        />
      ))}
    </span>
  );
});

import { memo, useEffect, useState } from "react";
import { BotCritter } from "../chrome/BotCritter";
import { useProjectAppearance } from "../hooks/useProjectAppearance";
import { useProjectBotName } from "../hooks/useProjectBotName";
import { logError } from "../lib/errors";
import { projectName } from "../lib/paths";
import {
  applyBotFix,
  discardBotFix,
  setBotPaused,
  useBotWorkspace,
} from "../lib/projectBotActions";
import { botCopyHost } from "../lib/projectBotCopy";
import { fixForTurn, useProjectBot, type BotFix } from "../lib/projectBots";
import { buildUnifiedFile } from "../lib/unifiedDiff";
import { UnifiedDiffView, type UnifiedDiffFileModel } from "./UnifiedDiffView";
import "../chrome/TeamCard.css";
import "./BotChat.css";

/**
 * A project bot's chat: its header, what it says before its first post, the
 * small tag each wake-up shows instead of a message, the one quiet line a
 * check with nothing to report folds into, and the card for a fix it made.
 */

function useBotName(path: string): { name: string; project: string } {
  const appearance = useProjectAppearance(path);
  return {
    name: useProjectBotName(path) ?? "",
    project: appearance?.label || projectName(path),
  };
}

/** Critter, name, whose bot it is, Pause and Settings. */
export const BotChatHeader = memo(function BotChatHeader({
  path,
  working,
}: {
  path: string;
  working: boolean;
}) {
  const bot = useProjectBot(path);
  const { name, project } = useBotName(path);
  const workspace = useBotWorkspace();
  const paused = !!bot?.paused;
  return (
    <header className="bot-chat-header" data-bot-header={path}>
      <BotCritter path={path} active={working} className="bot-chat-critter" />
      <div className="bot-chat-heading">
        <span className="bot-chat-name">{name}</span>
        <span className="bot-chat-whose">
          {project}'s bot{paused ? " · Paused" : ""}
        </span>
      </div>
      <div className="bot-chat-actions">
        <button
          type="button"
          className="team-card-button"
          onClick={() => setBotPaused(path, !paused)}
          disabled={!bot?.on}
        >
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          type="button"
          className="team-card-button"
          onClick={() => workspace?.openSettings(path)}
          disabled={!workspace}
        >
          Settings
        </button>
      </div>
    </header>
  );
});

/** What an empty bot chat says: who it is and when it posts. */
export function BotIntro({ path }: { path: string }) {
  const { name, project } = useBotName(path);
  return (
    <div className="bot-chat-intro">
      <BotCritter path={path} className="bot-chat-intro-critter" />
      <p className="bot-chat-intro-title">
        {name} is watching {project}
      </p>
      <p className="bot-chat-intro-text">
        When a chat finishes or the dev server crashes, it checks what changed
        in its own copy and posts here. You can message it too.
      </p>
    </div>
  );
}

function clock(at: number | undefined): string {
  return at
    ? new Date(at).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
}

/** A wake-up's tag, in place of the message the bot was sent. */
export function BotWakeTag({ label, at }: { label: string; at?: number }) {
  return (
    <div className="bot-wake-tag" data-bot-wake>
      <span className="bot-wake-label">{label}</span>
      {at ? <span className="bot-wake-time">{clock(at)}</span> : null}
    </div>
  );
}

/** A wake-up with nothing to report, folded into one quiet line. */
export function BotCheckedRow({ label, at }: { label: string; at?: number }) {
  return (
    <div className="bot-wake-tag" data-bot-checked>
      <span className="bot-wake-label">{label}</span>
      <span className="bot-checked">Checked · nothing to report</span>
      {at ? <span className="bot-wake-time">{clock(at)}</span> : null}
    </div>
  );
}

function filesWord(count: number): string {
  return `${count} ${count === 1 ? "file" : "files"}`;
}

function fixLine(fix: BotFix): string {
  switch (fix.state) {
    case "ready":
      return `Fix ready · ${filesWord(fix.files)}`;
    case "applied":
      return `Applied to your files · ${filesWord(fix.files)}`;
    case "discarded":
      return `Thrown away · ${filesWord(fix.files)}`;
    default:
      return "No longer in its copy";
  }
}

/** The changes, read from the bot's copy when Review is pressed. */
function FixReview({ path, fix }: { path: string; fix: BotFix }) {
  const bot = useProjectBot(path);
  const copy = bot?.copy?.path;
  const [files, setFiles] = useState<UnifiedDiffFileModel[] | null>(null);
  useEffect(() => {
    if (!copy) return;
    let live = true;
    void (async () => {
      const diff = await botCopyHost.diff(copy, fix.base);
      const models = await Promise.all(
        diff.files.slice(0, 30).map(async (file) => {
          const texts = await botCopyHost
            .fileDiff(copy, fix.base, file.path)
            .catch(() => null);
          const unreadable =
            !texts ||
            file.binary ||
            (texts.original == null && file.status !== "added") ||
            (texts.current == null && file.status !== "deleted");
          const unified = unreadable
            ? null
            : buildUnifiedFile(texts.original ?? "", texts.current ?? "");
          return {
            id: file.path,
            path: file.path,
            label: file.path,
            binary: file.binary,
            emptyMessage: unreadable
              ? "No text preview for this file."
              : undefined,
            additions: unified?.additions ?? file.additions,
            deletions: unified?.deletions ?? file.deletions,
            blocks: unified?.blocks ?? [],
          } satisfies UnifiedDiffFileModel;
        }),
      );
      if (live) setFiles(models);
    })().catch((error) => {
      logError("Bot fix review", error);
      if (live) setFiles([]);
    });
    return () => {
      live = false;
    };
  }, [copy, fix.base, fix.files, fix.additions, fix.deletions]);
  if (!files) return <p className="bot-fix-note">Reading its changes…</p>;
  if (!files.length)
    return <p className="bot-fix-note">Couldn't read its changes.</p>;
  return (
    <div className="bot-fix-review">
      <UnifiedDiffView
        files={files}
        fill={false}
        fileLayout="cards"
        initialExpansion="all"
      />
    </div>
  );
}

/** The fix a bot turn made: Review, Apply and Throw away, one line. */
export function BotFixCard({ path, turnId }: { path: string; turnId: string }) {
  const bot = useProjectBot(path);
  const fix = fixForTurn(bot, turnId);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState<"apply" | "discard" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  if (!fix) return null;
  const ready = fix.state === "ready";
  const act = async (kind: "apply" | "discard") => {
    setBusy(kind);
    setProblem(null);
    const error =
      kind === "apply"
        ? await applyBotFix(path, fix.id)
        : await discardBotFix(path, fix.id);
    setBusy(null);
    if (error) setProblem(error);
    else setReviewing(false);
  };
  const shownProblem = problem ?? (ready ? fix.error : undefined);
  return (
    <div className="bot-fix-row" data-bot-fix={fix.state}>
      <div className="team-card bot-fix-card" data-state={fix.state}>
        <div className="bot-fix-line">
          <span className="bot-fix-title">{fixLine(fix)}</span>
          {ready ? (
            <span className="team-card-lines bot-fix-lines">
              <span data-sign="add">+{fix.additions}</span>{" "}
              <span data-sign="del">−{fix.deletions}</span>
            </span>
          ) : null}
          {ready ? (
            <span className="team-card-actions bot-fix-actions">
              <button
                type="button"
                className="team-card-button"
                aria-expanded={reviewing}
                onClick={() => setReviewing((open) => !open)}
              >
                {reviewing ? "Hide" : "Review"}
              </button>
              <button
                type="button"
                className="team-card-button"
                data-variant="primary"
                disabled={!!busy}
                onClick={() => void act("apply")}
              >
                {busy === "apply" ? "Applying…" : "Apply"}
              </button>
              <button
                type="button"
                className="team-card-button"
                data-variant="ghost"
                disabled={!!busy}
                onClick={() => void act("discard")}
              >
                Throw away
              </button>
            </span>
          ) : null}
        </div>
        {shownProblem ? (
          <p className="bot-fix-problem" role="alert">
            {shownProblem}
          </p>
        ) : null}
        {ready && reviewing ? <FixReview path={path} fix={fix} /> : null}
      </div>
    </div>
  );
}

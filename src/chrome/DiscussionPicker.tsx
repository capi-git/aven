import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  BLOCKER_LABEL,
  DISCUSSION_DEFAULT_ROUNDS,
  DISCUSSION_MAX_ROUNDS,
  DISCUSSION_MIN_ROUNDS,
  type DiscussionHost,
  type DiscussionPartnerChoice,
} from "../lib/discussions";
import { isImeComposition } from "../lib/keyboard";
import { resolveModel } from "../lib/models";
import type { HarnessId } from "../lib/session";
import { HarnessIcon } from "./HarnessIcon";
import { Check, MessageMultiple, Plus, X } from "./icons";
import { ProjectMark } from "./ProjectMark";
import { SecondOpinionButton } from "./SecondOpinionButton";

type Props = {
  host: DiscussionHost;
  sessionId: string;
  /** This chat's provider and model, where the new-chat menu starts. */
  harness: HarnessId;
  model: string;
  /** Prefilled from the composer's draft. */
  initialTopic: string;
  onClose: () => void;
  /** Started; the composer clears the draft that became the topic. */
  onStarted: () => void;
};

const ROUNDS = Array.from(
  { length: DISCUSSION_MAX_ROUNDS - DISCUSSION_MIN_ROUNDS + 1 },
  (_, index) => DISCUSSION_MIN_ROUNDS + index,
);

/** Menus of the new-chat model picker live outside this panel. */
const PROVIDER_MENUS = "[data-provider-target]";

/**
 * Choose who this chat discusses with, the topic and how many rounds. Other
 * chats are listed as they were when it opened; Start checks them again.
 */
export function DiscussionPicker({
  host,
  sessionId,
  harness,
  model,
  initialTopic,
  onClose,
  onStarted,
}: Props) {
  const [{ blocked, candidates }] = useState(() => host.options(sessionId));
  const [target, setTarget] = useState<DiscussionPartnerChoice | null>(() => {
    const open = candidates.find((candidate) => !candidate.blocked);
    return open ? { kind: "chat", sessionId: open.sessionId } : null;
  });
  const [topic, setTopic] = useState(initialTopic);
  const [rounds, setRounds] = useState(DISCUSSION_DEFAULT_ROUNDS);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const topicField = useRef<HTMLTextAreaElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const field = topicField.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, []);

  // A press anywhere else closes it, except in the new-chat model menus.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (root.current?.contains(target) || target.closest(PROVIDER_MENUS))
        return;
      close.current();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  const reason =
    blocked ??
    (!target
      ? "Choose a chat to discuss with."
      : !topic.trim()
        ? "Add a topic to discuss."
        : null);

  const start = (preview = false) => {
    if (!target || (reason && !(preview && target))) return;
    const failure = host.start({
      sessionId,
      partner: target,
      topic: preview && !topic.trim() ? "Preview" : topic,
      rounds,
      ...(preview ? { preview: true } : {}),
    });
    if (failure) {
      setError(failure);
      return;
    }
    onStarted();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isImeComposition(event.nativeEvent)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      start();
    }
  };

  const newChat = target?.kind === "new" ? target : null;
  const rowClass = (selected: boolean) =>
    `flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-ui-body ${
      selected
        ? "bg-content/10 text-content"
        : "text-content/85 hover:bg-content/5 hover:text-content"
    }`;

  return (
    <div
      ref={root}
      role="dialog"
      aria-label="Discuss with another chat"
      data-discussion-picker
      onKeyDown={onKeyDown}
      className="overflow-hidden rounded-lg border border-content/10 bg-[var(--aven-popup)] shadow-[var(--aven-shadow)]"
    >
      <div className="flex h-8 items-center gap-2 border-b border-content/10 pl-2.5 pr-1">
        <MessageMultiple className="size-3.5 shrink-0 text-content/55" />
        <span className="min-w-0 flex-1 truncate text-ui-label font-medium text-content">
          Discuss with…
        </span>
        <button
          type="button"
          title="Close"
          aria-label="Close"
          onClick={onClose}
          className="grid size-6 place-items-center rounded-md text-content/50 hover:bg-content/10 hover:text-content"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div
        role="radiogroup"
        aria-label="Chat to discuss with"
        className="max-h-[min(176px,30vh)] overflow-y-auto overscroll-none p-1"
      >
        {candidates.map((candidate) => {
          const selected =
            target?.kind === "chat" && target.sessionId === candidate.sessionId;
          return (
            <button
              key={candidate.sessionId}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={!!candidate.blocked}
              data-discussion-candidate={candidate.sessionId}
              title={
                candidate.blocked
                  ? `${candidate.title}: ${BLOCKER_LABEL[candidate.blocked]}`
                  : `${candidate.title} · ${candidate.model}`
              }
              onClick={() => {
                setError(null);
                setTarget({ kind: "chat", sessionId: candidate.sessionId });
              }}
              className={`${rowClass(selected)} disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent`}
            >
              <ProjectMark path={candidate.cwd} />
              <HarnessIcon
                harness={candidate.harness}
                className="size-3.5 shrink-0"
              />
              <span className="min-w-0 flex-1 truncate">{candidate.title}</span>
              <span className="max-w-[40%] shrink-0 truncate text-ui-caption text-content/45">
                {candidate.blocked
                  ? BLOCKER_LABEL[candidate.blocked]
                  : candidate.model}
              </span>
              <Check
                className={`size-3.5 shrink-0 text-accent ${selected ? "" : "invisible"}`}
              />
            </button>
          );
        })}
        <SecondOpinionButton
          from={harness}
          fromModel={model}
          includeCurrent
          icon={Plus}
          title="New chat with…"
          disabledTitle="No providers are available for a new chat"
          description="Open a new chat beside this one with the model you choose."
          menuLabel="Choose the model for the new chat"
          onPick={(pickedHarness, pickedModel) => {
            setError(null);
            setTarget({
              kind: "new",
              harness: pickedHarness,
              model: pickedModel,
            });
          }}
          triggerClassName={`${rowClass(!!newChat)} disabled:opacity-45`}
          label={
            <>
              <span className="min-w-0 flex-1 truncate">New chat with…</span>
              {newChat ? (
                <>
                  <HarnessIcon
                    harness={newChat.harness}
                    className="size-3.5 shrink-0"
                  />
                  <span className="max-w-[40%] shrink-0 truncate text-ui-caption text-content/60">
                    {resolveModel(newChat.harness, newChat.model).name}
                  </span>
                </>
              ) : null}
              <Check
                className={`size-3.5 shrink-0 text-accent ${newChat ? "" : "invisible"}`}
              />
            </>
          }
        />
      </div>

      <div className="border-t border-content/10 px-2.5 pb-2 pt-2">
        <label className="mb-1 block text-ui-caption text-content/50">
          Topic
          <textarea
            ref={topicField}
            value={topic}
            rows={2}
            spellCheck={false}
            aria-label="Topic"
            placeholder="What should they discuss?"
            onChange={(event) => {
              setError(null);
              setTopic(event.target.value);
            }}
            className="mt-1 block max-h-28 min-h-12 w-full resize-none rounded-md border border-content/10 bg-content/5 px-2 py-1.5 text-ui-body text-content outline-none placeholder:text-content/35 focus:border-content/25"
          />
        </label>
        <div className="mt-2 flex items-center gap-2">
          <span
            id={`${sessionId}-rounds`}
            className="text-ui-caption text-content/50"
          >
            Rounds
          </span>
          <div
            role="radiogroup"
            aria-labelledby={`${sessionId}-rounds`}
            className="flex gap-0.5"
          >
            {ROUNDS.map((count) => (
              <button
                key={count}
                type="button"
                role="radio"
                aria-checked={rounds === count}
                onClick={() => setRounds(count)}
                className={`grid size-6 place-items-center rounded-md text-ui-label tabular-nums ${
                  rounds === count
                    ? "bg-content/15 text-content"
                    : "text-content/55 hover:bg-content/10 hover:text-content"
                }`}
              >
                {count}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex min-h-9 items-center gap-1 border-t border-content/10 py-1 pl-2.5 pr-1">
        <p
          role={error ? "alert" : undefined}
          className={`min-w-0 flex-1 truncate text-ui-caption ${
            error ? "text-content/80" : "text-content/45"
          }`}
          title={error ?? reason ?? undefined}
        >
          {error ?? reason ?? "Each round is one reply from each chat."}
        </p>
        {host.preview && target ? (
          <button
            type="button"
            title="Development builds: show the sidebar animation without sending anything"
            onClick={() => start(true)}
            className="shrink-0 rounded-md px-2 py-1 text-ui-label text-content/45 hover:bg-content/10 hover:text-content"
          >
            Preview
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md px-2 py-1 text-ui-label text-content/55 hover:bg-content/10 hover:text-content"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!!reason}
          onClick={() => start()}
          className="shrink-0 rounded-md bg-content/20 px-2 py-1 text-ui-label text-content hover:bg-content/25 disabled:opacity-40 disabled:hover:bg-content/20"
        >
          Start discussion
        </button>
      </div>
    </div>
  );
}

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Check, MessageSquare } from "./icons";
import {
  CUSTOM_OPTION_ID,
  buildQuestionReply,
  isOtherOption,
  optionDisplayLabel,
  optionIsRecommended,
  questionIsComplete,
  suggestedAnswers,
  type UserQuestion,
  type UserQuestionOption,
  type UserQuestionPrompt,
  type UserQuestionReply,
} from "../lib/userQuestion";

type Props = {
  prompt: UserQuestionPrompt;
  onReply: (requestId: number, reply: UserQuestionReply) => void;
};

/**
 * How long a reply may go without the agent acknowledging it or the card
 * closing before the form gives the buttons back.
 */
export const QUESTION_REPLY_TIMEOUT_MS = 5_000;
const NOT_SENT = "Couldn't send your answer. Try again.";

/** The message box this card sits in, if any. */
function composerField(form: HTMLElement | null): HTMLTextAreaElement | null {
  return (
    form
      ?.closest("[data-composer]")
      ?.querySelector<HTMLTextAreaElement>("textarea") ?? null
  );
}

function isTextField(element: Element | null): boolean {
  if (!element) return false;
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) {
    return !["button", "checkbox", "radio", "submit"].includes(element.type);
  }
  return element instanceof HTMLElement && element.isContentEditable;
}

/**
 * Whether a new card may take the keyboard: only when nothing else has it, or
 * its own message box has it with nothing typed. Typing elsewhere is never
 * interrupted.
 */
export function mayTakeFocus(
  form: HTMLElement,
  active: Element | null,
): boolean {
  if (form.getClientRects().length === 0) return false;
  if (!active || active === document.body) return true;
  const composer = form.closest("[data-composer]");
  if (!composer?.contains(active)) return false;
  if (!isTextField(active)) return true;
  const value =
    active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement
      ? active.value
      : (active.textContent ?? "");
  return value.trim() === "";
}

/** The highlighted option, or the answer field when there are no options. */
function focusCard(form: HTMLElement): void {
  const target =
    form.querySelector<HTMLElement>('[data-question-option][tabindex="0"]') ??
    form.querySelector<HTMLElement>("input");
  target?.focus();
}

export function QuestionForm({ prompt, onReply }: Props) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>(() =>
    suggestedAnswers(prompt.questions),
  );
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [highlights, setHighlights] = useState<Record<string, number>>({});
  const [waiting, setWaiting] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  /** Key numbers show only while the keys work. */
  const [cardFocused, setCardFocused] = useState(false);
  const sending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const optionButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const customInput = useRef<HTMLInputElement | null>(null);
  /** Move the keyboard to the next step's options once it renders. */
  const focusAfterStep = useRef(false);
  const submitting = !!prompt.submitting;
  const busy = submitting || waiting;
  // A replacement question can reuse the id, so its content also counts.
  const asked = useMemo(
    () => JSON.stringify(prompt.questions),
    [prompt.questions],
  );

  const latestQuestions = useRef(prompt.questions);
  latestQuestions.current = prompt.questions;

  useEffect(() => {
    // `asked` stands for the questions' content.
    setStep(0);
    setAnswers(suggestedAnswers(latestQuestions.current));
    setCustom({});
    setHighlights({});
  }, [prompt.requestId, asked]);

  useEffect(() => {
    // The agent acknowledged the reply, rejected it, or asked anew.
    clearTimeout(timer.current);
    timer.current = undefined;
    sending.current = submitting;
    setWaiting(false);
    setStalled(false);
  }, [prompt.requestId, asked, submitting, prompt.error]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const questions = prompt.questions;
  const total = questions.length;
  const index = Math.min(step, Math.max(total - 1, 0));
  const question = questions[index];
  const last = index >= total - 1;
  const options = useMemo(
    () => (question ? displayOptions(question) : []),
    [question],
  );
  const selected = question ? (answers[question.id] ?? []) : [];
  const highlighted = question
    ? Math.min(
        highlights[question.id] ?? startHighlight(options, selected),
        Math.max(options.length - 1, 0),
      )
    : 0;
  const ready = useMemo(
    () => (question ? questionIsComplete(question, answers, custom) : false),
    [answers, custom, question],
  );

  const returnToComposer = () => {
    composerField(formRef.current)?.focus();
  };

  // A new question takes the keyboard unless you are typing.
  useLayoutEffect(() => {
    const form = formRef.current;
    // Only when a question arrives, not on every highlight move.
    if (form && mayTakeFocus(form, document.activeElement)) focusCard(form);
  }, [prompt.requestId, asked]);

  // Back or Continue by keyboard keeps the keyboard on the card.
  useLayoutEffect(() => {
    if (!focusAfterStep.current) return;
    focusAfterStep.current = false;
    if (formRef.current) focusCard(formRef.current);
  }, [index]);

  // When the card closes with the keyboard on it, give it to the message box.
  useLayoutEffect(() => {
    const form = formRef.current;
    return () => {
      if (form?.contains(document.activeElement)) composerField(form)?.focus();
    };
  }, []);

  // ⌥↑ from the message box reaches the card without losing what you typed.
  useEffect(() => {
    const form = formRef.current;
    const composer = form?.closest<HTMLElement>("[data-composer]");
    if (!form || !composer) return;
    const field = () => composerField(form);
    const sync = () =>
      setComposerFocused(
        document.activeElement != null && document.activeElement === field(),
      );
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target !== field()) return;
      if (
        event.key !== "ArrowUp" ||
        !event.altKey ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      focusCard(form);
    };
    sync();
    composer.addEventListener("focusin", sync);
    composer.addEventListener("focusout", sync);
    composer.addEventListener("keydown", onKeyDown, true);
    return () => {
      composer.removeEventListener("focusin", sync);
      composer.removeEventListener("focusout", sync);
      composer.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  const finish = (nextAnswers = answers, nextCustom = custom) => {
    if (submitting || sending.current) return;
    // Hold immediately too: another click can arrive before the provider's
    // submitting event has committed the disabled controls.
    sending.current = true;
    setWaiting(true);
    setStalled(false);
    clearTimeout(timer.current);
    // Never a dead button: without an acknowledgement or the card closing,
    // give the controls back and say so.
    timer.current = setTimeout(() => {
      timer.current = undefined;
      sending.current = false;
      setWaiting(false);
      setStalled(true);
    }, QUESTION_REPLY_TIMEOUT_MS);
    onReply(
      prompt.requestId,
      buildQuestionReply(questions, nextAnswers, nextCustom),
    );
  };

  const keepFocus = () => {
    focusAfterStep.current = !!formRef.current?.contains(
      document.activeElement,
    );
  };

  const skipCurrent = () => {
    if (busy || sending.current) return;
    if (!question) {
      finish();
      return;
    }
    const nextAnswers = { ...answers };
    const nextCustom = { ...custom };
    delete nextAnswers[question.id];
    delete nextCustom[question.id];
    if (last) {
      finish(nextAnswers, nextCustom);
      return;
    }
    keepFocus();
    setAnswers(nextAnswers);
    setCustom(nextCustom);
    setStep(index + 1);
  };

  const continueWith = (nextAnswers: Record<string, string[]>) => {
    if (busy || sending.current || !question) return;
    if (!questionIsComplete(question, nextAnswers, custom)) return;
    if (last) {
      finish(nextAnswers);
      return;
    }
    keepFocus();
    setStep(index + 1);
  };

  const goBack = () => {
    if (busy || index === 0) return;
    // Earlier answers stay; going back only shows them again.
    keepFocus();
    setStep(index - 1);
  };

  const select = (optionId: string) => {
    if (!question) return answers;
    const next = {
      ...answers,
      [question.id]: nextSelection(question, selected, optionId),
    };
    setAnswers(next);
    return next;
  };

  const highlight = (optionIndex: number, focus = true) => {
    if (!question) return;
    setHighlights((current) => ({ ...current, [question.id]: optionIndex }));
    if (focus) optionButtons.current[optionIndex]?.focus();
  };

  const onFormKeyDown = (event: ReactKeyboardEvent<HTMLFormElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      // Leaves the answers as they are; the card stays until you answer.
      event.preventDefault();
      event.stopPropagation();
      returnToComposer();
      return;
    }
    const target = event.target as HTMLElement;
    if (busy || !question || isTextField(target)) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const optionIndex = Number(target.dataset.questionOption ?? NaN);
    const onOption = Number.isInteger(optionIndex);

    const shortcut = Number(event.key);
    if (
      event.key.length === 1 &&
      Number.isInteger(shortcut) &&
      shortcut >= 1 &&
      shortcut <= Math.min(options.length, 9)
    ) {
      event.preventDefault();
      const picked = shortcut - 1;
      highlight(picked);
      select(options[picked].id);
      return;
    }
    if (!onOption) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const offset = event.key === "ArrowDown" ? 1 : -1;
      highlight((optionIndex + offset + options.length) % options.length);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      highlight(event.key === "Home" ? 0 : options.length - 1);
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      select(options[optionIndex].id);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const option = options[optionIndex];
      if (isCustomId(question, option.id)) {
        // Other needs words first; Enter in its field continues.
        if (!selected.includes(option.id)) select(option.id);
        if (custom[question.id]?.trim()) {
          continueWith({ ...answers, [question.id]: [option.id] });
          return;
        }
        requestAnimationFrame(() => customInput.current?.focus());
        return;
      }
      if (question.multiSelect) {
        // Nothing chosen yet: Enter chooses the highlighted one first.
        if (!ready) select(option.id);
        else continueWith(answers);
        return;
      }
      continueWith(select(option.id));
      return;
    }
    // Typing a letter goes to the message box, so no keystroke is lost.
    if (event.key.length === 1 && event.key !== " " && onOption) {
      const field = composerField(formRef.current);
      if (!field) return;
      event.preventDefault();
      field.focus();
      try {
        document.execCommand("insertText", false, event.key);
      } catch {
        // Older engines: the box has the keyboard; the letter is dropped.
      }
    }
  };

  if (!question) return null;

  const title = question.header?.trim() || prompt.title?.trim() || "Question";
  const error = prompt.error || (stalled ? NOT_SENT : undefined);
  const customSelected = selected.some((id) => isCustomId(question, id));
  const customId = customOptionId(question);
  const hasPreview = options.some((option) => option.preview);
  const previewOption = options[highlighted];

  const onCustom = (value: string) => {
    setCustom((current) => ({ ...current, [question.id]: value }));
    setAnswers((current) => {
      const chosen = current[question.id] ?? [];
      if (question.multiSelect) {
        const without = chosen.filter((id) => !isCustomId(question, id));
        return { ...current, [question.id]: [...without, customId] };
      }
      return { ...current, [question.id]: [customId] };
    });
  };

  const customField = (
    <input
      ref={customInput}
      value={custom[question.id] ?? ""}
      disabled={busy}
      onChange={(event) => onCustom(event.target.value)}
      placeholder="Type your answer"
      className="aven-field mt-1 w-full px-2 py-1 text-ui-label"
      onClick={(event) => event.stopPropagation()}
      onFocus={() => {
        if (options.length > 0 && !customSelected) select(customId);
      }}
    />
  );

  const optionList =
    options.length === 0 && question.allowCustom ? (
      customField
    ) : (
      <div
        className="flex max-h-52 min-w-0 flex-col gap-1 overflow-y-auto"
        role="group"
        aria-label={question.header || question.prompt}
      >
        {options.map((option, optionIndex) => {
          const isCustom = isCustomId(question, option.id);
          const active = selected.includes(option.id);
          const suggested = optionIsRecommended(option) && !isCustom;
          return (
            <div key={option.id}>
              <button
                ref={(button) => {
                  optionButtons.current[optionIndex] = button;
                }}
                type="button"
                disabled={busy}
                aria-pressed={active}
                aria-keyshortcuts={
                  optionIndex < 9 ? String(optionIndex + 1) : undefined
                }
                data-question-option={optionIndex}
                data-highlighted={
                  highlighted === optionIndex ? "true" : undefined
                }
                tabIndex={highlighted === optionIndex ? 0 : -1}
                onFocus={() => highlight(optionIndex, false)}
                onClick={() => {
                  highlight(optionIndex, false);
                  select(option.id);
                }}
                className={`flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
                  active
                    ? "border-content/35 bg-content/10"
                    : "border-content/10 hover:bg-(--aven-hover)"
                }`}
              >
                <span
                  aria-hidden
                  className={`mt-0.5 grid size-3.5 shrink-0 place-items-center border ${
                    question.multiSelect ? "rounded-[3px]" : "rounded-full"
                  } ${
                    active
                      ? "border-content bg-content text-background-base"
                      : "border-content/30"
                  }`}
                >
                  {active ? (
                    <Check className="size-2.5" strokeWidth={2.5} />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-ui-label leading-snug text-content">
                    {optionDisplayLabel(option)}
                    {suggested ? (
                      <span className="ml-1.5 text-ui-caption text-content/45">
                        Recommended
                      </span>
                    ) : null}
                  </span>
                  {option.description ? (
                    <span className="mt-0.5 block text-ui-caption leading-snug text-content/50">
                      {option.description}
                    </span>
                  ) : null}
                </span>
                {cardFocused && optionIndex < 9 ? (
                  <span
                    aria-hidden
                    data-question-key
                    className="mt-px shrink-0 text-ui-caption tabular-nums text-content/35"
                  >
                    {optionIndex + 1}
                  </span>
                ) : null}
              </button>
              {isCustom && (active || customSelected) ? customField : null}
            </div>
          );
        })}
      </div>
    );

  return (
    <div className="px-1.5 pb-1.5" data-question-form>
      <form
        ref={formRef}
        className={`aven-inset-card px-3 py-2.5 ${hasPreview ? "@container" : ""}`}
        aria-busy={busy}
        onKeyDown={onFormKeyDown}
        onFocus={() => setCardFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setCardFocused(false);
        }}
        onSubmit={(event) => {
          event.preventDefault();
          continueWith(answers);
        }}
      >
        <div className="flex items-center gap-1.5">
          <MessageSquare
            className="size-3.5 shrink-0 text-content/45"
            strokeWidth={1.75}
          />
          <span className="min-w-0 flex-1 truncate text-ui-caption text-content/50">
            {title}
          </span>
          {total > 1 ? (
            <span className="shrink-0 text-ui-caption text-content/40">
              {index + 1} of {total}
            </span>
          ) : null}
          <button
            type="button"
            disabled={busy}
            className="h-6 shrink-0 rounded-md px-1.5 text-ui-caption text-content/55 hover:bg-content/10 hover:text-content disabled:opacity-40"
            onClick={skipCurrent}
          >
            Skip
          </button>
        </div>
        <fieldset
          className="mt-2 min-w-0"
          aria-label={question.header || question.prompt}
        >
          <p className="text-ui-body font-medium leading-snug text-content">
            {question.prompt}
          </p>
          {question.multiSelect ? (
            <p className="mt-0.5 text-ui-caption text-content/40">
              Select all that apply
            </p>
          ) : null}
          {hasPreview ? (
            <div className="mt-1.5 grid gap-2 @lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              {optionList}
              <pre
                data-question-preview
                className="max-h-52 min-h-16 overflow-auto rounded-md bg-content/5 px-2 py-1.5 font-mono text-ui-caption leading-4 whitespace-pre text-content/70"
              >
                {previewOption?.preview ?? (
                  <span className="text-content/35">No preview</span>
                )}
              </pre>
            </div>
          ) : (
            <div className="mt-1.5">{optionList}</div>
          )}
        </fieldset>
        {error ? (
          <p role="alert" className="mt-2 text-ui-label text-content/80">
            {error}
          </p>
        ) : null}
        <div className="mt-2.5 flex items-center gap-2">
          {index > 0 ? (
            <button
              type="button"
              disabled={busy}
              className="h-6 shrink-0 rounded-md px-1.5 text-ui-caption text-content/55 hover:bg-content/10 hover:text-content disabled:opacity-40"
              onClick={goBack}
            >
              Back
            </button>
          ) : null}
          <span className="min-w-0 flex-1 truncate text-ui-caption text-content/40">
            {composerFocused && !busy ? "⌥↑ to answer with keys" : null}
          </span>
          <button
            type="submit"
            disabled={busy || !ready}
            className="h-6 shrink-0 rounded-md bg-content px-2.5 text-ui-caption font-medium text-background-base hover:bg-(--aven-inverse-hover) disabled:opacity-40"
          >
            {busy ? "Sending…" : "Continue"}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Start on the chosen option, else the suggestion, else the first. */
function startHighlight(
  options: readonly UserQuestionOption[],
  selected: readonly string[],
): number {
  const chosen = options.findIndex((option) => selected.includes(option.id));
  if (chosen >= 0) return chosen;
  const suggested = options.findIndex(
    (option) => optionIsRecommended(option) && !isOtherOption(option),
  );
  return suggested >= 0 ? suggested : 0;
}

function displayOptions(question: UserQuestion): UserQuestionOption[] {
  if (question.options.length === 0) return question.options;
  if (question.options.some(isOtherOption) || !question.allowCustom) {
    return question.options;
  }
  return [...question.options, { id: CUSTOM_OPTION_ID, label: "Other" }];
}

function customOptionId(question: UserQuestion): string {
  return question.options.find(isOtherOption)?.id ?? CUSTOM_OPTION_ID;
}

function isCustomId(question: UserQuestion, optionId: string): boolean {
  return optionId === CUSTOM_OPTION_ID || optionId === customOptionId(question);
}

function nextSelection(
  question: UserQuestion,
  current: string[],
  optionId: string,
): string[] {
  if (!question.multiSelect) return [optionId];
  if (current.includes(optionId)) {
    return current.filter((id) => id !== optionId);
  }
  if (isCustomId(question, optionId)) {
    return [...current.filter((id) => !isCustomId(question, id)), optionId];
  }
  return [...current, optionId];
}

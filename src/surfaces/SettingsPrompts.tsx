import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ChevronRight } from "../chrome/icons";
import { SETTINGS } from "../lib/settingDefinitions";
import {
  loadCustomPrompt,
  PROMPT_MAX_LENGTH,
  PROMPTS,
  savePrompt,
  subscribePrompts,
  type PromptDefinition,
  type PromptGroup,
} from "../lib/prompts";
import { SettingsGroup } from "./SettingsControls";
import "./SettingsPrompts.css";

/** Typing saves after this pause, and on leaving the field. */
const SAVE_DELAY_MS = 400;

function useCustomPrompt(id: PromptDefinition["id"]): string | null {
  return useSyncExternalStore(
    subscribePrompts,
    () => loadCustomPrompt(id),
    () => null,
  );
}

function PromptRow({ prompt }: { prompt: PromptDefinition }) {
  const custom = useCustomPrompt(prompt.id);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(custom ?? prompt.defaultText);
  const pending = useRef<number | null>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const bodyId = useId();

  // Another window, or Reset, changed it: show what is saved now.
  useEffect(() => {
    if (pending.current === null) setText(custom ?? prompt.defaultText);
  }, [custom, prompt.defaultText]);

  const flush = () => {
    if (pending.current === null) return;
    window.clearTimeout(pending.current);
    pending.current = null;
    savePrompt(prompt.id, textRef.current);
  };
  // Leaving the page keeps what was typed.
  const id = prompt.id;
  useEffect(
    () => () => {
      if (pending.current === null) return;
      window.clearTimeout(pending.current);
      pending.current = null;
      savePrompt(id, textRef.current);
    },
    [id],
  );

  const edit = (value: string) => {
    setText(value);
    if (pending.current !== null) window.clearTimeout(pending.current);
    pending.current = window.setTimeout(() => {
      pending.current = null;
      savePrompt(prompt.id, textRef.current);
    }, SAVE_DELAY_MS);
  };

  const reset = () => {
    if (pending.current !== null) window.clearTimeout(pending.current);
    pending.current = null;
    savePrompt(prompt.id, null);
    setText(prompt.defaultText);
  };

  return (
    <div className="settings-prompt" data-open={open || undefined}>
      <button
        type="button"
        className="settings-prompt-head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="settings-prompt-copy">
          <span className="settings-prompt-label">{prompt.label}</span>
          <span className="settings-prompt-use">{prompt.use}</span>
        </span>
        <span className="settings-prompt-state">
          {custom ? "Customised" : "Using default"}
        </span>
        <ChevronRight
          aria-hidden
          className="settings-prompt-chevron size-3.5"
          strokeWidth={1.75}
        />
      </button>
      {open ? (
        <div className="settings-prompt-body" id={bodyId}>
          <textarea
            className="settings-prompt-text"
            aria-label={`${prompt.label} instruction`}
            value={text}
            maxLength={PROMPT_MAX_LENGTH}
            rows={Math.min(14, Math.max(4, text.split("\n").length + 1))}
            spellCheck={false}
            onChange={(event) => edit(event.target.value)}
            onBlur={flush}
          />
          {custom ? (
            <button
              type="button"
              className="settings-button settings-prompt-reset"
              onClick={reset}
            >
              Reset to default
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const GROUPS: { group: PromptGroup; setting: { id: string } }[] = [
  { group: "Git", setting: SETTINGS.promptsGit },
  { group: "Actions", setting: SETTINGS.promptsActions },
];

/**
 * Settings › Prompts: the instruction behind each AI action. Aven still adds
 * the facts an action needs, such as a diff or a pull request's checks.
 */
export function PromptsPage() {
  return (
    <>
      {GROUPS.map(({ group, setting }) => (
        <SettingsGroup key={group} id={setting.id} title={group}>
          {PROMPTS.filter((prompt) => prompt.group === group).map((prompt) => (
            <PromptRow key={prompt.id} prompt={prompt} />
          ))}
        </SettingsGroup>
      ))}
    </>
  );
}

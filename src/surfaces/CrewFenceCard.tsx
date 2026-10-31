import { createContext, useContext, useState } from "react";
import {
  giveIdeasToCrew,
  memberAskTaken,
  queueMemberTasks,
  setMemberGoal,
} from "../lib/crewActions";
import { crewFenceView } from "../lib/crewFences";
import { TASKS_FENCE, parseTasks } from "../lib/crewHandoff";
import {
  crewForChat,
  crewForFolder,
  useCrewsStore,
  yourGoal,
} from "../lib/crews";
import { errorText } from "../lib/errors";
import "./CrewFenceCard.css";

/**
 * Where a crew block was written: the chat, the reply it is in, and
 * whether that reply answers words you typed yourself. A member's block of
 * work offers Queue these only then.
 */
export const CrewFenceSource = createContext<{
  chatId?: string;
  replyId?: string;
  askedByYou?: boolean;
}>({});

/**
 * A crew's fenced block in a chat, as a compact card instead of raw JSON:
 * "3 ideas" with their titles and Give to crew, "2 must-fix", "Handed
 * over", "Goal met". The bot's words show as quoted text; the buttons are
 * Aven's. While the block is still being written, one quiet line.
 */
export function CrewFenceCard({
  language,
  code,
  incomplete,
  cwd,
}: {
  language: string;
  code: string;
  incomplete?: boolean;
  /** The chat's folder: its project, or a crew's copy. */
  cwd?: string;
}) {
  // Re-read when crews change, so Give to crew appears once the crew is on.
  useCrewsStore();
  const [given, setGiven] = useState<ReadonlySet<string>>(() => new Set());
  const [problem, setProblem] = useState<string | null>(null);
  if (incomplete)
    return (
      <p className="crew-fence-quiet" data-crew-fence={language}>
        Writing a note for the crew…
      </p>
    );
  const view = crewFenceView(language, code);
  if (!view)
    return (
      <p className="crew-fence-quiet" data-crew-fence={language}>
        A note for the crew
      </p>
    );
  if (view.kind === "tasks")
    return <MemberTasksCard view={view} code={code} language={language} />;
  const crew = view.kind === "ideas" ? crewForFolder(cwd) : undefined;
  const canGive = !!crew?.on;
  const give = (titles: string[]) => {
    if (!crew) return;
    setProblem(null);
    setGiven((current) => new Set([...current, ...titles]));
    void giveIdeasToCrew(crew.path, titles)
      .catch((error) => errorText(error))
      .then((why) => {
        if (!why) return;
        setProblem(why);
        setGiven((current) => {
          const next = new Set(current);
          for (const title of titles) next.delete(title);
          return next;
        });
      });
  };
  const open = view.items.filter((item) => !given.has(item.title));
  return (
    <section
      className="crew-fence"
      data-crew-fence={language}
      aria-label={view.label}
    >
      <header className="crew-fence-head">
        <strong>{view.label}</strong>
        {canGive && open.length > 1 ? (
          <button
            type="button"
            className="crew-fence-button"
            onClick={() => give(open.map((item) => item.title))}
          >
            Give all to crew
          </button>
        ) : null}
      </header>
      {view.line ? <p className="crew-fence-line">{view.line}</p> : null}
      {view.items.length ? (
        <ul className="crew-fence-items">
          {view.items.map((item) => (
            <li key={item.title}>
              <span className="crew-fence-item">
                <span className="crew-fence-title">{item.title}</span>
                {item.detail ? (
                  <span className="crew-fence-detail">{item.detail}</span>
                ) : null}
              </span>
              {canGive ? (
                given.has(item.title) ? (
                  <span className="crew-fence-given">Given</span>
                ) : (
                  <button
                    type="button"
                    className="crew-fence-button"
                    onClick={() => give([item.title])}
                  >
                    Give to crew
                  </button>
                )
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {problem ? (
        <p className="crew-fence-line" role="alert">
          {problem}
        </p>
      ) : null}
    </section>
  );
}

/**
 * Work a member took down from your words in its chat (`aven-tasks`): its
 * cards and goal, with Queue these and Set as goal. Nothing is queued or
 * started until you press one, and only when the reply answers a message
 * you typed yourself; a goal you set is replaced only when you say so.
 */
function MemberTasksCard({
  view,
  code,
  language,
}: {
  view: NonNullable<ReturnType<typeof crewFenceView>>;
  code: string;
  language: string;
}) {
  const source = useContext(CrewFenceSource);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const found = crewForChat(source.chatId);
  const asked = parseTasks(`\`\`\`${TASKS_FENCE}\n${code}\n\`\`\``);
  const replyId = source.replyId;
  const offer =
    !!found &&
    !found.retired &&
    found.crew.on &&
    !!source.askedByYou &&
    !!replyId &&
    !!asked;
  const taken = !!replyId && memberAskTaken(found?.crew, replyId);
  const run = async (work: () => Promise<string | null> | string | null) => {
    setBusy(true);
    setProblem(null);
    const why = await Promise.resolve()
      .then(work)
      .catch((error) => errorText(error));
    setBusy(false);
    setProblem(why);
  };
  const queue = () =>
    run(() =>
      queueMemberTasks(
        found!.crew.path,
        found!.member.id,
        replyId!,
        asked!.tasks,
      ),
    );
  const goal = (replace: boolean) =>
    run(() => {
      setReplacing(false);
      return setMemberGoal(
        found!.crew.path,
        found!.member.id,
        replyId!,
        asked!.goal!,
        { replace },
      );
    });
  const mine = !!found && yourGoal(found.crew);
  return (
    <section
      className="crew-fence"
      data-crew-fence={language}
      aria-label={view.label}
    >
      <header className="crew-fence-head">
        <strong>{view.label}</strong>
        {offer && taken ? (
          <span className="crew-fence-given">Taken</span>
        ) : offer ? (
          <>
            {asked.tasks.length ? (
              <button
                type="button"
                className="crew-fence-button"
                disabled={busy}
                onClick={() => void queue()}
              >
                Queue these
              </button>
            ) : null}
            {asked.goal ? (
              <button
                type="button"
                className="crew-fence-button"
                disabled={busy}
                onClick={() => (mine ? setReplacing(true) : void goal(false))}
              >
                {mine ? "Replace your goal" : "Set as goal"}
              </button>
            ) : null}
          </>
        ) : null}
      </header>
      {view.line ? <p className="crew-fence-line">{view.line}</p> : null}
      {view.items.length ? (
        <ul className="crew-fence-items">
          {view.items.map((item) => (
            <li key={item.title}>
              <span className="crew-fence-item">
                <span className="crew-fence-title">{item.title}</span>
                {item.detail ? (
                  <span className="crew-fence-detail">{item.detail}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {replacing && found?.crew.goal ? (
        <p className="crew-fence-line" role="alert">
          Replace your goal, “{found.crew.goal.text}”?{" "}
          <button
            type="button"
            className="crew-fence-button"
            onClick={() => void goal(true)}
          >
            Replace
          </button>{" "}
          <button
            type="button"
            className="crew-fence-button"
            onClick={() => setReplacing(false)}
          >
            Keep mine
          </button>
        </p>
      ) : null}
      {problem ? (
        <p className="crew-fence-line" role="alert">
          {problem}
        </p>
      ) : null}
    </section>
  );
}

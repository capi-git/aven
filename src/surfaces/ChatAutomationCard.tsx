import { useContext, useSyncExternalStore } from "react";
import {
  chatAutomationId,
  parseChatAutomationBody,
} from "../lib/chatAutomation";
import {
  describeSchedule,
  getScheduledAgent,
  openAutomation,
  subscribeScheduledAgents,
} from "../lib/scheduledAgents";
import { CrewFenceSource } from "./CrewFenceCard";
import "./CrewFenceCard.css";

/**
 * An `aven-automation` block in a chat, as a card instead of raw JSON. It
 * says what Aven really did: the block only describes an automation, and a
 * turn you didn't ask for one in creates nothing.
 */
export function ChatAutomationCard({
  code,
  incomplete,
}: {
  code: string;
  incomplete?: boolean;
}) {
  const { chatId } = useContext(CrewFenceSource);
  const draft = incomplete ? null : parseChatAutomationBody(code);
  const id = chatId && draft ? chatAutomationId(chatId, draft) : "";
  const agent = useSyncExternalStore(subscribeScheduledAgents, () =>
    id ? getScheduledAgent(id) : undefined,
  );
  if (incomplete)
    return <p className="crew-fence-quiet">Setting up the automation…</p>;
  if (!agent)
    return <p className="crew-fence-quiet">No automation was set up here.</p>;
  return (
    <section className="crew-fence" data-chat-automation={agent.id}>
      <header className="crew-fence-head">
        <strong>{agent.name}</strong>
        <button
          type="button"
          className="crew-fence-button"
          onClick={() => openAutomation(agent.id)}
        >
          Open
        </button>
      </header>
      <p className="crew-fence-line">{describeSchedule(agent.schedule)}</p>
    </section>
  );
}

import {
  useContext,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { forwardCard, requestForwardToChat } from "../lib/chatForward";
import {
  chatRefsFromSummaries,
  chatTitle,
  otherChats,
  type ChatRef,
} from "../lib/chatMentions";
import { LiveSessionsContext } from "../lib/liveSessions";
import { projectName } from "../lib/paths";
import { looksLikeProject, sameProjectPath } from "../lib/recents";
import { listSessionsByProject } from "../lib/sessionStore";
import { HarnessIcon } from "./HarnessIcon";
import { CornerDownRight, MessageSquarePlus } from "./icons";
import "./Menu.css";
import { Popover } from "./Popover";

const MENU_WIDTH = 260;
const MAX_CHATS = 8;
const SELF = "[data-forward-menu]";
/** The New chat row's key; every other row is keyed by its chat's id. */
const NEW_CHAT = "\u0000new-chat";

/**
 * Forward a reply to another chat, or a new one, as a card above its message
 * box. The user sends it from there.
 */
export function ForwardButton({
  text,
  fromSessionId,
}: {
  text: string;
  fromSessionId: string;
}) {
  const store = useContext(LiveSessionsContext);
  const [open, setOpen] = useState(false);
  // The highlighted row by chat id, not position: saved chats arrive and
  // re-sort the list while the menu is open, and Enter must still forward
  // to the chat that is highlighted.
  const [active, setActive] = useState(NEW_CHAT);
  const [chats, setChats] = useState<ChatRef[]>([]);
  const button = useRef<HTMLButtonElement>(null);

  const from = store?.session(fromSessionId);
  if (!store || !from) return null;
  const cwd = from.cwd;
  // New chat first, then the chats.
  const keys = [NEW_CHAT, ...chats.map((chat) => chat.id)];
  const current = keys.includes(active) ? active : NEW_CHAT;

  const openMenu = () => {
    const list = (saved: ChatRef[] = []) =>
      otherChats(store.list(), fromSessionId, cwd, saved).slice(0, MAX_CHATS);
    setChats(list());
    setActive(NEW_CHAT);
    setOpen(true);
    if (!looksLikeProject(cwd)) return;
    // This project's saved chats too, once they are read.
    void listSessionsByProject(cwd)
      .then((rows) => setChats(list(chatRefsFromSummaries(rows))))
      .catch(() => undefined);
  };

  const pick = (key: string) => {
    const source = store.session(fromSessionId) ?? from;
    const card = forwardCard({ ...source, title: chatTitle(source) }, text);
    setOpen(false);
    if (!card) return;
    const target =
      key === NEW_CHAT ? undefined : chats.find((chat) => chat.id === key);
    if (key !== NEW_CHAT && !target) return;
    requestForwardToChat({
      card,
      cwd,
      ...(target ? { toSessionId: target.id } : {}),
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const at = keys.indexOf(current);
      setActive(keys[(at + step + keys.length) % keys.length]);
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(current);
    }
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        title="Forward to another chat"
        aria-label="Forward"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`rounded-md p-1 ${
          open
            ? "bg-content/8 text-content/70"
            : "text-content/40 hover:bg-content/8 hover:text-content/70"
        }`}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        <CornerDownRight className="size-3.5" strokeWidth={1.75} />
      </button>
      {open ? (
        <Popover
          anchor={button}
          side="top"
          align="center"
          width={MENU_WIDTH}
          autoFocus
          ignore={SELF}
          onDismiss={(reason) => {
            setOpen(false);
            if (reason === "escape") button.current?.focus();
          }}
          role="menu"
          tabIndex={-1}
          aria-label="Forward this reply"
          onKeyDown={onKeyDown}
          data-forward-menu
          className="aven-menu font-sans"
        >
          <div className="aven-menu-section">Forward to</div>
          <ForwardRow
            id={NEW_CHAT}
            active={current}
            onActive={setActive}
            onPick={pick}
            icon={<MessageSquarePlus className="size-3.5" strokeWidth={1.75} />}
            label="New chat"
          />
          {chats.length > 0 ? (
            <div role="separator" className="aven-menu-separator" />
          ) : null}
          {chats.map((chat) => (
            <ForwardRow
              key={chat.id}
              id={chat.id}
              active={current}
              onActive={setActive}
              onPick={pick}
              icon={<HarnessIcon harness={chat.harness} className="size-3.5" />}
              label={chatTitle(chat)}
              detail={
                looksLikeProject(chat.cwd) && !sameProjectPath(chat.cwd, cwd)
                  ? projectName(chat.cwd)
                  : undefined
              }
            />
          ))}
        </Popover>
      ) : null}
    </>
  );
}

function ForwardRow({
  id,
  active,
  onActive,
  onPick,
  icon,
  label,
  detail,
}: {
  id: string;
  active: string;
  onActive: (id: string) => void;
  onPick: (id: string) => void;
  icon: ReactNode;
  label: string;
  detail?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-active={id === active}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={() => onActive(id)}
      onClick={() => onPick(id)}
      className="aven-menu-item"
    >
      <span aria-hidden="true" className="aven-menu-icon">
        {icon}
      </span>
      <span className="aven-menu-label truncate">{label}</span>
      {detail ? <span className="aven-menu-detail">{detail}</span> : null}
    </button>
  );
}

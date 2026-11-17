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
  const [active, setActive] = useState(0);
  const [chats, setChats] = useState<ChatRef[]>([]);
  const button = useRef<HTMLButtonElement>(null);

  const from = store?.session(fromSessionId);
  if (!store || !from) return null;
  const cwd = from.cwd;
  // Row 0 is New chat; the rest are chats.
  const rows = chats.length + 1;

  const openMenu = () => {
    const list = (saved: ChatRef[] = []) =>
      otherChats(store.list(), fromSessionId, cwd, saved).slice(0, MAX_CHATS);
    setChats(list());
    setActive(0);
    setOpen(true);
    if (!looksLikeProject(cwd)) return;
    // This project's saved chats too, once they are read.
    void listSessionsByProject(cwd)
      .then((rows) => setChats(list(chatRefsFromSummaries(rows))))
      .catch(() => undefined);
  };

  const pick = (index: number) => {
    const current = store.session(fromSessionId) ?? from;
    const card = forwardCard({ ...current, title: chatTitle(current) }, text);
    setOpen(false);
    if (!card) return;
    const target = index === 0 ? undefined : chats[index - 1];
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
      setActive((index) => (index + step + rows) % rows);
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(active);
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
            index={0}
            active={active}
            onActive={setActive}
            onPick={pick}
            icon={<MessageSquarePlus className="size-3.5" strokeWidth={1.75} />}
            label="New chat"
          />
          {chats.length > 0 ? (
            <div role="separator" className="aven-menu-separator" />
          ) : null}
          {chats.map((chat, i) => (
            <ForwardRow
              key={chat.id}
              index={i + 1}
              active={active}
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
  index,
  active,
  onActive,
  onPick,
  icon,
  label,
  detail,
}: {
  index: number;
  active: number;
  onActive: (index: number) => void;
  onPick: (index: number) => void;
  icon: ReactNode;
  label: string;
  detail?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-active={index === active}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={() => onActive(index)}
      onClick={() => onPick(index)}
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

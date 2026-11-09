# Aven design rules

Aven should feel like a calm, plain tool: mostly dark and grey, little on screen, and nothing asking for attention unless it needs you. These rules set the standard for how clean Aven should look, and record what Aven's owner has asked for and rejected.

Follow them in anything you add or change. When a rule and a request disagree, follow the request and update this file if the rule has changed.

## The five rules

1. **Show only what applies.** Hide a row, button or label that does nothing right now. Don't grey it out.
2. **Only speak up if it needs you.** Nothing appears because something finished or moved. No confirmation toasts, no "Review" or "Done" labels. "Needs you" is the one status label a list row may show.
3. **Say each thing once.** Name something in one place, and put each action in one place per pane. If a header names it, the row below doesn't.
4. **Keep the common path one click away.** Put the rare choices one level deeper: a `…` menu, a page inside a menu, or a Customise row.
5. **Use a few words.** One short line at most under anything. A longer explanation goes in a tooltip or behind a disclosure, never in a paragraph on the page.

## Colour

- Surfaces, hovers, selections, previews, borders and shadows are neutral grey. Never wash a surface with a colour.
- Colour appears only in small marks that mean something: status words, errors, links, diff `+` and `−`, provider icons, a project's Stack, and an agent's Bot.
- Use theme tokens (`--color-content`, `--aven-muted`, `--aven-line`, `--aven-hover`, `--aven-control-bg`). Don't add a new hard-coded colour.

## Text

Use the tokens in `src/index.css`. Don't add a new size.

| Token               | Size   | For                                  |
| ------------------- | ------ | ------------------------------------ |
| `--text-ui-title`   | 20px   | Page titles                          |
| `--text-ui-sheet`   | 15px   | Sheet titles, a panel's name         |
| `--text-ui-reading` | 14px   | Reading: chat text                   |
| `--text-ui-body`    | 13px   | Row labels, buttons                  |
| `--text-ui-row`     | 12.5px | Sidebar rows                         |
| `--text-ui-label`   | 12px   | Descriptions, section headings, tabs |
| `--text-ui-caption` | 11px   | Times, counts, small notes           |

- Show hierarchy with weight and grey, not size. A row has a 13px label at weight 500 and a 12px muted line under it.
- Section headings are small, muted and weight 500, in sentence case. Don't use capitals for labels.
- Use weight 600 only for titles.

## Space and shape

- Heights: menu rows 26px, navigation rows 28px, buttons and tabs 24px, settings rows at least 48px.
- Corners: use the `--aven-radius-*` tokens. Rows and controls are 6px, cards 10px, sheets 12px.
- A resize edge shows nothing extra while pointed at or dragged: the cursor says it can be grabbed. Only keyboard focus draws a line on it.
- Use at most one hairline per header. Rows in a list or card are split by a hairline, not by gaps and boxes.
- Line a section heading up with the edge of its card, and a page title with the same edge.
- Don't nest a card inside a card, or a tile inside a tile. That includes the app icon: macOS draws its one tile.

## Patterns

**A page** has a title, one short line under it, then sections. A section is a small muted heading above one card of rows.

**A project's mark** is its Stack: three pages in its colour, the back two fainter. The pages fan out while the project is open in the sidebar, and otherwise the Stack stays still: it never sweeps or reacts, so a small dot at the row's end says an agent is running. A logo, when set, takes its place and stays as it is. A project picks only a colour and a logo, and its agents wear that colour.

**A project's Avos** is the first row under the project: its Bot in the project's colour, "Avos" at weight 500, its helpers' small faces beside the name while they work (three at most, then "+2"; overlapping on Avos's tab), and on the right only "Needs you" in amber or "Working". A helper that just started pops out from Avos's side. The Checker and Security keep their tick and shield while they work, so work being checked reads apart from work being built. Every project has one; the first time you open it is meeting it, in its chat. Ask Avos once and it does the work: what it takes down from your message builds straight away in its copy, whatever its size, and comes back for you to review (Access has Ask before building for those who want to say Build it first). Meeting it, Avos first asks whether it may read the project, with Not now and Allow; until you allow it, Avos and its helpers read nothing and Avos stays off. Access in its settings has the same switch.

**Avos's screen** is like a messenger with someone you work with: its chat, with its panel beside it, as a Mono's in MonoCode: one header of five tabs (the open one named beside its icon, Changes with how many wait) over one scrolling body. Overview: its Bot, name and line, what it did (26 weeks of days in greys), today's numbers, Up next and New today. Helpers: who's working now, with what each is doing and on what, and the quick helpers it started, then one "Earlier today" line that opens the activity in a sheet. A helper opens inside Helpers (what it's doing, what Avos asked it, Stop), and Avos's chat never gets replaced: Watch opens the helper's chat beside Avos in the same tab, as a split. Documents: what it wrote up. Habits: its jobs on a schedule, each with a switch. Changes: what's ready, with Review and Apply, then what you applied. Each says plainly when it has nothing. What it remembers is in `…`, its limits in Settings. Questions and ideas that need you come as Avos's own message at the end of the chat, with its buttons. On a narrow pane the panel folds into one header with the tabs as icons, and a tab opens in a sheet.

**Avos's goal** is said once, in its panel: one line that opens to all of its words when pressed, a word for where it stands (Working, Waiting, Stopped, Met) and the one thing you can do about it; what it waits on is a short line under it ("Needs Git to build.", with Set up Git). The chat holds what you and Avos said, and news that happens once (a goal met, planning that failed). It never repeats the goal when Avos takes it down, when you press Keep going, or while it waits.

**Avos's settings** are rows in one card, Model, Instructions, Memory, Helpers, Access and Limits, each with one line and opening its own page; Avos is never listed as one of its helpers. Instructions (a Mono's Soul) is your standing words to Avos and the rules it keeps for every job; Memory is what it learned, one fact a row with Forget, editable as text, with what its helpers learned under it. `…` › What Avos remembers opens Memory. The header's switch turns Avos on and off, and Pause is in Avos's `…`. Who builds what shows only once there are two Builders.

**A project list** gives only projects a mark and a heavier name. A chat is its title in muted text, lined up under the project's name. It brightens when it's open, working or needs you, and its time shows on hover.

**A file an agent made for you** is a link in the chat's link blue, with a small arrow before its name. The agent keeps it in the project's hidden `.aven/files` folder, which Git leaves alone. Clicking the link saves a copy to Downloads as a browser does, keeping both when the name is taken; a small popup under the link names the copy, says Downloaded, and offers Open and Show in Finder, and the arrow becomes a check. A link to any other file opens it in Aven.

**A settings row** has its label and one line on the left and its control on the right. Pick the simplest control: a switch for on and off, segments for two or three short choices, a menu for more.

**A sidebar for a mode** belongs to that mode. While Settings is open, the sidebar shows Back to app, search and the sections, and nothing else.

**A work area** has the thing you talk to or work in on the left and a panel on the right. The panel has one header, a row of tabs and one scrolling body.

**Tabs join only on purpose.** Passing over a tab, or letting go on it quickly, only moves yours. Rest on it while a line fills around it, about half a second, and letting go then joins them.

**An effort choice** is a row of dots, one per level the model really has, weakest on the left, lit up to the chosen one; pointed at, they light up to that one, fainter, and one muted line under them names it. No colour per level.

**A menu** is solid, not see-through. It lists what applies, most common first, with sentence-case labels. Group rows with one separator, and move rare choices into a page inside the menu.

**An empty state** is one centred sentence saying what will appear here, in muted text. Add no illustration and no button unless the next step is obvious.

**A new chat** has faint grey ink behind its words that the pointer stirs: a halftone of 3px cells in the text colour, never tinted. Holding gathers it and letting go bursts it outward; left alone it fades and stops. It shows only on a plain new chat (not with a chat background, the games, or Reduce motion) and fades out with the first message.

**The pointer** is a soft, see-through dot about a fingertip wide (like the iPad's) with no outline, floating on a gentle shadow that keeps it visible over white pages and images. It shows over every part of Aven's own interface, form labels, check boxes and the code editor's buttons included, and is one size everywhere: over something you can press or drag (a tab, a sidebar row) it is only a little brighter, and it is plain on a disabled control or while something is busy. Text fields keep the I-beam, resize edges keep their arrows, and the closed hand shows only while dragging. Pages in the browser keep their own pointer, and the Mac's pointer comes back when it is enlarged or Increase contrast is on.

**An agent using your Mac** looks like it does in Aven. The bar at the top of the screen is a pill of the same dark glass with a row per agent: its Bot, working while it acts and thinks and watching while something holds it up, its name and a few muted words ("Clicking “Next…” in Pages"). Its Bot is that agent's Stop, as in the message box, and Pause shows only while the bar is pointed at. A question shows Bot needing you. Its pointer is Aven's soft dot with a small dark tag (Bot working, name, step) that shrinks to Bot alone, watching, once it stops acting. Bot there has the faces it has in Aven: Aven sends them with the agent's name and colour. A thin white frame sits right behind the window it uses. A question ("Let Claude use your Mac?") is one sentence with Not now and one light Allow. No colour washes: colour is only in Bot.

**An agent** (Avos, a teammate, a bot, a chat) is drawn as Bot: a face of lit dots, with no box, screen or outline round it, that says what it's doing: a grey `>_` with a blinking cursor at rest (Avos shows its square eyes instead, blinking now and then; each helper its role's face), square eyes that look about while watching, narrow eyes scanning as it works, an amber `>` when it needs you, and green eyes, winking, when its work is ready. A soft glow behind the face, in the same colour, says it's working, watching, needs you (breathing) or is ready; at rest nothing glows. A done turn shows a happy `^^`, a failed one red eyes. Its face is in its project's colour (Avos, a bot, a chat) or its role's (a teammate). Its face is 13 by 9 dots at every size, its dots bolder when small so a sidebar's mark reads as the big one. A place for a helper still to come is a faint honeycomb of dots. Only agents have faces: a project's mark never stands for an agent.

**Numbers** stay small. Use a few quiet tiles only in a panel's Overview. Home shows small chips, and only when the number isn't zero.

**Tools on a pane** show on hover or focus.

## Glass

The top row and sidebar are one see-through surface, with the work in one rounded card on it. No lines between them.

Popups, menus and dialogs share one dark glass (the end of `src/macos-theme.css`), nearly solid so words behind never show through, even if the blur is lost for a moment. The hover sidebar is a rounded card floating over the work, showing the window's own glass. Never put blur inside something that scrolls: it costs a lot of power and speed.

## Motion

- Respond on press. Never make someone wait for an animation.
- Animate only `transform` and `opacity`. Motion must be interruptible, and every animation must end by itself.
- The one exception is an agent's mark (Bot). Its face keeps moving while it works and while it needs you, because those states last until they change: its scanning eyes, the nudging prompt and its breathing glow. At rest its cursor blinks, and while watching its eyes look about and blink; each agent starts at a different point, so helpers never move together. Only its face, its cursor and its glow move, and it holds still while the window is hidden or resizing, and shows a still frame under Reduce motion. Resting and watching settle when Aven has been left alone for a minute, and pick up at the next touch; working and needing you never settle.
- While a turn runs, the message box shows its Bot once, at the box's end, moving for the same reason: working while it thinks, writes or runs a tool, watching while something holds it up, and needing you when it does. Nothing beside the words repeats it. They start with a small quiet stop square, the turn's one Stop, then a few muted words ("Writing", "Edit app.js", "Needs you"), and the time only shows when you point at them. No pill goes around them. In a narrow box the square stands alone, unless the words say it needs you or what holds it up.
- Use the springs in `src/lib/motionTokens.ts` for things you can touch, with no bounce unless a flick caused it.
- Honour Reduce motion.
- Native browser pages can't be animated. For a motion, move a picture of the page instead, and hold only the pages that really move. Dragging an edge or divider keeps the page live, updating as it moves: a stretched picture looks wrong, even if a live page can drift a few points on a fast drag.
- Never restyle the whole window: no rule on `html *`, and no inherited property set on `body` or `html` during an interaction.
- No container query on anything large, such as a chat or the panes. WebKit rechecks every element under a container each time it changes size, on every frame of a drag. Use `useNarrowMark`, and keep containers to small things like a card or a toolbar.

An input's first visible response and any frame in motion stay within 33 ms. The speed test reports what goes over.

## Words

- Write plain sentences in British English, with sentence case for labels and titles.
- Say what a person gets, not how it works. A refusal says what to do next.
- Use one word for one thing:

| Say                          | Not                                |
| ---------------------------- | ---------------------------------- |
| Chat                         | Session, thread                    |
| Avos, Helpers                | Team, Teammates, Lead, Crew, Monos |
| Copy                         | Worktree                           |
| Provider                     | Harness                            |
| Instructions                 | Soul                               |
| Schedule                     | Habits                             |
| Keyboard shortcuts           | Keybindings                        |
| Full access, Auto, Ask first | Permission mode names              |

## Before you finish

- Can anything be removed? Remove it.
- Does anything show when it doesn't apply?
- Is anything named twice, or does any action appear twice?
- Did you add a colour, text size or corner that isn't a token?
- Does it work in a narrow pane, in light mode and with Reduce motion on?
- Did you look at it in the real app? See `docs/DEVELOPMENT.md`.

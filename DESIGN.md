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

**A project's Avos** is the first row under the project: its Bot in the project's colour, "Avos" at weight 500, and on the right only "Needs you" in amber or "Working". Every project has one; the first time you open it is meeting it, in its chat.

**A project list** gives only projects a mark and a heavier name. A chat is its title in muted text, lined up under the project's name. It brightens when it's open, working or needs you, and its time shows on hover.

**A file an agent made for you** is a link in the chat's link blue, with a small arrow before its name. The agent keeps it in the project's hidden `.aven/files` folder, which Git leaves alone. Clicking the link saves a copy to Downloads as a browser does, keeping both when the name is taken; a small popup under the link names the copy, says Downloaded, and offers Open and Show in Finder, and the arrow becomes a check. A link to any other file opens it in Aven.

**A settings row** has its label and one line on the left and its control on the right. Pick the simplest control: a switch for on and off, segments for two or three short choices, a menu for more.

**A sidebar for a mode** belongs to that mode. While Settings is open, the sidebar shows Back to app, search and the sections, and nothing else.

**A work area** has the thing you talk to or work in on the left and a panel on the right. The panel has one header, a row of tabs and one scrolling body.

**Tabs join only on purpose.** Passing over a tab, or letting go on it quickly, only moves yours. Rest on it while a line fills around it, about half a second, and letting go then joins them.

**A menu** is solid, not see-through. It lists what applies, most common first, with sentence-case labels. Group rows with one separator, and move rare choices into a page inside the menu.

**An empty state** is one centred sentence saying what will appear here, in muted text. Add no illustration and no button unless the next step is obvious.

**A new chat** has faint grey ink behind its words that the pointer stirs: a halftone of 3px cells in the text colour, never tinted. Holding gathers it and letting go bursts it outward; left alone it fades and stops. It shows only on a plain new chat (not with a chat background, the games, or Reduce motion) and fades out with the first message.

**The pointer** is a soft, see-through dot about a fingertip wide (like the iPad's) with no outline, floating on a gentle shadow that keeps it visible over white pages and images. It shows over every part of Aven's own interface, form labels, check boxes and the code editor's buttons included, and is one size everywhere: over something you can press or drag (a tab, a sidebar row) it is only a little brighter, and it is plain on a disabled control or while something is busy. Text fields keep the I-beam, resize edges keep their arrows, and the closed hand shows only while dragging. Pages in the browser keep their own pointer, and the Mac's pointer comes back when it is enlarged or Increase contrast is on.

**An agent using your Mac** looks like it does in Aven. The bar at the top of the screen is a pill of the same dark glass with a row per agent: its Bot, its 5×5 dots drawing what it is doing, its name and a few muted words ("Clicking “Next…” in Pages"). The dots are that agent's Stop, as in the message box, and Pause shows only while the bar is pointed at. Its pointer is Aven's soft dot with a small dark tag (Bot, name, step) that shrinks to Bot alone once it stops acting. A thin white frame sits right behind the window it uses. A question ("Let Claude use your Mac?") is one sentence with Not now and one light Allow. No colour washes: colour is only in Bot.

**An agent** (Avos, a teammate, a bot, a chat) is drawn as Bot: a little robot with a dark face, two glowing eyes and a light on its antenna. Avos, a bot and a chat wear their project's colour, a teammate its role's, and its eyes and light turn amber when it needs you. At 28 px and up it wears its role's outfit (Avos a headset, the Builder a hard hat); below 24 px it drops its bolts and outfit and draws bigger eyes. A project's mark never stands for an agent.

**Numbers** stay small. Use a few quiet tiles only in a panel's Overview. Home shows small chips, and only when the number isn't zero.

**Tools on a pane** show on hover or focus.

## Glass

The top row and sidebar are one see-through surface, with the work in one rounded card on it. No lines between them.

Popups, menus and dialogs share one dark glass (the end of `src/macos-theme.css`), nearly solid so words behind never show through, even if the blur is lost for a moment. The hover sidebar is a rounded card floating over the work, showing the window's own glass. Never put blur inside something that scrolls: it costs a lot of power and speed.

## Motion

- Respond on press. Never make someone wait for an animation.
- Animate only `transform` and `opacity`. Motion must be interruptible, and every animation must end by itself.
- The one exception is an agent's mark (Bot). It keeps typing while the agent works and keeps bouncing while it needs you, because those states last until they change. At rest it bobs slowly with its eyes closed, and while watching its eyes drift and it blinks now and then; each agent starts at a different point, so helpers never move together. Only a few small parts move (the bot as a whole, its eyes, its light, one key), never the drawing itself, and it holds still while the window is hidden or resizing, and shows a still frame under Reduce motion.
- The dots beside the Bot in the message box move for the same reason, while a turn runs. They are a 5×5 grid that draws what the agent is doing: a ripple from the middle while it thinks, lines filling in while it writes, a sweep corner to corner for a tool, the grid breathing slowly while something holds it up, and an amber "!" when it needs you. They are also its one Stop: pointed at, their middle nine light as a square, and pressing it puts the dots out. Beside them go a few muted words ("Writing", "Edit app.js", "Needs you"), and the time only shows when you point at them. No pill goes around them. In a narrow box the dots stand alone, unless the words say it needs you or what holds it up.
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

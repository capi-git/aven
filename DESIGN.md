# Aven design rules

Aven should feel like a calm, plain tool: mostly dark and grey, little on screen, and nothing asking for attention unless it needs you. These rules come from MonoCode's interface, which sets the standard for how clean Aven should look, and from what Aven's owner has asked for and rejected.

Follow them in anything you add or change. When a rule and a request disagree, follow the request and update this file if the rule has changed.

## The five rules

1. **Show only what applies.** Hide a row, button or label that does nothing right now. Don't grey it out.
2. **Only speak up if it needs you.** Nothing appears because something finished or moved. No confirmation toasts, no "Review" or "Done" labels. "Needs you" is the one status label a list row may show.
3. **Say each thing once.** Name something in one place, and put each action in one place per pane. If a header names it, the row below doesn't.
4. **Keep the common path one click away.** Put the rare choices one level deeper: a `…` menu, a page inside a menu, or a Customise row.
5. **Use a few words.** One short line at most under anything. A longer explanation goes in a tooltip or behind a disclosure, never in a paragraph on the page.

## Colour

- Surfaces, hovers, selections, previews, borders and shadows are neutral grey. Never wash a surface with a colour.
- Colour appears only in small marks that mean something: status words, errors, diff `+` and `−`, provider icons, and the lit dots of project and teammate marks.
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
- Use at most one hairline per header. Rows in a list or card are split by a hairline, not by gaps and boxes.
- Line a section heading up with the edge of its card, and a page title with the same edge.
- Don't nest a card inside a card, or a tile inside a tile. That includes the app icon: macOS draws its one tile.

## Patterns

**A page** has a title, one short line under it, then sections. A section is a small muted heading above one card of rows.

**A settings row** has its label and one line on the left and its control on the right. Pick the simplest control: a switch for on and off, segments for two or three short choices, a menu for more.

**A sidebar for a mode** belongs to that mode. While Settings is open, the sidebar shows Back to app, search and the sections, and nothing else.

**A work area** has the thing you talk to or work in on the left and a panel on the right. The panel has one header, a row of tabs and one scrolling body.

**A menu** is solid, not see-through. It lists what applies, most common first, with sentence-case labels. Group rows with one separator, and move rare choices into a page inside the menu.

**An empty state** is one centred sentence saying what will appear here, in muted text. Add no illustration and no button unless the next step is obvious.

**Numbers** stay small. Use a few quiet tiles only in a panel's Overview. Home shows small chips, and only when the number isn't zero.

**Tools on a pane** show on hover or focus.

## Glass

Only the window and its chrome may be see-through. Popups, menus and dialogs are solid. Never put blur inside something that scrolls: it costs a lot of power and speed.

## Motion

- Respond on press. Never make someone wait for an animation.
- Animate only `transform` and `opacity`. Motion must be interruptible, and every animation must end by itself.
- Use the springs in `src/lib/motionTokens.ts` for things you can touch, with no bounce unless a flick caused it.
- Honour Reduce motion.
- Native browser pages can't be animated. Move a picture of the page instead, and hold only the pages that really move.
- Never restyle the whole window: no rule on `html *`, and no inherited property set on `body` or `html` during an interaction.

## Words

- Write plain sentences in British English, with sentence case for labels and titles.
- Say what a person gets, not how it works. A refusal says what to do next.
- Use one word for one thing:

| Say                          | Not                     |
| ---------------------------- | ----------------------- |
| Chat                         | Session, thread         |
| Team, Teammates              | Crew, Monos, sub-agents |
| Copy                         | Worktree                |
| Provider                     | Harness                 |
| Instructions                 | Soul                    |
| Schedule                     | Habits                  |
| Keyboard shortcuts           | Keybindings             |
| Full access, Auto, Ask first | Permission mode names   |

## Before you finish

- Can anything be removed? Remove it.
- Does anything show when it doesn't apply?
- Is anything named twice, or does any action appear twice?
- Did you add a colour, text size or corner that isn't a token?
- Does it work in a narrow pane, in light mode and with Reduce motion on?
- Did you look at it in the real app? See `docs/DEVELOPMENT.md`.

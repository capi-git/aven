# Notion
- Notion is an Electron app; the first appState after launch can be incomplete. Call appState again if the page body is missing.
- Each paragraph or block is its own editable text element. Click (focus) the block, then use typeText. Typing "/" opens the block menu; prefer pressing visible toolbar buttons instead.
- The sidebar lists pages as rows; expand nested pages with their disclosure button.
- Page titles are a separate text element above the first block.
- Content outside the viewport is not listed. Scroll the page's scroll area with direction "down" and call appState again.

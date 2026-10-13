# Slack
- Slack is an Electron app. Aven turns on its full accessibility tree on first use; if the first appState looks sparse, call appState once more.
- The message composer is a text area labelled with the channel or person ("Message #general"). Use typeText with that element; pressKey Enter sends, so only press it when the user asked you to send.
- Channels and direct messages are rows in the sidebar list. Click the row rather than typing into the quick switcher when the row is visible.
- Threads and the activity view open in a side pane. Take a new appState after opening one; its controls get new indexes.
- Reactions, edit and delete live in the hover toolbar or a message's context menu (secondaryAction). Confirm destructive choices with the user first.

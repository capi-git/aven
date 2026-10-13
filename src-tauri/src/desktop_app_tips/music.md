# Music and Spotify
- Playback controls (play/pause, next, previous) are buttons in the player bar; click them by element index instead of using media keys.
- Volume and position are sliders: use setValue with a number, or pressKey ArrowUp/ArrowDown on the slider.
- Search with the search field (setValue or typeText), then pressKey Enter on it and call appState again for the results.
- Spotify is Chromium-based; if its tree is sparse after the first appState, call appState again.
- Avoid purchases, subscription changes or deleting playlists without the user's confirmation.

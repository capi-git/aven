(() => {
  // Run in an isolated world: never trust page-replaced DOM helpers. This is
  // deliberately conservative; arbitrary app state cannot be reconstructed.
  const blockers = new Set();
  if (document.readyState !== "complete") blockers.add("loading");
  if (!navigator.userActivation) blockers.add("unknown-page-state");
  else if (navigator.userActivation.hasBeenActive) blockers.add("user-interaction");
  if (document.designMode === "on") blockers.add("editable-page");
  const walker = document.createTreeWalker(document.documentElement, 1);
  let count = 0;
  for (let element = walker.nextNode(); element; element = walker.nextNode()) {
    if (++count > 20000) return { blockers: ["complex-page"] };
    const tag = element.localName;
    if (tag === "iframe" || tag === "frame") blockers.add("embedded-frame");
    if (tag === "audio" || tag === "video") blockers.add("media");
    if (tag === "canvas" || tag === "object" || tag === "embed") blockers.add("interactive-content");
    if (element.shadowRoot || tag.includes("-")) blockers.add("custom-content");
    if (element.isContentEditable || tag === "textarea" || tag === "select" ||
        (tag === "input" && !["button", "submit", "reset", "hidden"].includes(element.type)))
      blockers.add("form-or-editor");
  }
  if (document.pictureInPictureElement || document.fullscreenElement) blockers.add("media");
  if (navigator.mediaSession?.playbackState === "playing") blockers.add("media");
  return { blockers: [...blockers] };
})()

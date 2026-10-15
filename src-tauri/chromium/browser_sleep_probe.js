(() => {
  // Run in an isolated world: never trust page-replaced DOM helpers. Like
  // Chrome's Memory Saver, a hidden page may be reloaded later unless it holds
  // state a reload would lose: edits in its forms or editors, media that is
  // playing, embedded frames or canvases. Field contents are only compared
  // with their defaults here; nothing is read out of the page.
  const blockers = new Set();
  if (document.readyState !== "complete") blockers.add("loading");
  // Pages from engines without this API cannot be judged; leave them alone.
  if (!navigator.userActivation) blockers.add("unknown-page-state");
  if (document.designMode === "on") blockers.add("editable-page");
  const edited = (element) => {
    const tag = element.localName;
    if (element.isContentEditable) return true;
    if (tag === "textarea") return element.value !== element.defaultValue;
    if (tag === "select") {
      // A single select shows its marked option, or else its first one.
      const options = [...element.options];
      if (element.multiple)
        return options.some((option) => option.selected !== option.hasAttribute("selected"));
      const marked = options.map((option) => option.hasAttribute("selected")).lastIndexOf(true);
      const chosen = options.findIndex((option) => option.selected);
      return chosen !== (marked >= 0 ? marked : options.length ? 0 : -1);
    }
    if (tag !== "input") return false;
    const type = element.type;
    if (["button", "submit", "reset", "hidden", "image"].includes(type)) return false;
    if (type === "checkbox" || type === "radio") return element.checked !== element.defaultChecked;
    if (type === "file") return !!element.files && element.files.length > 0;
    return element.value !== element.defaultValue;
  };
  let count = 0;
  const visit = (root) => {
    const walker = document.createTreeWalker(root, 1);
    for (let element = walker.nextNode(); element; element = walker.nextNode()) {
      if (++count > 20000) return false;
      const tag = element.localName;
      if (tag === "iframe" || tag === "frame") blockers.add("embedded-frame");
      if ((tag === "audio" || tag === "video") && !element.paused && !element.ended)
        blockers.add("media");
      if (tag === "canvas" || tag === "object" || tag === "embed") blockers.add("interactive-content");
      if (edited(element)) blockers.add("form-or-editor");
      // Open shadow roots are checked like the rest of the page.
      if (element.shadowRoot && !visit(element.shadowRoot)) return false;
    }
    return true;
  };
  if (!visit(document.documentElement)) return { blockers: ["complex-page"] };
  if (document.pictureInPictureElement || document.fullscreenElement) blockers.add("media");
  if (navigator.mediaSession?.playbackState === "playing") blockers.add("media");
  return { blockers: [...blockers] };
})()

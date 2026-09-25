(() => {
  // Run in the isolated world. Inspect only whether state can be discarded;
  // never return, persist, or submit field values. A URL cannot restore drafts.
  const blockers = new Set();
  if (document.readyState !== "complete") blockers.add("loading");
  // Only input the user gave this page can be lost. A page they have not
  // clicked, typed in or dropped onto since it loaded holds no draft of theirs,
  // whatever its fields, frames or editors contain. Aven tracks that natively
  // (Chromium's activation flag also counts address-bar loads); without it,
  // fall back to activation. Unknown state counts as touched.
  const touched = typeof __avenTouched === "boolean"
    ? __avenTouched
    : navigator.userActivation?.hasBeenActive !== false;
  if (touched && document.designMode === "on") blockers.add("editable-page");
  const roots = [document];
  let count = 0;
  for (const root of roots) {
    const walker = document.createTreeWalker(root, 1);
    for (let element = walker.nextNode(); element; element = walker.nextNode()) {
      if (++count > 20000) {
        if (touched) return { blockers: ["complex-page"], touched };
        break;
      }
      const tag = element.localName;
      if (element.shadowRoot) roots.push(element.shadowRoot);
      if ((tag === "audio" || tag === "video") && !element.paused && !element.ended)
        blockers.add("media");
      if (!touched) continue;
      // Cross-origin frames and opaque custom controls can contain drafts that
      // the parent document cannot inspect. Let the user finish that work.
      if (tag === "iframe" || tag === "frame") blockers.add("embedded-frame");
      if (tag.includes("-") && !element.shadowRoot &&
          element.getAttribute("contenteditable") !== "false" &&
          (element.matches("[role=textbox], [role=combobox]") || element.hasAttribute("value")))
        blockers.add("editable-page");
      if (element.isContentEditable || element.getAttribute("contenteditable") === "true" ||
          element.getAttribute("contenteditable") === "plaintext-only") blockers.add("editable-page");
      if (tag === "textarea" && (element.value !== "" || element.value !== element.defaultValue))
        blockers.add("dirty-form");
      if (tag === "input") {
        const type = element.type;
        if (type === "checkbox" || type === "radio") {
          if (element.checked !== element.hasAttribute("checked")) blockers.add("dirty-form");
        } else if (type === "file") {
          if (element.files?.length || element.value) blockers.add("dirty-form");
        } else if (!["button", "submit", "reset", "hidden"].includes(type) &&
                   (element.value !== "" || element.value !== element.defaultValue)) {
          // React and other controlled inputs may update defaultValue too.
          // Non-empty fields therefore remain protected even when equal.
          blockers.add("dirty-form");
        }
      }
      if (tag === "select") {
        const options = [...element.options];
        const defaults = options.map(option => option.hasAttribute("selected"));
        if (!element.multiple && !defaults.some(Boolean) && options.length) defaults[0] = true;
        if (options.some((option, index) => option.selected !== defaults[index])) blockers.add("dirty-form");
      }
      if (tag === "canvas") blockers.add("interactive-content");
    }
  }
  if (document.pictureInPictureElement || document.fullscreenElement) blockers.add("media");
  if (navigator.mediaSession?.playbackState === "playing") blockers.add("media");
  return { blockers: [...blockers], touched };
})()

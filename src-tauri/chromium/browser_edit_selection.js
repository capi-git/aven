// Fixed Runtime.callFunctionOn body. The selected DOM Element is `this`.
// Page strings are bounded data; this function performs no writes or messaging.
(function (includeCapture) {
  "use strict";
  if (!(this instanceof Element)) throw new Error("Select a page element to edit.");
  if (!this.isConnected) throw new Error("The selected element is no longer on the page. Select it again.");

  const limit = (value, size) => String(value || "").replace(/\s+/g, " ").trim().slice(0, size);
  const composedParent = (element) => element.parentElement || element.getRootNode().host || null;
  const sensitive = /pass(?:word|wd)?|secret|token|api[-_ ]?key|authorization|credential|one[-_ ]?time|\botp\b|cc[-_ ]?number|credit[-_ ]?card|card[-_ ]?number|\bcvv\b|\bcvc\b/i;
  const excluded = (element) => {
    const tag = element.localName.toLowerCase();
    if (["input", "textarea", "select", "option", "script", "style", "noscript", "template"].includes(tag)) return true;
    if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") return true;
    if (element.hasAttribute("data-private") || element.hasAttribute("data-sensitive")) return true;
    const editable = element.getAttribute("contenteditable");
    if (editable !== null && editable.toLowerCase() !== "false") return true;
    return ["id", "name", "type", "autocomplete", "aria-label"].some((name) => sensitive.test(element.getAttribute(name) || ""));
  };

  const rootSelector = (element) => {
    const root = element.getRootNode();
    const parts = [];
    let node = element;
    for (let depth = 0; node && depth < 80; depth += 1) {
      if (node.id && node.id.length <= 512) {
        const id = "#" + CSS.escape(node.id);
        if (root.querySelectorAll(id).length === 1) {
          parts.unshift(id);
          return parts.join(" > ");
        }
      }
      let index = 1;
      for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
        if (sibling.localName === node.localName && sibling.namespaceURI === node.namespaceURI) index += 1;
      }
      parts.unshift(CSS.escape(node.localName) + ":nth-of-type(" + index + ")");
      node = node.parentElement;
      if (!node) return parts.join(" > ");
    }
    throw new Error("The selected element is nested too deeply. Select a containing element.");
  };

  const selectors = [];
  let current = this;
  for (let depth = 0; current && depth < 16; depth += 1) {
    selectors.unshift(rootSelector(current));
    const root = current.getRootNode();
    current = root.host || null;
  }
  if (current) throw new Error("The selected element is nested too deeply. Select a containing element.");
  // Each side of >>> is a CSS selector in that element's document or shadow root.
  const selector = selectors.join(" >>> ");
  if (selector.length > 2048) throw new Error("The selected element path is too long. Select a containing element.");

  let text = "";
  let privateSelection = false;
  for (let ancestor = this; ancestor; ancestor = composedParent(ancestor)) {
    if (excluded(ancestor)) { privateSelection = true; break; }
  }
  if (!privateSelection) {
    let node = this;
    for (let visited = 0; node && visited < 4000 && text.length < 1000; visited += 1) {
      const skip = node.nodeType === Node.ELEMENT_NODE && excluded(node);
      if (node.nodeType === Node.TEXT_NODE) text += " " + limit(node.nodeValue, 1000 - text.length);
      if (!skip && node.firstChild) { node = node.firstChild; continue; }
      while (node !== this && !node.nextSibling) node = node.parentNode;
      if (node === this) break;
      node = node.nextSibling;
    }
  }

  const selection = {
    url: limit(this.ownerDocument.URL, 2048),
    title: limit(this.ownerDocument.title, 240),
    selector,
    tag: limit(this.localName.toLowerCase(), 64),
    text: limit(text, 1000),
  };
  if (!includeCapture) return selection;
  const view = this.ownerDocument.defaultView;
  if (!view || view !== view.top) throw new Error("Select an element in the main page.");
  const rect = this.getBoundingClientRect();
  const viewport = view.visualViewport;
  return {
    selection,
    capture: {
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      viewport: {
        x: viewport?.offsetLeft ?? 0,
        y: viewport?.offsetTop ?? 0,
        width: viewport?.width ?? view.innerWidth,
        height: viewport?.height ?? view.innerHeight,
      },
      scrollX: view.scrollX,
      scrollY: view.scrollY,
      deviceScale: view.devicePixelRatio,
    },
  };
})

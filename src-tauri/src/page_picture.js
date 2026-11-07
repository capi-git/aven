// Where things are on a page pictured for Avos's Review, read in a WebKit
// world of Aven's own (the page's scripts can't see it). `marks` are the
// selectors of the spots the Builder named; each comes back as a box or
// null. `parts` are the visible things you might click to leave a note,
// each with a box, a few words on what it is and a selector to find it.
// Boxes are fractions of the window: [left, top, width, height].
((marks) => {
  const vw = window.innerWidth || 1;
  const vh = window.innerHeight || 1;
  const round = (n) => Math.round(n * 10000) / 10000;
  const box = (r) => {
    const left = Math.max(0, r.left);
    const top = Math.max(0, r.top);
    const right = Math.min(vw, r.right);
    const bottom = Math.min(vh, r.bottom);
    if (right - left < 2 || bottom - top < 2) return null;
    return [left / vw, top / vh, (right - left) / vw, (bottom - top) / vh].map(round);
  };
  const shown = (el) => {
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.05;
  };
  const words = (text, max) => {
    const line = String(text || "").replace(/[\s"“”]+/g, " ").trim();
    return line.length > max ? `${line.slice(0, max - 1).trim()}…` : line;
  };
  const KINDS = {
    A: "link", BUTTON: "button", INPUT: "field", SELECT: "menu", TEXTAREA: "field",
    IMG: "picture", SVG: "icon", VIDEO: "video", H1: "heading", H2: "heading",
    H3: "heading", H4: "heading", H5: "heading", H6: "heading", P: "text",
    LI: "list item", LABEL: "label", NAV: "navigation", HEADER: "header",
    FOOTER: "footer", SECTION: "section", FORM: "form", FIGURE: "figure",
    BLOCKQUOTE: "quote", TD: "cell", TH: "cell",
  };
  const ROLES = { button: "button", link: "link", tab: "tab", checkbox: "check box", switch: "switch", menuitem: "menu item", textbox: "field" };
  const kind = (el) => ROLES[el.getAttribute("role")] || KINDS[el.tagName.toUpperCase()] || "";
  const label = (el) =>
    el.getAttribute("aria-label") || el.getAttribute("alt") || el.getAttribute("title") ||
    el.getAttribute("placeholder") || (el.tagName === "INPUT" ? el.value : "") || el.innerText || "";
  const css = (name) => (window.CSS && CSS.escape ? CSS.escape(name) : name.replace(/[^\w-]/g, ""));
  const step = (el) => {
    if (el.id) return `#${css(el.id)}`;
    const tag = el.tagName.toLowerCase();
    const named = [...el.classList].find((name) => /^[a-zA-Z][\w-]{1,30}$/.test(name));
    const parent = el.parentElement;
    const same = parent ? [...parent.children].filter((child) => child.tagName === el.tagName) : [];
    const nth = same.length > 1 ? `:nth-of-type(${same.indexOf(el) + 1})` : "";
    return named ? `${tag}.${css(named)}${nth}` : `${tag}${nth}`;
  };
  const path = (el) => {
    const steps = [];
    for (let at = el; at && at !== document.body && steps.length < 3; at = at.parentElement) {
      steps.unshift(step(at));
      if (at.id) break;
    }
    return steps.join(" > ").slice(0, 200);
  };
  const spots = marks.map((selector) => {
    try {
      const el = document.querySelector(selector);
      return el && shown(el) ? box(el.getBoundingClientRect()) : null;
    } catch {
      return null;
    }
  });
  const parts = [];
  const selector = "a,button,input,select,textarea,img,svg,video,h1,h2,h3,h4,h5,h6,p,li,label,nav,header,footer,section,form,figure,blockquote,td,th,[role]";
  for (const el of document.querySelectorAll(selector)) {
    if (parts.length >= 400) break;
    if (el.closest("svg") && el.tagName.toUpperCase() !== "SVG") continue;
    const what = kind(el);
    if (!what || !shown(el)) continue;
    const at = box(el.getBoundingClientRect());
    if (!at) continue;
    const text = words(label(el), 50);
    parts.push({ box: at, what: text ? `${what} “${text}”` : what, element: path(el) });
  }
  return JSON.stringify({ spots, parts });
})

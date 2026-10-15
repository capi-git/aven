import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";

const script = readFileSync(new URL("./browser_sleep_probe.js", import.meta.url), "utf8");
function fixture(markup = "<main><h1>Reference page</h1><p>Read-only text.</p></main>") {
  const window = new Window();
  Object.defineProperty(window.document, "readyState", { value: "complete", configurable: true });
  Object.defineProperty(window.navigator, "userActivation", { value: { hasBeenActive: false }, configurable: true });
  window.document.body.innerHTML = markup;
  return { window, probe: () => new Function("document", "navigator", `return ${script}`)(window.document, window.navigator) };
}

test("read-only complete document is eligible and remains untouched", () => {
  const { window, probe } = fixture();
  const before = window.document.documentElement.outerHTML;
  assert.deepEqual(probe(), { blockers: [] });
  assert.equal(window.document.documentElement.outerHTML, before);
});

test("a page the user has used can sleep; one that cannot say so stays", () => {
  const { window, probe } = fixture();
  window.navigator.userActivation.hasBeenActive = true;
  assert.deepEqual(probe(), { blockers: [] });
  Object.defineProperty(window.navigator, "userActivation", { value: undefined });
  assert.ok(probe().blockers.includes("unknown-page-state"));
});

test("untouched forms do not block; edited ones and editors do", () => {
  const untouched = '<input value="docs"><input type=checkbox><select><option selected>A</option><option>B</option></select><textarea>Draft</textarea><input type=submit>';
  assert.deepEqual(fixture(untouched).probe(), { blockers: [] });
  const edits = [
    ["<input>", (el) => { el.value = "typed"; }],
    ["<input type=password>", (el) => { el.value = "secret"; }],
    ["<textarea></textarea>", (el) => { el.value = "a note"; }],
    ["<input type=checkbox>", (el) => { el.checked = true; }],
    ["<select><option>A</option><option>B</option></select>", (el) => { el.options[1].selected = true; }],
  ];
  for (const [markup, edit] of edits) {
    const { window, probe } = fixture(markup);
    edit(window.document.body.firstChild);
    assert.deepEqual(probe().blockers, ["form-or-editor"], markup);
  }
  assert.ok(fixture('<div contenteditable=true></div>').probe().blockers.includes("form-or-editor"));
});

test("media blocks only while it plays", () => {
  for (const markup of ["<audio></audio>", "<video muted></video>"]) {
    assert.deepEqual(fixture(markup).probe(), { blockers: [] }, markup);
    const { window, probe } = fixture(markup);
    Object.defineProperty(window.document.body.firstChild, "paused", { value: false });
    assert.ok(probe().blockers.includes("media"), markup);
  }
  const { window, probe } = fixture();
  Object.defineProperty(window.navigator, "mediaSession", { value: { playbackState: "playing" } });
  assert.ok(probe().blockers.includes("media"));
});

test("frames, canvas and plugins block; custom elements and shadow content are checked", () => {
  for (const [markup, blocker] of [["<iframe></iframe>", "embedded-frame"], ["<canvas></canvas>", "interactive-content"], ["<object></object>", "interactive-content"]]) {
    assert.ok(fixture(markup).probe().blockers.includes(blocker), markup);
  }
  assert.deepEqual(fixture("<custom-list><span>Row</span></custom-list>").probe(), { blockers: [] });
  const { window, probe } = fixture("<div></div>");
  window.document.body.firstChild.attachShadow({ mode: "open" }).innerHTML = "<input>";
  assert.deepEqual(probe(), { blockers: [] });
  window.document.body.firstChild.shadowRoot.firstChild.value = "typed";
  assert.ok(probe().blockers.includes("form-or-editor"));
});

test("loading and overly complex documents are not discarded", () => {
  const { window, probe } = fixture();
  Object.defineProperty(window.document, "readyState", { value: "loading" });
  assert.ok(probe().blockers.includes("loading"));
  const large = fixture("<span></span>".repeat(20001));
  assert.deepEqual(large.probe(), { blockers: ["complex-page"] });
});

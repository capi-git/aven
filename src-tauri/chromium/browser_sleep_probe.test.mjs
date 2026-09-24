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

test("user activation or unavailable activation state fails closed", () => {
  const { window, probe } = fixture();
  window.navigator.userActivation.hasBeenActive = true;
  assert.ok(probe().blockers.includes("user-interaction"));
  Object.defineProperty(window.navigator, "userActivation", { value: undefined });
  assert.ok(probe().blockers.includes("unknown-page-state"));
});

test("forms and editors block without reading private field values", () => {
  for (const markup of ["<input>", "<input type=password>", "<input type=file>", "<textarea></textarea>", "<select></select>", '<div contenteditable=true></div>']) {
    const { window, probe } = fixture(markup);
    Object.defineProperty(window.document.body.firstChild, "value", { get() { throw new Error("Do not read values"); } });
    assert.ok(probe().blockers.includes("form-or-editor"), markup);
  }
});

test("media blocks even while paused or muted", () => {
  for (const markup of ["<audio></audio>", "<video muted></video>"]) {
    assert.ok(fixture(markup).probe().blockers.includes("media"));
  }
  const { window, probe } = fixture();
  Object.defineProperty(window.navigator, "mediaSession", { value: { playbackState: "playing" } });
  assert.ok(probe().blockers.includes("media"));
});

test("frames, canvas, plugins and shadow content fail closed", () => {
  for (const [markup, blocker] of [["<iframe></iframe>", "embedded-frame"], ["<canvas></canvas>", "interactive-content"], ["<object></object>", "interactive-content"], ["<custom-editor></custom-editor>", "custom-content"]]) {
    assert.ok(fixture(markup).probe().blockers.includes(blocker), markup);
  }
  const { window, probe } = fixture("<div></div>");
  window.document.body.firstChild.attachShadow({ mode: "open" }).innerHTML = "<input>";
  assert.ok(probe().blockers.includes("custom-content"));
});

test("loading and overly complex documents are not discarded", () => {
  const { window, probe } = fixture();
  Object.defineProperty(window.document, "readyState", { value: "loading" });
  assert.ok(probe().blockers.includes("loading"));
  const large = fixture("<span></span>".repeat(20001));
  assert.deepEqual(large.probe(), { blockers: ["complex-page"] });
});

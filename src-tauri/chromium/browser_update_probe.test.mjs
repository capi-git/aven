import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";

const script = readFileSync(new URL("./browser_update_probe.js", import.meta.url), "utf8");
function fixture(markup = "<main><h1>Reference</h1><input type=search></main>") {
  const window = new Window();
  Object.defineProperty(window.document, "readyState", { value: "complete", configurable: true });
  Object.defineProperty(window.navigator, "userActivation", { value: { hasBeenActive: true } });
  window.document.body.innerHTML = markup;
  const probe = () => new Function("document", "navigator", `return ${script}`)(window.document, window.navigator);
  return { window, probe };
}

test("ordinary visited page with empty search field can update without mutation", () => {
  const { window, probe } = fixture();
  const before = window.document.documentElement.outerHTML;
  assert.deepEqual(probe(), { blockers: [] });
  assert.equal(window.document.documentElement.outerHTML, before);
});

test("protects edited and controlled form fields without returning private values", () => {
  for (const markup of ["<input>", "<input type=password>", "<textarea></textarea>"]) {
    const { window, probe } = fixture(markup);
    const input = window.document.body.firstChild;
    input.value = "private draft";
    assert.deepEqual(probe(), { blockers: ["dirty-form"] });
    input.defaultValue = "private draft";
    assert.deepEqual(probe(), { blockers: ["dirty-form"] });
    input.value = "";
    assert.deepEqual(probe(), { blockers: ["dirty-form"] });
  }
});

test("protects file selections and changed checkbox/select state", () => {
  const file = fixture("<input type=file>");
  Object.defineProperty(file.window.document.body.firstChild, "files", { value: { length: 1 } });
  assert.ok(file.probe().blockers.includes("dirty-form"));
  const checkbox = fixture("<input type=checkbox>");
  checkbox.window.document.body.firstChild.checked = true;
  assert.ok(checkbox.probe().blockers.includes("dirty-form"));
  const select = fixture("<select><option selected>A</option><option>B</option></select>");
  assert.deepEqual(select.probe(), { blockers: [] });
  select.window.document.body.firstChild.selectedIndex = 1;
  assert.ok(select.probe().blockers.includes("dirty-form"));
});

test("opaque frames and editors stay protected, open shadows are inspected", () => {
  for (const markup of ["<iframe></iframe>", "<div contenteditable=true></div>", "<custom-editor role=textbox></custom-editor>"]) {
    assert.notEqual(fixture(markup).probe().blockers.length, 0);
  }
  const { window, probe } = fixture("<custom-card></custom-card>");
  const shadow = window.document.body.firstChild.attachShadow({ mode: "open" });
  shadow.innerHTML = "<input>";
  assert.deepEqual(probe(), { blockers: [] });
  shadow.firstChild.value = "private shadow draft";
  assert.deepEqual(probe(), { blockers: ["dirty-form"] });
});

test("loading and active media block while paused ordinary media is allowed", () => {
  const { window, probe } = fixture("<video></video>");
  assert.deepEqual(probe(), { blockers: [] });
  Object.defineProperty(window.document.body.firstChild, "paused", { value: false });
  assert.ok(probe().blockers.includes("media"));
  Object.defineProperty(window.document, "readyState", { value: "loading" });
  assert.ok(probe().blockers.includes("loading"));
});

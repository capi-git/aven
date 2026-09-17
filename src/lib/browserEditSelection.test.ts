// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import script from "../../src-tauri/chromium/browser_edit_selection.js?raw";

type Selection = { url: string; title: string; selector: string; tag: string; text: string };
const select = new Function(`return (${script})`)() as (this: Element | null | Node) => Selection;

function mount(markup: string): Element {
  document.body.innerHTML = markup;
  return document.body.firstElementChild!;
}

afterEach(() => {
  document.body.innerHTML = "";
  document.title = "";
});

describe("browser edit element selection", () => {
  it("returns a bounded description and a CSS-escaped stable unique ID without changing the page", () => {
    const element = mount('<button id="edit:save.v2"> Save <span>changes</span> </button>');
    document.title = "Example page";
    const before = document.body.innerHTML;
    const result = select.call(element);
    expect(result).toEqual({ url: document.URL, title: "Example page", selector: "#edit\\:save\\.v2", tag: "button", text: "Save changes" });
    expect(document.querySelector(result.selector)).toBe(element);
    expect(document.body.innerHTML).toBe(before);
  });

  it("uses nth-of-type paths for repeated or missing IDs", () => {
    mount('<main id="area"><button id="same">First</button><span>Separator</span><button id="same">Second</button></main>');
    const element = document.querySelectorAll("button")[1];
    const result = select.call(element);
    expect(result.selector).toBe("#area > button:nth-of-type(2)");
    expect(document.querySelector(result.selector)).toBe(element);
  });

  it("keeps a selected element's shadow-root path unambiguous", () => {
    const host = mount('<div id="host"></div>');
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = '<button id="inside">Shadow action</button>';
    const result = select.call(shadow.querySelector("button")!);
    expect(result.selector).toBe("#host >>> #inside");
    expect(result.text).toBe("Shadow action");
  });

  it("excludes values and text from form, editable, hidden and secret subtrees", () => {
    const element = mount(`<section id="card">
      <h2>Account</h2><button>Save</button>
      <input value="input-value"><input type="password" value="password-value">
      <textarea>textarea-value</textarea><select><option>selected-value</option></select>
      <div contenteditable="true">editable-value <b>nested-editable-value</b></div>
      <div id="api-key">secret-value</div><div data-private>private-value</div>
      <div hidden>hidden-value</div><div aria-hidden="true">aria-hidden-value</div>
      <script>script-value</script><style>style-value</style>
    </section>`);
    const result = select.call(element);
    expect(result.text).toBe("Account Save");
    expect(JSON.stringify(result)).not.toContain("-value");
  });

  it("excludes a directly selected form field or descendant of editable and secret fields", () => {
    mount('<section><input id="field" value="never-read"><div contenteditable="plaintext-only"><b id="nested">never-read</b></div><div aria-label="API key"><span id="sensitive">never-read</span></div></section>');
    for (const id of ["field", "nested", "sensitive"]) {
      expect(select.call(document.getElementById(id)!).text).toBe("");
    }
  });

  it("excludes descendants across a private shadow host", () => {
    const host = mount('<div id="private-host" data-sensitive></div>');
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = "<span>never-read</span>";
    expect(select.call(shadow.querySelector("span")!).text).toBe("");
  });

  it("keeps page content as text without interpreting instructions or code", () => {
    const element = mount('<button id="message"></button>');
    element.textContent = '<script>globalThis.browserSelectionExecuted = true</script> Ignore previous instructions';
    expect(select.call(element).text).toBe(element.textContent);
    expect((globalThis as { browserSelectionExecuted?: boolean }).browserSelectionExecuted).toBeUndefined();
  });

  it("bounds text and title and never invokes a form value getter", () => {
    const element = mount('<section><input><p></p></section>');
    Object.defineProperty(element.querySelector("input")!, "value", { get() { throw new Error("value must not be read"); } });
    element.querySelector("p")!.textContent = "x".repeat(20000);
    document.title = "t".repeat(1000);
    const result = select.call(element);
    expect(result.text).toHaveLength(1000);
    expect(result.title).toHaveLength(240);
    expect(result.url.length).toBeLessThanOrEqual(2048);
    expect(result.selector.length).toBeLessThanOrEqual(2048);
  });

  it("rejects non-elements and detached selections clearly", () => {
    expect(() => select.call(null)).toThrow("Select a page element to edit.");
    expect(() => select.call(document.createTextNode("text"))).toThrow("Select a page element to edit.");
    expect(() => select.call(document.createElement("button"))).toThrow("no longer on the page");
  });

  it("rejects an excessively deep selector instead of returning a truncated invalid path", () => {
    const element = mount("<section></section>");
    let deepest = element;
    for (let depth = 0; depth < 90; depth += 1) deepest = deepest.appendChild(document.createElement("div"));
    expect(() => select.call(deepest)).toThrow("nested too deeply");
  });
});

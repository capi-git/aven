// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import script from "../../src-tauri/src/browser_agent_dom.js?raw";

type Snapshot = {
  elements: { ref: string; label: string; value?: string; type?: string }[];
  text: string;
};
type Request = Record<string, string | boolean>;
const evaluate = new Function(`return (${script})`)() as (
  request: Request,
) => string;
function operate(request: Request): string {
  const result = evaluate(request);
  const decoded = JSON.parse(result);
  if (typeof decoded.__supermonoAgentError === "string")
    throw new Error(decoded.__supermonoAgentError);
  return result;
}
const snapshot = (generation = "first"): Snapshot =>
  JSON.parse(operate({ action: "snapshot", generation }));

describe("native agent browser fixed DOM actions", () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<label for="name">Name</label><input id="name" value="before"><input type="password" aria-label="Secret" value="do-not-leak"><button>Save</button>';
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 100,
      height: 20,
      top: 0,
      bottom: 20,
      left: 0,
      right: 100,
      toJSON() {},
    });
    vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(
      () => {},
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("returns actionable references without reading password values", () => {
    const state = snapshot();
    expect(state.elements.find((item) => item.label === "Name")?.value).toBe(
      "before",
    );
    expect(
      state.elements.find((item) => item.type === "password")?.value,
    ).toBeUndefined();
    expect(JSON.stringify(state)).not.toContain("do-not-leak");
  });

  it("fills the real input and dispatches changes, then clicks the referenced control", () => {
    const input = document.querySelector<HTMLInputElement>("#name")!;
    const button = document.querySelector("button")!;
    const inputChanged = vi.fn();
    const clicked = vi.fn();
    input.addEventListener("input", inputChanged);
    button.addEventListener("click", clicked);
    const state = snapshot();
    operate({
      action: "fill",
      ref: state.elements.find((item) => item.label === "Name")!.ref,
      value: "after",
    });
    operate({
      action: "click",
      ref: state.elements.find((item) => item.label === "Save")!.ref,
    });
    expect(input.value).toBe("after");
    expect(inputChanged).toHaveBeenCalledOnce();
    expect(clicked).toHaveBeenCalledOnce();
  });

  it("rejects previous generations and disconnected elements", () => {
    const old = snapshot().elements[0].ref;
    snapshot("second");
    expect(() =>
      operate({ action: "fill", ref: old, value: "changed" }),
    ).toThrow("Stale reference");
    const state = snapshot("third");
    document.querySelector("button")!.remove();
    expect(() =>
      operate({
        action: "click",
        ref: state.elements.find((item) => item.label === "Save")!.ref,
      }),
    ).toThrow("no longer visible");
  });

  it("rejects references when same-document navigation changes the URL", () => {
    const state = snapshot();
    history.pushState(null, "", "?agent-snapshot-navigation=1");
    expect(() =>
      operate({
        action: "click",
        ref: state.elements.find((item) => item.label === "Save")!.ref,
      }),
    ).toThrow("Stale reference");
  });

  it("rejects disabled and read-only controls without changing them", () => {
    document.querySelector<HTMLInputElement>("#name")!.readOnly = true;
    document.querySelector<HTMLButtonElement>("button")!.disabled = true;
    const state = snapshot();
    expect(() =>
      operate({
        action: "fill",
        ref: state.elements.find((item) => item.label === "Name")!.ref,
        value: "changed",
      }),
    ).toThrow("read only");
    expect(() =>
      operate({
        action: "click",
        ref: state.elements.find((item) => item.label === "Save")!.ref,
      }),
    ).toThrow("disabled");
    expect(document.querySelector<HTMLInputElement>("#name")!.value).toBe(
      "before",
    );
  });

  it("returns bounded actionable errors through WebKit's JSON result", () => {
    const result = JSON.parse(evaluate({ action: "click", ref: "missing:1" }));
    expect(result.__supermonoAgentError).toContain("Stale reference");
    expect(result.__supermonoAgentError.length).toBeLessThanOrEqual(500);
  });

  it("treats input as text and never interprets it as JavaScript", () => {
    const payload = '<script>globalThis.compromised=true</script>";throw 1;//';
    const state = snapshot();
    operate({
      action: "fill",
      ref: state.elements.find((item) => item.label === "Name")!.ref,
      value: payload,
    });
    expect(document.querySelector<HTMLInputElement>("#name")!.value).toBe(
      payload,
    );
    expect(
      (globalThis as unknown as { compromised?: boolean }).compromised,
    ).toBeUndefined();
  });

  const ref = (label: string) =>
    snapshot().elements.find((item) => item.label === label)!.ref;
  const decode = (request: Request) => JSON.parse(operate(request));

  it("focuses the field inside the page so a following key press reaches it", () => {
    const input = document.querySelector<HTMLInputElement>("#name")!;
    const result = decode({ action: "fill", ref: ref("Name"), value: "x" });
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("x");
    expect(result.method).toBe("value");
    expect(result.target).toEqual({ x: 0, y: 0, width: 100, height: 20 });
    expect(result.viewport.width).toBeGreaterThan(0);
  });

  it("selects existing text for the host's trusted typing, then verifies it", () => {
    const input = document.querySelector<HTMLInputElement>("#name")!;
    const changed = vi.fn();
    input.addEventListener("change", changed);
    const name = ref("Name");
    const result = decode({
      action: "fill",
      ref: name,
      value: "typed",
      native: true,
    });
    expect(result.method).toBe("insert");
    // Nothing is written by the script; the host replaces the selection.
    expect(input.value).toBe("before");
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 6]);
    const verify = { action: "fill-verify", ref: name, value: "typed" };
    expect(decode(verify).matches).toBe(false);
    expect(changed).not.toHaveBeenCalled();
    input.value = "typed";
    expect(decode(verify).matches).toBe(true);
    expect(changed).toHaveBeenCalledOnce();
  });

  it("accepts a page's own formatting of typed text but not ignored or appended text", () => {
    const input = document.querySelector<HTMLInputElement>("#name")!;
    const name = ref("Name");
    const verify = (value: string) =>
      decode({ action: "fill-verify", ref: name, value }).matches;
    // A phone mask reformats the typed digits.
    decode({ action: "fill", ref: name, value: "5551234567", native: true });
    input.value = "(555) 123-4567";
    expect(verify("5551234567")).toBe(true);
    // Typing ignored: the old value is still there.
    decode({ action: "fill", ref: name, value: "5551234567", native: true });
    expect(verify("5551234567")).toBe(false);
    // Typing appended instead of replacing.
    input.value = "before";
    decode({ action: "fill", ref: name, value: "new", native: true });
    input.value = "beforenew";
    expect(verify("new")).toBe(false);
    // A verify without its fill never infers success.
    input.value = "other";
    expect(verify("new")).toBe(false);
  });

  it("keeps the direct value path for selects, dates and clearing", () => {
    document.body.innerHTML =
      '<select aria-label="Size"><option value="s">S</option><option value="m">M</option></select>' +
      '<input type="date" aria-label="When"><input aria-label="Note" value="old">';
    const select = decode({
      action: "fill",
      ref: ref("Size"),
      value: "m",
      native: true,
    });
    expect(select.method).toBe("value");
    expect(document.querySelector("select")!.value).toBe("m");
    const date = decode({
      action: "fill",
      ref: ref("When"),
      value: "2026-10-12",
      native: true,
    });
    expect(date.method).toBe("value");
    const clear = decode({
      action: "fill",
      ref: ref("Note"),
      value: "",
      native: true,
    });
    expect(clear.method).toBe("value");
    expect(
      document.querySelector<HTMLInputElement>('[aria-label="Note"]')!.value,
    ).toBe("");
  });

  it("types into rich text editors through a selection of their content", () => {
    document.body.innerHTML =
      '<div contenteditable="true" aria-label="Body">Old text</div>';
    const result = decode({
      action: "fill",
      ref: ref("Body"),
      value: "New",
      native: true,
    });
    expect(result.method).toBe("insert");
    expect(getSelection()!.toString()).toBe("Old text");
  });

  it("asks for a pointer press only when the element itself is under its centre", () => {
    const button = document.querySelector("button")!;
    const clicked = vi.fn();
    button.addEventListener("click", clicked);
    const hit = vi.spyOn(document, "elementFromPoint").mockReturnValue(button);
    const pointer = decode({
      action: "click",
      ref: ref("Save"),
      pointer: true,
    });
    expect(pointer.method).toBe("pointer");
    expect(pointer.point).toEqual({ x: 50, y: 10 });
    expect(clicked).not.toHaveBeenCalled();
    // Covered by an overlay: click the element directly instead.
    const banner = document.createElement("div");
    document.body.append(banner);
    hit.mockReturnValue(banner);
    expect(
      decode({ action: "click", ref: ref("Save"), pointer: true }).method,
    ).toBe("element");
    expect(clicked).toHaveBeenCalledOnce();
    // Without the host's request (zoomed tab, WebKit), never a pointer press.
    hit.mockReturnValue(button);
    expect(decode({ action: "click", ref: ref("Save") }).method).toBe(
      "element",
    );
    expect(clicked).toHaveBeenCalledTimes(2);
  });

  it("never presses controls whose pointer press opens a native picker", () => {
    document.body.innerHTML =
      '<select aria-label="Size"><option value="s">S</option></select><input type="color" aria-label="Tint">';
    const hit = vi.spyOn(document, "elementFromPoint");
    for (const label of ["Size", "Tint"]) {
      const element = document.querySelector(`[aria-label="${label}"]`)!;
      hit.mockReturnValue(element);
      expect(
        decode({ action: "click", ref: ref(label), pointer: true }).method,
      ).toBe("element");
    }
  });

  it("reports the focused element for key presses without a snapshot", () => {
    expect(decode({ action: "focus-rect" }).target).toBeUndefined();
    document.querySelector<HTMLInputElement>("#name")!.focus();
    expect(decode({ action: "focus-rect" }).target).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 20,
    });
  });

  describe("typing only into the field that really has focus", () => {
    const fillNative = (label: string, value: string) =>
      decode({ action: "fill", ref: ref(label), value, native: true });

    it("sets the value directly when a focus trap redirects focus to another field", () => {
      document.body.innerHTML =
        '<input aria-label="Card" value="old"><input type="password" aria-label="Password">';
      const [card, password] = document.querySelectorAll("input");
      card.addEventListener("focus", () => password.focus());
      const result = fillNative("Card", "4242");
      expect(result.method).toBe("value");
      expect(card.value).toBe("4242");
      expect(password.value).toBe("");
      // No pending trusted typing is left for a later verify to accept.
      expect(
        decode({ action: "fill-verify", ref: ref("Card"), value: "x" }).matches,
      ).toBe(false);
    });

    it("follows focus into shadow roots before typing", () => {
      document.body.innerHTML =
        '<input aria-label="Name" value="old"><div id="host"></div>';
      const host = document.querySelector("#host")!;
      const inner = document.createElement("input");
      host.attachShadow({ mode: "open" }).append(inner);
      const name = document.querySelector<HTMLInputElement>("input")!;
      name.addEventListener("focus", () => inner.focus());
      expect(fillNative("Name", "typed").method).toBe("value");
      expect(name.value).toBe("typed");
      expect(inner.value).toBe("");
    });

    it("types into a rich text editor only when the selection is inside it", () => {
      document.body.innerHTML =
        '<div contenteditable="true" aria-label="Body">Old</div><input aria-label="Other">';
      const body = document.querySelector<HTMLElement>("[contenteditable]")!;
      const other = document.querySelector("input")!;
      body.addEventListener("focus", () => other.focus(), { once: true });
      expect(fillNative("Body", "New").method).toBe("value");
      expect(body.textContent).toBe("New");
      expect(fillNative("Body", "Newer").method).toBe("insert");
    });

    it("leaves the user's caret in another field of the page they are using", () => {
      document.body.innerHTML =
        '<input aria-label="Search" value=""><input aria-label="Name" value="old">';
      const [search, name] = document.querySelectorAll("input");
      vi.spyOn(document, "hasFocus").mockReturnValue(true);
      search.focus();
      const result = fillNative("Name", "typed");
      expect(result.method).toBe("value");
      expect(name.value).toBe("typed");
      expect(document.activeElement).toBe(search);
    });

    it("still types after the agent's own earlier fill holds focus", () => {
      document.body.innerHTML =
        '<input aria-label="First" value=""><input aria-label="Last" value="">';
      const [, last] = document.querySelectorAll("input");
      vi.spyOn(document, "hasFocus").mockReturnValue(true);
      expect(fillNative("First", "Ada").method).toBe("insert");
      expect(fillNative("Last", "Lovelace").method).toBe("insert");
      expect(document.activeElement).toBe(last);
    });

    it("leaves the user's caret in a cross-origin frame it cannot see into", () => {
      document.body.innerHTML =
        '<iframe title="Payment"></iframe><input aria-label="Name" value="old">';
      const frame = document.querySelector("iframe")!;
      const name = document.querySelector("input")!;
      vi.spyOn(document, "hasFocus").mockReturnValue(true);
      const active = vi
        .spyOn(document, "activeElement", "get")
        .mockReturnValue(frame);
      // Cross-origin: no contentDocument, or one that throws.
      const inner = vi
        .spyOn(frame, "contentDocument", "get")
        .mockReturnValue(null);
      const focus = vi.spyOn(name, "focus");
      const result = fillNative("Name", "typed");
      expect(result.method).toBe("value");
      expect(name.value).toBe("typed");
      expect(focus).not.toHaveBeenCalled();
      inner.mockImplementation(() => {
        throw new DOMException("Blocked", "SecurityError");
      });
      expect(fillNative("Name", "again").method).toBe("value");
      expect(focus).not.toHaveBeenCalled();
      // Not the page the user is in: the frame is nobody's caret.
      vi.mocked(document.hasFocus).mockReturnValue(false);
      active.mockRestore();
      expect(fillNative("Name", "typed").method).toBe("insert");
      expect(focus).toHaveBeenCalledOnce();
    });

    it("hands a field back to the user after their own press or key", () => {
      document.body.innerHTML =
        '<input aria-label="First" value=""><input aria-label="Last" value="">';
      const [first] = document.querySelectorAll("input");
      vi.spyOn(document, "hasFocus").mockReturnValue(true);
      const trusted = (type: string, trustedEvent: boolean) => {
        const event = new Event(type, { bubbles: true, composed: true });
        Object.defineProperty(event, "isTrusted", { value: trustedEvent });
        first.dispatchEvent(event);
      };
      expect(fillNative("First", "Ada").method).toBe("insert");
      // A script's synthetic events cannot hand the field over.
      trusted("pointerdown", false);
      trusted("keydown", false);
      expect(fillNative("First", "Ada").method).toBe("insert");
      // The user clicks into the field the agent filled: it is theirs now.
      trusted("pointerdown", true);
      expect(fillNative("Last", "Lovelace").method).toBe("value");
      expect(document.activeElement).toBe(first);
      // Likewise for a key press.
      first.blur();
      expect(fillNative("First", "Ada").method).toBe("insert");
      trusted("keydown", true);
      expect(fillNative("Last", "Byron").method).toBe("value");
      expect(document.activeElement).toBe(first);
    });

    it("re-checks focus and selection immediately before typing", () => {
      document.body.innerHTML =
        '<input aria-label="Name" value="old"><input aria-label="Other">' +
        '<div contenteditable="true" aria-label="Body">Old text</div>';
      const [name, other] = document.querySelectorAll("input");
      // A background page: no caret of the user's to leave alone.
      vi.spyOn(document, "hasFocus").mockReturnValue(false);
      const check = (label: string) =>
        decode({ action: "fill-check", ref: ref(label), value: "x" }).ready;
      const fill = (label: string) => {
        const target = ref(label);
        expect(
          decode({ action: "fill", ref: target, value: "x", native: true })
            .method,
        ).toBe("insert");
        return () =>
          decode({ action: "fill-check", ref: target, value: "x" }).ready;
      };
      // Nothing pending: never type.
      expect(check("Name")).toBe(false);
      expect(fill("Name")()).toBe(true);
      // A trap moves focus after the fill step.
      let ready = fill("Name");
      other.focus();
      expect(ready()).toBe(false);
      // The pending typing is dropped, so it can never be verified as typed.
      expect(ready()).toBe(false);
      // The selection collapsed.
      ready = fill("Name");
      name.setSelectionRange(1, 1);
      expect(ready()).toBe(false);
      // The value changed meanwhile.
      ready = fill("Name");
      name.value = "older";
      name.select();
      expect(ready()).toBe(false);
      // A rich text editor whose selection moved.
      ready = fill("Body");
      expect(ready()).toBe(true);
      ready = fill("Body");
      getSelection()!.collapse(
        document.querySelector("[contenteditable]")!.firstChild!,
        2,
      );
      expect(ready()).toBe(false);
    });

    it("types when the page is not the one the user is in", () => {
      document.body.innerHTML =
        '<input aria-label="Search" value=""><input aria-label="Name" value="old">';
      const [search, name] = document.querySelectorAll("input");
      vi.spyOn(document, "hasFocus").mockReturnValue(false);
      search.focus();
      expect(fillNative("Name", "typed").method).toBe("insert");
      expect(document.activeElement).toBe(name);
    });
  });

  it("scrolls instantly, even under CSS smooth scrolling", () => {
    const scroll = vi.mocked(HTMLElement.prototype.scrollIntoView);
    decode({ action: "click", ref: ref("Save") });
    expect(scroll).toHaveBeenLastCalledWith(
      expect.objectContaining({ behavior: "instant" }),
    );
  });

  it("maps pinch zoom for the pointer marker and never presses through it", () => {
    const button = document.querySelector("button")!;
    vi.spyOn(document, "elementFromPoint").mockReturnValue(button);
    vi.stubGlobal("visualViewport", { scale: 2, offsetLeft: 10, offsetTop: 5 });
    try {
      const result = decode({
        action: "click",
        ref: ref("Save"),
        pointer: true,
      });
      expect(result.method).toBe("element");
      // On screen: (layout - offset) * scale.
      expect(result.target).toEqual({ x: -20, y: -10, width: 200, height: 40 });
      vi.stubGlobal("visualViewport", {
        scale: 1,
        offsetLeft: 0,
        offsetTop: 30,
      });
      expect(
        decode({ action: "click", ref: ref("Save"), pointer: true }).method,
      ).toBe("element");
      vi.stubGlobal("visualViewport", {
        scale: 1,
        offsetLeft: 0,
        offsetTop: 0,
      });
      expect(
        decode({ action: "click", ref: ref("Save"), pointer: true }).method,
      ).toBe("pointer");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

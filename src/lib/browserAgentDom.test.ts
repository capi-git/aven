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
});

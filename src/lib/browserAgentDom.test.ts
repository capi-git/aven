// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import script from "../../src-tauri/src/browser_agent_dom.js?raw";

type Snapshot = { elements: { ref: string; label: string; value?: string; type?: string }[]; text: string };
const evaluate = new Function(`return (${script})`)() as (request: Record<string, string>) => string;
function operate(request: Record<string, string>): string {
  const result = evaluate(request);
  const decoded = JSON.parse(result);
  if (typeof decoded.__supermonoAgentError === "string") throw new Error(decoded.__supermonoAgentError);
  return result;
}
const snapshot = (generation = "first"): Snapshot => JSON.parse(operate({ action: "snapshot", generation }));

describe("native agent browser fixed DOM actions", () => {
  beforeEach(() => {
    document.body.innerHTML = '<label for="name">Name</label><input id="name" value="before"><input type="password" aria-label="Secret" value="do-not-leak"><button>Save</button>';
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, width: 100, height: 20, top: 0, bottom: 20, left: 0, right: 100, toJSON() {} });
    vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ""; });

  it("returns actionable references without reading password values", () => {
    const state = snapshot();
    expect(state.elements.find(item => item.label === "Name")?.value).toBe("before");
    expect(state.elements.find(item => item.type === "password")?.value).toBeUndefined();
    expect(JSON.stringify(state)).not.toContain("do-not-leak");
  });

  it("fills the real input and dispatches changes, then clicks the referenced control", () => {
    const input = document.querySelector<HTMLInputElement>("#name")!;
    const button = document.querySelector("button")!;
    const inputChanged = vi.fn(); const clicked = vi.fn();
    input.addEventListener("input", inputChanged); button.addEventListener("click", clicked);
    const state = snapshot();
    operate({ action: "fill", ref: state.elements.find(item => item.label === "Name")!.ref, value: "after" });
    operate({ action: "click", ref: state.elements.find(item => item.label === "Save")!.ref });
    expect(input.value).toBe("after"); expect(inputChanged).toHaveBeenCalledOnce(); expect(clicked).toHaveBeenCalledOnce();
  });

  it("rejects previous generations and disconnected elements", () => {
    const old = snapshot().elements[0].ref;
    snapshot("second");
    expect(() => operate({ action: "fill", ref: old, value: "changed" })).toThrow("Stale reference");
    const state = snapshot("third"); document.querySelector("button")!.remove();
    expect(() => operate({ action: "click", ref: state.elements.find(item => item.label === "Save")!.ref })).toThrow("no longer visible");
  });

  it("rejects references when same-document navigation changes the URL", () => {
    const state = snapshot();
    history.pushState(null, "", "?agent-snapshot-navigation=1");
    expect(() => operate({ action: "click", ref: state.elements.find(item => item.label === "Save")!.ref })).toThrow("Stale reference");
  });

  it("rejects disabled and read-only controls without changing them", () => {
    document.querySelector<HTMLInputElement>("#name")!.readOnly = true;
    document.querySelector<HTMLButtonElement>("button")!.disabled = true;
    const state = snapshot();
    expect(() => operate({ action: "fill", ref: state.elements.find(item => item.label === "Name")!.ref, value: "changed" })).toThrow("read only");
    expect(() => operate({ action: "click", ref: state.elements.find(item => item.label === "Save")!.ref })).toThrow("disabled");
    expect(document.querySelector<HTMLInputElement>("#name")!.value).toBe("before");
  });

  it("returns bounded actionable errors through WebKit's JSON result", () => {
    const result = JSON.parse(evaluate({ action: "click", ref: "missing:1" }));
    expect(result.__supermonoAgentError).toContain("Stale reference");
    expect(result.__supermonoAgentError.length).toBeLessThanOrEqual(500);
  });

  it("treats input as text and never interprets it as JavaScript", () => {
    const payload = '<script>globalThis.compromised=true</script>";throw 1;//';
    const state = snapshot();
    operate({ action: "fill", ref: state.elements.find(item => item.label === "Name")!.ref, value: payload });
    expect(document.querySelector<HTMLInputElement>("#name")!.value).toBe(payload);
    expect((globalThis as unknown as { compromised?: boolean }).compromised).toBeUndefined();
  });
});

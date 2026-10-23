// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import script from "../../src-tauri/src/browser_agent_dom.js?raw";
import hoverReveal from "../../tests/fixtures/browser-agent/hover-reveal.html?raw";
import uploadPage from "../../tests/fixtures/browser-agent/upload.html?raw";

type Entry = {
  ref: string;
  tag: string;
  role?: string;
  label: string;
  type?: string;
  hidden?: boolean;
  popup?: string;
  expanded?: boolean;
  checked?: boolean | "mixed";
  selected?: boolean;
  multiple?: boolean;
  accept?: string;
  crossOrigin?: boolean;
};
type Request = Record<string, unknown>;
const evaluate = new Function(`return (${script})`)() as (
  request: Request,
) => string;
function decode(request: Request) {
  const decoded = JSON.parse(evaluate(request));
  if (typeof decoded.__supermonoAgentError === "string")
    throw new Error(decoded.__supermonoAgentError);
  return decoded;
}
const snapshot = (): Entry[] =>
  decode({ action: "snapshot", generation: `g${Math.random()}` }).elements;
const find = (label: string) => {
  const entry = snapshot().find((item) => item.label === label);
  if (!entry) throw new Error(`No snapshot entry labelled ${label}`);
  return entry;
};
/** A fixture's markup and styles; its scripts stay inert here. */
function load(html: string) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  document.head.innerHTML = parsed.head.innerHTML;
  document.body.innerHTML = parsed.body.innerHTML;
}
/** An event as Chromium delivers the host's DevTools input: trusted. */
function trusted(target: Element, type: string) {
  const event = new Event(type, { bubbles: true, composed: true });
  Object.defineProperty(event, "isTrusted", { value: true });
  target.dispatchEvent(event);
}

describe("agent pointer actions and what snapshots list", () => {
  beforeEach(() => {
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
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("lists menus built from roles, their state, and controls made clickable with a pointer cursor", () => {
    document.body.innerHTML =
      '<div role="button" tabindex="0" aria-haspopup="menu" aria-expanded="false">Add</div>' +
      '<div role="menu"><div role="menuitem">Upload file</div>' +
      '<div role="menuitemcheckbox" aria-checked="true">Snap to grid</div></div>' +
      '<div role="option" aria-selected="true">Large</div>' +
      '<div id="card" style="cursor: pointer"><span style="cursor: pointer">Card title</span></div>' +
      '<button style="cursor: pointer"><span style="cursor: pointer">Inner</span></button>' +
      "<div>Plain text</div>";
    const entries = snapshot();
    const by = (label: string) =>
      entries.filter((item) => item.label === label);
    expect(by("Add")[0]).toMatchObject({ popup: "menu", expanded: false });
    expect(by("Upload file")[0]).toMatchObject({ role: "menuitem" });
    expect(by("Snap to grid")[0]).toMatchObject({ checked: true });
    expect(by("Large")[0]).toMatchObject({ role: "option", selected: true });
    // The outermost element with a pointer cursor, once; nothing inside a
    // control already listed; nothing plain.
    expect(by("Card title")).toHaveLength(1);
    expect(by("Card title")[0].tag).toBe("div");
    expect(by("Inner")).toHaveLength(1);
    expect(by("Inner")[0].tag).toBe("button");
    expect(by("Plain text")).toHaveLength(0);
  });

  it("keeps an open menu in the snapshot of a long page and says it was cut", () => {
    document.body.innerHTML =
      "<button>Layer</button>".repeat(450) +
      '<div role="menu"><div role="menuitem">Upload file</div></div>';
    const result = decode({ action: "snapshot", generation: "long" });
    expect(result.truncated).toBe(true);
    expect(result.note).toContain("open menus and dialogs come first");
    expect(
      result.elements.filter((item: Entry) => item.label === "Layer"),
    ).toHaveLength(400);
    expect(
      result.elements.find((item: Entry) => item.label === "Upload file"),
    ).toMatchObject({ role: "menuitem" });
    document.body.innerHTML = "<button>Only</button>";
    expect(
      decode({ action: "snapshot", generation: "short" }).truncated,
    ).toBeUndefined();
  });

  it("lists controls inside open shadow roots", () => {
    document.body.innerHTML = '<div id="host"></div>';
    const root = document
      .querySelector("#host")!
      .attachShadow({ mode: "open" });
    root.innerHTML = "<button>Publish</button>";
    expect(find("Publish").tag).toBe("button");
  });

  it("lists hover-revealed controls and hidden file inputs as hidden", () => {
    load(hoverReveal);
    expect(find("Delete llms.txt").hidden).toBe(true);
    expect(find("Delete robots.txt").hidden).toBe(true);
    load(uploadPage);
    const entries = snapshot();
    const logo = entries.find((item) => item.label.startsWith("Logo"))!;
    expect(logo).toMatchObject({
      type: "file",
      accept: ".png,.svg",
      multiple: false,
    });
    expect(logo.hidden).toBeUndefined();
    const hidden = entries.find((item) => item.type === "file" && item.hidden);
    expect(hidden).toMatchObject({ multiple: true });
    expect(entries.find((item) => item.label === "Add")!.tag).toBe("button");
  });

  it("sends file inputs to upload and describes them before the user is asked", () => {
    load(uploadPage);
    const logo = snapshot().find((item) => item.label.startsWith("Logo"))!;
    expect(() =>
      decode({ action: "click", ref: logo.ref, pointer: true }),
    ).toThrow("Use the upload action");
    expect(decode({ action: "upload-check", ref: logo.ref })).toMatchObject({
      fileInput: true,
      multiple: false,
      accept: ".png,.svg",
    });
    const add = find("Add");
    expect(decode({ action: "upload-check", ref: add.ref })).toMatchObject({
      fileInput: false,
      label: "Add",
    });
    // A hidden file input has nothing to aim at: it opens from a direct click.
    const hidden = snapshot().find(
      (item) => item.type === "file" && item.hidden,
    )!;
    const input = document.querySelector<HTMLInputElement>("#hidden")!;
    const opened = vi.spyOn(input, "click").mockImplementation(() => {});
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(
      function (this: HTMLElement) {
        const size = this === input ? 0 : 20;
        return {
          x: 0,
          y: 0,
          width: size * 5,
          height: size,
          top: 0,
          bottom: size,
          left: 0,
          right: size * 5,
          toJSON() {},
        };
      },
    );
    const result = decode({ action: "upload", ref: hidden.ref, pointer: true });
    expect(result.method).toBe("element");
    expect(result.reason).toContain("hidden file input");
    expect(opened).toHaveBeenCalledOnce();
  });

  it("aims at a part of the element that is not covered", () => {
    document.body.innerHTML = '<button>Save</button><div id="badge"></div>';
    const button = document.querySelector("button")!;
    const badge = document.querySelector("#badge")!;
    // A badge covers the button's centre and right; its left part is clear.
    vi.spyOn(document, "elementFromPoint").mockImplementation((x) =>
      x > 40 ? badge : button,
    );
    const save = find("Save").ref;
    const aimed = decode({ action: "click", ref: save, pointer: true });
    expect(aimed.method).toBe("pointer");
    expect(aimed.point.x).toBeLessThan(40);
    // The aimed point is kept while it still lands on the element.
    const confirmed = decode({
      action: "click",
      ref: save,
      pointer: true,
      phase: "confirm",
      point: aimed.point,
    });
    expect(confirmed.point).toEqual(aimed.point);
  });

  it("counts a hit on a control's label as reaching it", () => {
    document.body.innerHTML =
      '<label id="terms"><input type="checkbox" aria-label="Agree"> I agree</label>';
    const label = document.querySelector("#terms")!;
    vi.spyOn(document, "elementFromPoint").mockReturnValue(label);
    const agree = find("Agree").ref;
    const result = decode({
      action: "click",
      ref: agree,
      pointer: true,
      phase: "confirm",
      point: { x: 50, y: 10 },
    });
    expect(result.method).toBe("pointer");
  });

  it("records the host's trusted press and reports whether it reached the element", () => {
    document.body.innerHTML =
      '<button>Save</button><div id="other">Other</div>';
    const button = document.querySelector("button")!;
    const other = document.querySelector("#other")!;
    vi.spyOn(document, "elementFromPoint").mockReturnValue(button);
    const save = find("Save").ref;
    const confirm = () =>
      decode({
        action: "click",
        ref: save,
        pointer: true,
        phase: "confirm",
        point: { x: 50, y: 10 },
      });
    const verify = () => decode({ action: "pointer-verify", ref: save });
    confirm();
    trusted(button, "pointerdown");
    trusted(button, "click");
    expect(verify()).toMatchObject({
      known: true,
      pressed: true,
      clicked: true,
      onTarget: true,
    });
    // Read once: a second verify knows nothing.
    expect(verify().known).toBe(false);
    // Something moved in between: the press landed elsewhere.
    confirm();
    trusted(other, "mousedown");
    expect(verify()).toMatchObject({
      pressed: true,
      onTarget: false,
      landedOn: 'div#other "Other"',
    });
    // A page's own synthetic events never count as the press.
    confirm();
    button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(verify()).toMatchObject({ known: true, pressed: false });
    // Another reference's verify does not consume this record.
    confirm();
    expect(decode({ action: "pointer-verify", ref: "other:1" }).known).toBe(
      false,
    );
    expect(verify().known).toBe(true);
  });

  it("hovers with a real pointer only, and says what covers the element", () => {
    document.body.innerHTML = '<button>Share</button><div id="toast"></div>';
    const button = document.querySelector("button")!;
    const hit = vi.spyOn(document, "elementFromPoint").mockReturnValue(button);
    const share = find("Share").ref;
    expect(() => decode({ action: "hover", ref: share })).toThrow(
      "real pointer",
    );
    const aimed = decode({ action: "hover", ref: share, pointer: true });
    expect(aimed).toMatchObject({ method: "pointer", point: { x: 50, y: 10 } });
    const confirm = () =>
      decode({
        action: "hover",
        ref: share,
        pointer: true,
        phase: "confirm",
        point: aimed.point,
      });
    expect(confirm()).toMatchObject({ method: "pointer", hovered: true });
    hit.mockReturnValue(document.querySelector("#toast"));
    expect(confirm()).toMatchObject({
      method: "pointer",
      hovered: false,
      coveredBy: "div#toast",
    });
    // Disabled controls can still be hovered (tooltips say why), not clicked.
    button.disabled = true;
    const disabled = find("Share").ref;
    expect(
      decode({ action: "hover", ref: disabled, pointer: true }).method,
    ).toBe("pointer");
    expect(() =>
      decode({ action: "click", ref: disabled, pointer: true }),
    ).toThrow("disabled");
  });

  it("lists another site's frame without its contents and refuses to click it", () => {
    document.body.innerHTML =
      '<iframe title="Payment"></iframe><button>Pay</button>';
    vi.spyOn(
      HTMLIFrameElement.prototype,
      "contentDocument",
      "get",
    ).mockReturnValue(null);
    const frame = find("Payment");
    expect(frame).toMatchObject({ tag: "iframe", crossOrigin: true });
    expect(() =>
      decode({ action: "click", ref: frame.ref, pointer: true }),
    ).toThrow("embedded frame from another site");
  });

  it("keeps the direct click for native pickers and says why", () => {
    document.body.innerHTML =
      '<select aria-label="Size"><option>S</option></select>';
    const select = document.querySelector("select")!;
    vi.spyOn(document, "elementFromPoint").mockReturnValue(select);
    const result = decode({
      action: "click",
      ref: find("Size").ref,
      pointer: true,
    });
    expect(result.method).toBe("element");
    expect(result.reason).toContain("use fill");
  });
});

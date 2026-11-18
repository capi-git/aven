// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../lib/session";

vi.mock("./AgentMarkdown", () => ({
  AgentMarkdown: ({ text }: { text: string }) =>
    createElement("div", null, text),
}));

import { AgentTranscript } from "./AgentTranscript";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const prompt: Block = { id: "user", role: "user", text: "Upgrade the indexer" };

function command(
  id: string,
  status: string,
  approval?: Block["approval"],
): Block {
  return {
    id,
    role: "tool",
    text: `npm run ${id}`,
    tool: { kind: "shell", status },
    ...(approval ? { approval } : {}),
  };
}

async function render(
  blocks: Block[],
  busy: boolean,
  onApproval?: (requestId: number, decision: string) => void,
) {
  await act(async () => {
    root.render(
      createElement(AgentTranscript, {
        blocks,
        busy,
        visible: true,
        onApproval,
      }),
    );
  });
}

const group = () =>
  container.querySelector<HTMLElement>(".personal-activity-phase")!;
const header = () =>
  group().querySelector<HTMLButtonElement>(":scope > button")!;
const steps = () => group().querySelectorAll(".personal-activity-step");

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.click();
  });
}

describe("a live work group", () => {
  const live = [
    prompt,
    command("build", "running"),
    command("test", "running"),
  ];

  it("stays folded to one line with a grey working orb", async () => {
    await render(live, true);
    expect(group().dataset.live).toBe("true");
    expect(header().getAttribute("aria-expanded")).toBe("false");
    expect(header().textContent).toContain("Running 2 commands");
    expect(
      group().querySelector(".zen-phase-body")!.getAttribute("data-open"),
    ).toBe("false");
    expect(steps()).toHaveLength(0);
    const orb = header().querySelector(".agent-mark.personal-activity-working");
    expect(orb).not.toBeNull();
    expect(orb!.getAttribute("data-agent")).toBe("working");
    // Grey: no project or role colour on it.
    expect(orb!.hasAttribute("data-tone")).toBe(false);
    // The orb carries the motion; the words stay still.
    expect(header().querySelector(".shimmer-text")).toBeNull();
  });

  it("opens and closes on a click, and keeps its live window", async () => {
    await render(live, true);
    await click(header());
    expect(header().getAttribute("aria-expanded")).toBe("true");
    expect(steps()).toHaveLength(2);
    expect(group().querySelector(".zen-phase-live")).not.toBeNull();
    await click(header());
    expect(header().getAttribute("aria-expanded")).toBe("false");
    expect(steps()).toHaveLength(0);
  });

  it("stays open once you opened it, after it settles", async () => {
    await render(live, true);
    await click(header());
    await render(
      [prompt, command("build", "completed"), command("test", "completed")],
      false,
    );
    expect(group().dataset.live).toBeUndefined();
    expect(header().textContent).toContain("Ran 2 commands");
    expect(header().getAttribute("aria-expanded")).toBe("true");
    expect(steps()).toHaveLength(2);
  });

  it("is held open by a step waiting on you, and the approval still works", async () => {
    const onApproval = vi.fn();
    await render(
      [
        prompt,
        command("build", "completed"),
        command("deploy", "pending", { requestId: 7 }),
      ],
      true,
      onApproval,
    );
    expect(header().getAttribute("aria-expanded")).toBe("true");
    const controls = group().querySelector("[data-approval-pending]");
    expect(controls).not.toBeNull();
    await click(controls!.querySelector("button")!);
    expect(onApproval).toHaveBeenCalledWith(7, "allow");
  });
});

describe("a settled work group", () => {
  const settled = [
    prompt,
    command("build", "completed"),
    command("test", "completed"),
  ];

  it("is folded behind its kind's icon and opens to the same quiet lines", async () => {
    await render(settled, false);
    expect(header().getAttribute("aria-expanded")).toBe("false");
    expect(header().querySelector(".agent-mark")).toBeNull();
    expect(header().textContent).toContain("Ran 2 commands");
    await click(header());
    expect(steps()).toHaveLength(2);
    expect(group().querySelector(".zen-phase-live")).toBeNull();
  });
});

describe("the work group's look", () => {
  const css = readFileSync("src/surfaces/AgentTranscript.css", "utf8");
  const rule = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    expect(start).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf("}", start));
  };

  it("draws no box around the group", () => {
    const box = rule(".personal-shell .personal-activity-phase");
    expect(box).toContain("padding: 0;");
    expect(box).toContain("border: 0;");
    expect(box).toContain("background: none;");
    expect(box).toContain("box-shadow: none;");
    expect(box).not.toMatch(/glass|radius/);
  });

  it("draws the working orb in the text colour, never a tint", () => {
    const orb = rule(".agent-mark.personal-activity-working");
    expect(orb).toContain("var(--color-content)");
    expect(orb).not.toMatch(/tint|accent/);
  });

  it("keeps the steps small, grey and close together", () => {
    expect(
      rule(".personal-shell .personal-activity-phase .personal-activity-step"),
    ).toContain("padding-block: 1px;");
    const text = css.slice(
      css.indexOf(".personal-activity-step\n  .font-mono"),
      css.indexOf("}", css.indexOf(".personal-activity-step\n  .font-mono")),
    );
    expect(text).toContain("font-size: var(--text-ui-label);");
    expect(text).toContain("var(--color-content) 45%");
  });
});

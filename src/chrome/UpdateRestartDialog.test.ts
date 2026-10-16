// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateRestartDialog } from "./UpdateRestartDialog";
import {
  NO_RESTART_WORK,
  requestRestartDecision,
  type RestartWork,
} from "../lib/updateRestartWork";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function button(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.textContent === label,
  );
}

const work: RestartWork = {
  agents: [
    { id: "a", title: "Fix login", project: "Aven", state: "working" },
    { id: "b", title: "Review PR", project: "Cadence", state: "working" },
  ],
  terminals: [{ id: "t", command: "npm" }],
  files: [],
};

/** Open the question; the returned promise settles with the answer. */
async function ask(value: RestartWork, now = false) {
  let answer!: Promise<string>;
  await act(async () => {
    root.render(createElement(UpdateRestartDialog));
    answer = requestRestartDecision(value, now);
  });
  // Wrapped so awaiting `ask` does not wait for the answer itself.
  return { answer };
}

describe("UpdateRestartDialog", () => {
  it("lists what is running and waits for it by default", async () => {
    const { answer } = await ask(work);
    const text = document.body.textContent ?? "";
    expect(text).toContain(
      "2 agents are working: Fix login (Aven) and Review PR (Cadence)",
    );
    expect(text).toContain("1 terminal is running npm");
    expect(text).toContain("The update stays downloaded either way.");
    expect(document.activeElement?.textContent).toBe(
      "Restart when they finish",
    );
    await act(async () => button("Restart when they finish")!.click());
    await expect(answer).resolves.toBe("wait");
    expect(document.body.textContent).not.toContain("agents are working");
  });

  it("offers stopping and cancelling", async () => {
    const { answer: stop } = await ask(work);
    await act(async () => button("Stop them and restart now")!.click());
    await expect(stop).resolves.toBe("stop");
    const { answer: cancel } = await ask(work);
    await act(async () => button("Cancel")!.click());
    await expect(cancel).resolves.toBe("cancel");
  });

  it("asks with stopping first from Restart now, keeping waiting as the safe focus", async () => {
    const { answer } = await ask(work, true);
    expect(button("Restart when they finish")).toBeUndefined();
    expect(document.activeElement?.textContent).toBe("Keep waiting");
    await act(async () => button("Keep waiting")!.click());
    await expect(answer).resolves.toBe("cancel");
  });

  it("warns that unsaved changes are lost when restarting now", async () => {
    const { answer } = await ask({
      ...NO_RESTART_WORK,
      files: [{ id: "f", name: "App.tsx", project: "Aven" }],
    });
    const text = document.body.textContent ?? "";
    expect(text).toContain("1 file has unsaved changes: App.tsx (Aven)");
    expect(text).toContain("Unsaved changes are lost if you restart now.");
    expect(button("Restart when saved")).toBeDefined();
    await act(async () => button("Restart now without saving")!.click());
    await expect(answer).resolves.toBe("stop");
  });
});

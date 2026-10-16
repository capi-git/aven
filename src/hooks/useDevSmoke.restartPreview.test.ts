// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveClaudeBinary: vi.fn(),
  finish: vi.fn(async () => {}),
}));

vi.mock("../lib/harness/child", () => ({
  resolveClaudeBinary: mocks.resolveClaudeBinary,
}));
vi.mock("../lib/devSmoke", async (original) => ({
  ...(await original<typeof import("../lib/devSmoke")>()),
  finishDevSmoke: mocks.finish,
}));

import type { SmokeStep } from "../lib/devSmoke";
import { runDevSmoke } from "./useDevSmoke";
import { UpdateRestartDialog } from "../chrome/UpdateRestartDialog";
import { previewUpdateRestart } from "../lib/updateRestartPreview";
import { getRestartDecision } from "../lib/updateRestartWork";

const config = { projectPath: "/tmp/check/project", binDir: "/tmp/check/bin" };
const STEP = "restart question lists running work (preview)";

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.finish.mockClear();
  // A real `claude` is never the stand-in: the steps that send are skipped.
  mocks.resolveClaudeBinary.mockResolvedValue({ path: "/usr/bin/claude" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(UpdateRestartDialog)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function harness(previewRestartQuestion?: () => boolean) {
  return {
    sessions: [],
    floatingSidebarLabel: null,
    expectFloatingSidebar: false,
    newProjectTask: vi.fn(),
    submit: vi.fn(),
    previewRestartQuestion,
  };
}

function reportedStep(): SmokeStep | undefined {
  const [steps] = mocks.finish.mock.calls.at(-1) as unknown as [SmokeStep[]];
  return steps.find((step) => step.name === STEP);
}

describe("the real-app check's restart question step", () => {
  it("opens the preview, finds every item and action, and closes it", async () => {
    await act(async () => {
      await runDevSmoke(config, () =>
        harness(() => previewUpdateRestart("question")),
      );
    });
    expect(reportedStep()).toEqual({
      name: STEP,
      passed: true,
      detail: "2 agents, 1 terminal, 1 unsaved file; 3 actions",
    });
    expect(getRestartDecision()).toBeNull();
    expect(document.body.textContent).not.toContain("Fix login");
  });

  it("fails when the preview does not open", async () => {
    await act(async () => {
      await runDevSmoke(config, () => harness(() => false));
    });
    expect(reportedStep()).toMatchObject({ passed: false });
  });

  it("is skipped where the workspace offers no preview", async () => {
    await act(async () => {
      await runDevSmoke(config, () => harness());
    });
    expect(reportedStep()).toBeUndefined();
  });
});

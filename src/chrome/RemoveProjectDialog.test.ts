// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoveProjectDialog } from "./RemoveProjectDialog";

const count = vi.hoisted(() => vi.fn());
vi.mock("../lib/projectData", () => ({ projectSessionCount: count }));

describe("project deletion confirmation", () => {
  let root: Root;
  let container: HTMLDivElement;
  const confirm = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    count.mockReset();
    confirm.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function render(path = "/project") {
    await act(async () =>
      root.render(
        createElement(RemoveProjectDialog, {
          name: "Project",
          path,
          onCancel: vi.fn(),
          onConfirm: confirm,
        }),
      ),
    );
  }

  function deleteButton() {
    return [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Delete",
    )!;
  }

  it("disables deletion until the count is known", async () => {
    let resolve!: (value: number) => void;
    count.mockReturnValue(
      new Promise<number>((done) => {
        resolve = done;
      }),
    );
    await render();
    expect(deleteButton().disabled).toBe(true);
    await act(async () => resolve(2));
    expect(deleteButton().disabled).toBe(false);
    expect(document.body.textContent).toContain(
      "2 saved conversations will be removed.",
    );
    await act(async () => deleteButton().click());
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("shows read failures instead of presenting an apparently empty project", async () => {
    count.mockRejectedValue(new Error("database unavailable"));
    await render();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not load",
    );
    expect(deleteButton().disabled).toBe(true);
    deleteButton().click();
    expect(confirm).not.toHaveBeenCalled();
  });
});

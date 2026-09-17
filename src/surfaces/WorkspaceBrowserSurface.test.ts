// @vitest-environment happy-dom
import {
  act,
  createElement,
  useState,
  type ComponentProps,
  type RefObject,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserPaneProps } from "./BrowserPane";
import {
  WorkspaceBrowserSurface,
  type BrowserSurfaceActions,
} from "./WorkspaceBrowserSurface";

const retainedRender = vi.hoisted(() => vi.fn());
vi.mock("./RetainedBrowserPane", () => ({
  RetainedBrowserPane: (props: BrowserPaneProps) => {
    retainedRender(props);
    return createElement(
      "div",
      { "data-retained-visible": props.visible },
      "Retained page",
    );
  },
}));

function freshActions(): BrowserSurfaceActions {
  return {
    focus: vi.fn(),
    close: vi.fn(),
    expand: vi.fn(),
    update: vi.fn(),
    addToChat: vi.fn(),
  };
}

describe("workspace browser surface memo boundary", () => {
  let root: Root;
  let container: HTMLDivElement;
  let props: ComponentProps<typeof WorkspaceBrowserSurface>;
  let actions: RefObject<BrowserSurfaceActions>;
  let generations: BrowserSurfaceActions[];

  function Parent({
    surface,
  }: {
    surface: ComponentProps<typeof WorkspaceBrowserSurface>;
  }) {
    const [revision, setRevision] = useState(0);
    actions.current = generations[revision];
    return createElement(
      "section",
      null,
      createElement(
        "button",
        { onClick: () => setRevision((value) => value + 1) },
        `Parent update ${revision}`,
      ),
      createElement(WorkspaceBrowserSurface, surface),
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    generations = [freshActions(), freshActions(), freshActions()];
    actions = { current: generations[0] };
    props = {
      id: "browser-surface-1",
      project: "/projects/local-demo",
      tabId: "tab-1",
      url: "http://localhost:3000/preview",
      visible: true,
      expanded: false,
      actions,
    };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  async function render(patch: Partial<typeof props> = {}) {
    props = { ...props, ...patch };
    await act(async () =>
      root.render(createElement(Parent, { surface: props })),
    );
  }
  const latest = () => retainedRender.mock.lastCall![0] as BrowserPaneProps;
  const parentUpdate = () =>
    act(() => container.querySelector("button")!.click());

  it("skips retained-page renders for unrelated parent state and reads the newest actions through stable callbacks", async () => {
    await render();
    const first = latest();
    expect(retainedRender).toHaveBeenCalledOnce();
    parentUpdate();
    expect(container.querySelector("button")!.textContent).toBe(
      "Parent update 1",
    );
    expect(actions.current).toBe(generations[1]);
    expect(retainedRender).toHaveBeenCalledOnce();

    first.onFocus!();
    first.onClose!();
    first.onToggleExpand!();
    first.onUrlChange!("http://localhost:3000/next");
    first.onTitleChange!("Next page");
    first.onAddToChat!("Page context");
    expect(generations[1].focus).toHaveBeenCalledExactlyOnceWith(
      props.project,
      props.id,
    );
    expect(generations[1].close).toHaveBeenCalledExactlyOnceWith(
      props.project,
      props.id,
    );
    expect(generations[1].expand).toHaveBeenCalledExactlyOnceWith(props.id);
    expect(generations[1].update).toHaveBeenNthCalledWith(
      1,
      props.project,
      props.tabId,
      { url: "http://localhost:3000/next" },
    );
    expect(generations[1].update).toHaveBeenNthCalledWith(
      2,
      props.project,
      props.tabId,
      { title: "Next page" },
    );
    expect(generations[1].addToChat).toHaveBeenCalledExactlyOnceWith(
      "Page context",
    );
    const attachments = [
      {
        id: "element",
        name: "Selected element.png",
        kind: "image" as const,
        mimeType: "image/png",
        size: 8,
        data: "iVBORw0KGgo=",
      },
    ];
    first.onAddToChat!("", attachments);
    expect(generations[1].addToChat).toHaveBeenLastCalledWith("", attachments);
    Object.values(generations[0]).forEach((action) =>
      expect(action).not.toHaveBeenCalled(),
    );

    await render({ visible: false });
    const hidden = latest();
    for (const callback of [
      "onFocus",
      "onClose",
      "onToggleExpand",
      "onUrlChange",
      "onTitleChange",
      "onAddToChat",
    ] as const)
      expect(hidden[callback]).toBe(first[callback]);
    parentUpdate();
    expect(retainedRender).toHaveBeenCalledTimes(2);
    first.onFocus!();
    expect(generations[2].focus).toHaveBeenCalledExactlyOnceWith(
      props.project,
      props.id,
    );
  });

  it("forwards visibility and presentation changes while retaining the page node", async () => {
    await render({ visible: false });
    const node = container.querySelector("[data-retained-visible]");
    expect(latest()).toMatchObject({
      id: props.id,
      initialUrl: props.url,
      visible: false,
      expanded: false,
    });
    parentUpdate();
    expect(retainedRender).toHaveBeenCalledOnce();
    await render({ visible: true });
    expect(latest().visible).toBe(true);
    expect(retainedRender).toHaveBeenCalledTimes(2);
    await render({ expanded: true, url: "http://localhost:3000/changed" });
    expect(latest()).toMatchObject({
      visible: true,
      expanded: true,
      initialUrl: "http://localhost:3000/changed",
    });
    expect(retainedRender).toHaveBeenCalledTimes(3);
    expect(container.querySelector("[data-retained-visible]")).toBe(node);
    await render({ visible: false });
    expect(latest().visible).toBe(false);
    expect(retainedRender).toHaveBeenCalledTimes(4);
    expect(container.querySelector("[data-retained-visible]")).toBe(node);
  });
});

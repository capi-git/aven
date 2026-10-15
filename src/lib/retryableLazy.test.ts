// @vitest-environment happy-dom
import {
  act,
  createElement,
  Suspense,
  useEffect,
  useState,
  type ComponentType,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { retryableLazy } from "./retryableLazy";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function View({ text }: { text: string }) {
  return createElement("p", null, text);
}

function suspended(Lazy: ComponentType<{ text: string }>, text: string) {
  return createElement(
    Suspense,
    { fallback: createElement("span", null, "Loading") },
    createElement(Lazy, { text }),
  );
}

it("renders a preloaded view at once, without a loading state", async () => {
  const load = vi.fn(() => Promise.resolve(View));
  const Lazy = retryableLazy(load);
  await Lazy.preload();
  expect(load).toHaveBeenCalledTimes(1);

  // A synchronous render: a view that still had to load would suspend here.
  act(() => root.render(suspended(Lazy, "Settings")));
  expect(container.textContent).toBe("Settings");
  await Lazy.preload();
  expect(load).toHaveBeenCalledTimes(1);
});

it("keeps a failed preload quiet and loads again when shown", async () => {
  const load = vi
    .fn<() => Promise<typeof View>>()
    .mockRejectedValueOnce(new Error("Failed to fetch dynamically imported"))
    .mockResolvedValue(View);
  const Lazy = retryableLazy(load);
  await expect(Lazy.preload()).resolves.toBeUndefined();

  await act(async () => root.render(suspended(Lazy, "Search")));
  expect(load).toHaveBeenCalledTimes(2);
  expect(container.textContent).toBe("Search");
});

it("keeps a view mounted while it loaded when it renders again", async () => {
  let mounts = 0;
  function Counter({ text }: { text: string }) {
    const [count, setCount] = useState(0);
    useEffect(() => {
      mounts += 1;
    }, []);
    return createElement(
      "button",
      { onClick: () => setCount((value) => value + 1) },
      `${text} ${count}`,
    );
  }
  let resolve!: (view: typeof Counter) => void;
  const Lazy = retryableLazy(
    () => new Promise<typeof Counter>((done) => (resolve = done)),
  );

  await act(async () => root.render(suspended(Lazy, "Inbox")));
  expect(container.textContent).toBe("Loading");
  await act(async () => resolve(Counter));
  await act(async () => container.querySelector("button")!.click());
  expect(container.textContent).toBe("Inbox 1");

  // Now that the view has loaded, rendering again must not swap its type.
  await act(async () => root.render(suspended(Lazy, "Notes")));
  expect(container.textContent).toBe("Notes 1");
  expect(mounts).toBe(1);
});

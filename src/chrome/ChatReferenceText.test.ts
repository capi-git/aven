// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatReferenceText } from "./ChatReferenceText";
import { installInAppLinks } from "../lib/inAppLinks";

let root: Root;
let host: HTMLDivElement;
let dispose: () => void;
const openUrl = vi.fn();
const openFile = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  dispose = installInAppLinks({ openUrl, openFile }, vi.fn());
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  dispose();
  vi.unstubAllGlobals();
});

it("renders noninteractive draft highlights with identical text", async () => {
  const text = "Try  localhost:3000/test.\n[Plan](./plan.md)";
  await act(async () =>
    root.render(createElement(ChatReferenceText, { text, cwd: "/project" })),
  );
  expect(host.textContent).toBe(text);
  expect(host.querySelectorAll(".chat-reference")).toHaveLength(2);
  expect(host.querySelector("a,button,[tabindex]")).toBeNull();
});

it("routes sent web references through the existing document handler including middle clicks", async () => {
  await act(async () =>
    root.render(
      createElement(ChatReferenceText, {
        text: "See www.example.com.",
        interactive: true,
      }),
    ),
  );
  const anchor = host.querySelector("a")!;
  await act(async () => {
    anchor.click();
    anchor.dispatchEvent(
      new MouseEvent("auxclick", {
        button: 1,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(openUrl).toHaveBeenCalledTimes(2);
  expect(openUrl).toHaveBeenLastCalledWith("https://www.example.com/");
  expect(openFile).not.toHaveBeenCalled();
});

it("opens explicit document targets with line navigation without changing visible text", async () => {
  const text = "[Code](src/App.tsx:12)";
  await act(async () =>
    root.render(
      createElement(ChatReferenceText, {
        text,
        cwd: "/project",
        interactive: true,
      }),
    ),
  );
  await act(async () => host.querySelector("a")!.click());
  expect(host.textContent).toBe(text);
  expect(openFile).toHaveBeenCalledExactlyOnceWith("/project/src/App.tsx", {
    line: 12,
  });
  expect(openUrl).not.toHaveBeenCalled();
});

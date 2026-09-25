// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  AgentPageNotices,
  agentPageLabel,
  type AgentPageNotice,
} from "./AgentPageNotices";

const notice: AgentPageNotice = {
  id: "browser-1",
  project: "/tmp/site",
  projectName: "Site",
  surfaceId: "browser-1",
  tabId: "tab-1",
  sessionId: "session-1",
  harness: "claude",
  url: "http://localhost:3000/pricing",
};

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

it("names the agent, page and project, and offers Show and Dismiss", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onShow = vi.fn();
  const onDismiss = vi.fn();
  const root = createRoot(document.createElement("div"));
  await act(async () =>
    root.render(
      createElement(AgentPageNotices, { notices: [notice], onShow, onDismiss }),
    ),
  );
  const card = document.body.querySelector('[role="status"]')!;
  expect(card.textContent).toContain(
    "Claude Code opened localhost:3000 in Site",
  );
  const [show, dismiss] = card.querySelectorAll("button");
  await act(async () => show.click());
  expect(onShow).toHaveBeenCalledWith(notice);
  await act(async () => dismiss.click());
  expect(onDismiss).toHaveBeenCalledWith("browser-1");
  await act(async () => root.unmount());
});

it("renders nothing without notices and falls back to the raw address", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  await act(async () =>
    root.render(
      createElement(AgentPageNotices, {
        notices: [],
        onShow: vi.fn(),
        onDismiss: vi.fn(),
      }),
    ),
  );
  expect(document.body.querySelector('[role="status"]')).toBeNull();
  expect(agentPageLabel("not a url")).toBe("not a url");
  await act(async () => root.unmount());
});

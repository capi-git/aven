// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FORWARD_TO_CHAT_EVENT, type ForwardRequest } from "../lib/chatForward";
import {
  LiveSessionsContext,
  createLiveSessionStore,
} from "../lib/liveSessions";
import type { Session } from "../lib/session";
import type { SessionSummary } from "../lib/sessionStore";

const saved = vi.hoisted(() => ({
  resolve: (_rows: SessionSummary[]) => {},
}));

vi.mock("../lib/sessionStore", () => ({
  listSessionsByProject: () =>
    new Promise<SessionSummary[]>((resolve) => {
      saved.resolve = resolve;
    }),
}));

const { ForwardButton } = await import("./ForwardButton");

const PROJECT = "/Users/me/Developer/app";

const chat = (id: string, title: string, cwd: string) =>
  ({
    id,
    title,
    cwd,
    harness: "codex",
    blocks: [{ role: "user", text: "hi" }],
  }) as unknown as Session;

let root: Root;
let host: HTMLDivElement;
let forwarded: ForwardRequest[];
const onForward = (event: Event) =>
  forwarded.push((event as CustomEvent<ForwardRequest>).detail);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  forwarded = [];
  window.addEventListener(FORWARD_TO_CHAT_EVENT, onForward);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  window.removeEventListener(FORWARD_TO_CHAT_EVENT, onForward);
  vi.unstubAllGlobals();
});

it("forwards to the highlighted chat even after saved chats re-sort the list", async () => {
  const store = createLiveSessionStore([
    chat("from", "Source", PROJECT),
    chat("elsewhere", "Other project chat", "/Users/me/Developer/other"),
  ]);
  await act(async () =>
    root.render(
      createElement(
        LiveSessionsContext.Provider,
        { value: store },
        createElement(ForwardButton, {
          text: "A reply",
          fromSessionId: "from",
        }),
      ),
    ),
  );
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="Forward"]')!.click(),
  );
  const menu = document.querySelector<HTMLElement>("[data-forward-menu]")!;
  const key = (name: string) =>
    act(async () => {
      menu.dispatchEvent(
        new KeyboardEvent("keydown", { key: name, bubbles: true }),
      );
    });
  const highlighted = () =>
    menu.querySelector('[data-active="true"]')?.textContent;

  await key("ArrowDown");
  expect(highlighted()).toContain("Other project chat");

  // This project's saved chat arrives and sorts above the highlighted one.
  await act(async () =>
    saved.resolve([
      {
        id: "saved",
        title: "Saved here",
        cwd: PROJECT,
        harness: "codex",
        model: "gpt-5",
        runtimeMode: "full-access",
        createdAt: 1,
        updatedAt: 2,
      },
    ]),
  );
  expect(
    [...menu.querySelectorAll('[role="menuitem"]')].map((row) =>
      row.textContent?.trim(),
    ),
  ).toEqual(["New chat", "Saved here", expect.stringContaining("Other")]);
  expect(highlighted()).toContain("Other project chat");

  await key("Enter");
  expect(forwarded).toHaveLength(1);
  expect(forwarded[0].toSessionId).toBe("elsewhere");
});

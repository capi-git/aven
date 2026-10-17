// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentRoleId } from "../lib/agentRoles";
import { RolePicker } from "./AgentRoles";

let root: Root;
let host: HTMLDivElement;
const picked = vi.fn();

function Picker() {
  const [role, setRole] = useState<AgentRoleId | undefined>("reviewer");
  return createElement(RolePicker, {
    label: "Role",
    value: role,
    onChange: (next: AgentRoleId | undefined) => {
      picked(next);
      setRole(next);
    },
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  picked.mockReset();
  vi.unstubAllGlobals();
});

const choices = () => [
  ...host.querySelectorAll<HTMLButtonElement>("[data-role-choice]"),
];
const press = (key: string) =>
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true }),
    );
  });

it("is one Tab stop, and ← and → choose the role beside it", async () => {
  await act(async () => root.render(createElement(Picker)));
  expect(choices().map((choice) => choice.tabIndex)).toEqual([
    -1, 0, -1, -1, -1,
  ]);
  choices()[1].focus();
  press("ArrowRight");
  expect(picked).toHaveBeenLastCalledWith("tester");
  expect(document.activeElement?.getAttribute("data-role-choice")).toBe(
    "tester",
  );
  expect(choices()[2].getAttribute("aria-checked")).toBe("true");
  expect(choices()[2].tabIndex).toBe(0);
  press("ArrowLeft");
  press("ArrowLeft");
  expect(picked).toHaveBeenLastCalledWith(undefined);
  expect(document.activeElement?.getAttribute("data-role-choice")).toBe("none");
  // From the first choice, ← wraps to the last.
  press("ArrowLeft");
  expect(picked).toHaveBeenLastCalledWith("designer");
  // ↑ and ↓ are left to a menu around it.
  press("ArrowDown");
  expect(picked).toHaveBeenCalledTimes(4);
});

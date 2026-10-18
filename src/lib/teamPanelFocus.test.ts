// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { closeFocusedTeamPanel } from "./teamPanelFocus";

afterEach(() => {
  document.body.replaceChildren();
});

it("closes the floating panel the keyboard is in, and nothing else", () => {
  document.body.innerHTML = `
    <section data-team-panel="race:r1" tabindex="-1">
      <button data-team-close>Close</button>
      <textarea></textarea>
    </section>
    <textarea id="message-box"></textarea>`;
  const close = vi.fn();
  document.querySelector("[data-team-close]")!.addEventListener("click", close);
  // Focus in the chat's own message box: ⌘W is the pane's.
  document.querySelector<HTMLElement>("#message-box")!.focus();
  expect(closeFocusedTeamPanel()).toBe(false);
  expect(close).not.toHaveBeenCalled();
  // Focus anywhere in the panel: ⌘W closes the panel.
  document.querySelector<HTMLElement>("[data-team-panel] textarea")!.focus();
  expect(closeFocusedTeamPanel()).toBe(true);
  expect(close).toHaveBeenCalledOnce();
});

/** Keyboard commands must never edit panes underneath an owning overlay. */
export function hasWorkspaceOverlay(): boolean {
  return [
    ...document.querySelectorAll<HTMLElement>(
      '[role="dialog"][aria-modal="true"], [role="alertdialog"], [data-popover-side], [data-file-picker], [data-model-picker], [data-branch-picker], [data-skill-picker], [data-mention-picker]',
    ),
  ].some((element) => {
    for (
      let node: HTMLElement | null = element;
      node;
      node = node.parentElement
    ) {
      if (
        node.hidden ||
        node.inert ||
        node.getAttribute("aria-hidden") === "true"
      )
        return false;
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden")
        return false;
    }
    return true;
  });
}

export function workspaceShortcutDisposition(
  command: string,
  state: { overlay: boolean; utility: boolean; workspace: boolean },
): "run" | "dismiss-utility" | "block" {
  const paneCommand =
    /^(close|close-others|split-right|split-down|next|prev|activate-|focus-|prev-session|next-session|prev-project|next-project|archive-session)/.test(
      command,
    );
  const startsWork =
    /^(new|reopen|toggle-terminal)$/.test(command) ||
    command.startsWith("new-terminal");
  if (
    state.overlay &&
    (paneCommand || startsWork || command === "back" || command === "forward")
  )
    return "block";
  if (state.utility && command === "close") return "dismiss-utility";
  if (!state.workspace && paneCommand) return "block";
  return "run";
}

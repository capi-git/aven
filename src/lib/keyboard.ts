type ImeKeyboardEvent = Pick<KeyboardEvent, "isComposing" | "keyCode">;

export function isImeComposition(event: ImeKeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}

type MenuKeyEvent = Pick<KeyboardEvent, "key" | "preventDefault"> & {
  currentTarget: HTMLElement;
};

/** Arrow keys, Home and End move between a popover menu's controls. */
export function moveMenuFocus(event: MenuKeyEvent) {
  const key = event.key;
  if (
    key !== "ArrowDown" &&
    key !== "ArrowUp" &&
    key !== "Home" &&
    key !== "End"
  )
    return;
  const items = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(
      "button:not(:disabled), input:not(:disabled)",
    ),
  ];
  if (items.length === 0) return;
  event.preventDefault();
  const index = items.indexOf(document.activeElement as HTMLElement);
  const next =
    key === "Home"
      ? 0
      : key === "End"
        ? items.length - 1
        : key === "ArrowDown"
          ? (index + 1) % items.length
          : index <= 0
            ? items.length - 1
            : index - 1;
  items[next]?.focus();
}

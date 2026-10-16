/** True when the element's text is cut off with an ellipsis. */
export function isTextTruncated(element: Element | null | undefined): boolean {
  return (
    !!element &&
    element instanceof HTMLElement &&
    element.scrollWidth > element.clientWidth + 1
  );
}

/**
 * Gives a row its full name as a tooltip only while the name is cut off.
 * For rows whose tooltip React does not manage: call it as the pointer
 * enters, so it measures the width the row has now.
 */
export function syncTruncatedTitle(
  row: HTMLElement,
  selector = ".personal-task-title",
) {
  const label = row.querySelector<HTMLElement>(selector);
  const name = label?.textContent?.trim() ?? "";
  if (name && isTextTruncated(label)) {
    if (row.title !== name) row.title = name;
  } else if (row.hasAttribute("title")) {
    row.removeAttribute("title");
  }
}

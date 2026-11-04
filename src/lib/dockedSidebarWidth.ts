/**
 * A pinned sidebar's width, for the one row that lines up with it. On the root
 * it restyled the whole window at each step of a resize (52 ms beside a long
 * chat), so it goes only to that row, which may mount after the sidebar does.
 */
const PROPERTY = "--aven-sidebar-width";
let width: number | null = null;
let row: HTMLElement | null = null;

function write() {
  if (row && width !== null) row.style.setProperty(PROPERTY, `${width}px`);
}

export function publishDockedSidebarWidth(next: number) {
  width = next;
  write();
}

/** A ref for the row. */
export function attachDockedSidebarWidth(element: HTMLElement | null) {
  row = element;
  write();
}

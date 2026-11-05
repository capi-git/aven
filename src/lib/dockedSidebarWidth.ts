/**
 * The pinned sidebar's width, for the top row: its tabs start where the work
 * does. Written to the top row's own element, as the same property on the
 * document would restyle the whole window each time it changes.
 */
let width: number | null = null;
let navigation: HTMLElement | null = null;

function write() {
  if (navigation && width !== null)
    navigation.style.setProperty("--aven-sidebar-width", `${width}px`);
}

export function setDockedSidebarWidth(next: number) {
  width = next;
  write();
}

/** A ref for the top row's navigation, which may mount after the sidebar. */
export function setTopRowNavigation(node: HTMLElement | null) {
  navigation = node;
  write();
}

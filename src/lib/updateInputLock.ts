/** Block new edits synchronously before an update snapshots the workspace. */
export function lockUpdateInput(): () => void {
  if (typeof document === "undefined") return () => {};
  const root = document.getElementById("root");
  const wasInert = root?.hasAttribute("inert") ?? false;
  const previousFocus = document.activeElement;
  const overlay = document.createElement("div");
  overlay.className =
    "fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/60 p-6";
  overlay.dataset.updateInputLock = "true";
  const dialog = document.createElement("div");
  dialog.className =
    "flex max-w-sm flex-col items-center gap-3 rounded-2xl bg-background-base p-7 text-center text-content shadow-xl";
  dialog.tabIndex = -1;
  dialog.setAttribute("role", "alertdialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Saving and restarting…");
  dialog.setAttribute("aria-describedby", "aven-update-restart-detail");
  const spinner = document.createElement("span");
  spinner.className =
    "size-6 animate-spin rounded-full border-2 border-content/20 border-t-accent motion-reduce:animate-none";
  spinner.setAttribute("aria-hidden", "true");
  const title = document.createElement("p");
  title.className = "text-sm font-medium";
  title.textContent = "Saving and restarting…";
  const detail = document.createElement("p");
  detail.id = "aven-update-restart-detail";
  detail.className = "text-xs text-content/65";
  detail.textContent =
    "Aven is saving your workspace and installing the downloaded update.";
  dialog.append(spinner, title, detail);
  overlay.append(dialog);

  // Inert also removes the underlying controls from accessibility navigation.
  // Capture guards cover portaled composers/menus outside the React root.
  const block = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const events = [
    "keydown",
    "keyup",
    "beforeinput",
    "input",
    "paste",
    "cut",
    "drop",
    "pointerdown",
    "click",
    "dblclick",
    "contextmenu",
    "submit",
  ];
  for (const event of events) window.addEventListener(event, block, true);
  const keepFocus = (event: FocusEvent) => {
    if (event.target instanceof Node && !dialog.contains(event.target))
      dialog.focus();
  };
  window.addEventListener("focusin", keepFocus, true);
  root?.setAttribute("inert", "");
  document.body.append(overlay);
  dialog.focus();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const event of events) window.removeEventListener(event, block, true);
    window.removeEventListener("focusin", keepFocus, true);
    overlay.remove();
    if (!wasInert) root?.removeAttribute("inert");
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
      previousFocus.focus();
  };
}

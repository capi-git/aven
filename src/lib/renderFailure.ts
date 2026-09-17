/** A DOM fallback still works when React cannot render the workspace. */
export function showRenderFailure(
  root: HTMLElement,
  error: unknown,
  componentStack?: string | null,
): void {
  const document = root.ownerDocument;
  const panel = document.createElement("section");
  panel.setAttribute("role", "alert");
  panel.setAttribute("aria-labelledby", "render-failure-title");
  panel.dataset.renderFailure = "true";
  panel.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;overflow:auto;box-sizing:border-box;padding:24px;background:#151518;color:#f4f4f5;font:14px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;";

  const content = document.createElement("div");
  content.style.cssText = "width:100%;max-width:480px;min-width:0;";
  const title = document.createElement("h1");
  title.id = "render-failure-title";
  title.textContent = "Aven couldn’t display this workspace";
  title.style.cssText =
    "margin:0 0 10px;font-size:20px;font-weight:600;line-height:1.3;";
  const explanation = document.createElement("p");
  explanation.textContent =
    "Reload the interface to reopen your saved sessions.";
  explanation.style.cssText = "margin:0 0 20px;color:#b9b9c2;";

  const reload = document.createElement("button");
  reload.type = "button";
  reload.textContent = "Reload interface";
  reload.style.cssText =
    "all:revert;box-sizing:border-box;padding:9px 14px;border:1px solid #656571;border-radius:8px;background:#303038;color:#fff;font:inherit;cursor:pointer;outline-offset:3px;";
  reload.addEventListener("click", () =>
    document.defaultView?.location.reload(),
  );

  const details = document.createElement("details");
  details.style.cssText = "margin-top:22px;color:#b9b9c2;";
  const summary = document.createElement("summary");
  summary.textContent = "Error details";
  summary.style.cssText = "cursor:pointer;";
  const report = document.createElement("pre");
  let message: string;
  try {
    message = String(error);
  } catch {
    message = "Unknown rendering error";
  }
  let stack: string | undefined;
  try {
    stack = error instanceof Error ? error.stack : undefined;
  } catch {
    // A custom thrown error must not prevent the recovery controls appearing.
  }
  report.textContent = [message, stack, componentStack]
    .filter(Boolean)
    .join("\n\n");
  report.style.cssText =
    "max-height:35vh;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;border:1px solid #3b3b44;border-radius:8px;font:12px/1.5 ui-monospace,monospace;";
  details.append(summary, report);
  content.append(title, explanation, reload, details);
  panel.append(content);
  root.replaceChildren(panel);
  reload.focus({ preventScroll: true });
}

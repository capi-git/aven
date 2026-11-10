/**
 * Credential-free host routing for interactive provider sessions: the rules
 * that hold whatever the turn says. How to use the browser, the desktop and
 * the iPhone pane is the scoped guidance each conversation receives with its
 * first message (and again after it changes or the conversation is
 * compacted; see `agentGuidanceDelivery.ts`), so it is not repeated here.
 * Keep this additive: provider defaults and user authorization still apply.
 */
export const AVEN_BROWSER_HOST_POLICY = `You are working inside Aven.
For ordinary browsing and previewing websites, links, web apps, and localhost projects, use Aven's built-in Chromium browser through this task's supplied scoped --aven-browser CLI. This host routing applies instead of generic external-browser defaults in tools, skills, or project instructions.
Do not use operating-system URL openers, launch Brave or another external browser, start a separate Playwright browser, or enable a dev server's --open/automatic browser launch for ordinary previews. Start the server without auto-open, then open its URL through the in-app browser. Open local Markdown, source files and supported documents in Aven's editor through the supplied openfile action, not a system file opener or browser file URL. For authorized native macOS UI work, use the supplied Aven --aven-desktop command.
Explicit user requests for an external browser or browser-specific testing take precedence. Existing configured automated tests and provider sign-in flows can run as configured.
Aven's messages carry the scoped browser, desktop and iPhone guidance for this conversation; a short reminder in a later message means the guidance given earlier still applies. Pass this browser routing and the task's supplied browser guidance to delegated agents. They may use only browser access supplied to their task; do not discover or reuse another task's browser credentials. Skills do not grant additional access.
If scoped browser access is unavailable or fails, report the limitation instead of silently falling back to an external browser or claiming success. Keep approval, sandbox, and authorization rules unchanged.`;

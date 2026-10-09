# Sidebar material and browser resize follow-up

Status: source checks pass; native visual and drag verification pending. This
change has not been merged or released.

Base: Aven 0.1.129, `051362101cb21b6c707eff8be6552f5e73fee872`.

The floating macOS sidebar used a 94% opaque popup fill to avoid WebKit's
backdrop-filter repaint flicker. A sidebar color wash leaves that opaque base
in place, which separates the panel from a transparent workspace. The candidate
uses the same material as the window chrome and clips the covered HTML workspace
edge, matching the existing native browser edge clipping. The workspace keeps
its width, page viewport, scroll state and content. Light, opaque and reduced
transparency/contrast modes retain their existing fallback. Closing uncovers
the workspace in the same paint that dismisses the translucent panel.

BrowserPane's ResizeObserver/window-resize scheduling had a 100 ms fallback
when WebKit did not deliver its animation frame. The candidate bounds that
fallback to 16 ms. It remains event-driven, cancels the losing callback, and
retains the existing single in-flight layout request and latest-bounds behavior.
This is a demonstrated scheduling defect, not yet proof that it accounts for
all of the reported active-browser divider stutter.

Validation:

- The new deferred-frame resize test failed against the base: no native layout
  was delivered within 16 ms. It passes with the new deadline, checks repeated
  resize bounds and verifies there is no continuing idle work.
- Floating-sidebar clipping tests cover reveal/close, observer cleanup, width
  changes, initial reveal transforms and 80%, 100% and 125% interface zoom.
- Full web checks passed: 4,332 tests in 391 files, TypeScript, formatting and
  lint. Lint reports existing warnings. The production frontend build passed.
- No native source, dependencies, production state or Holo source was changed.
- The supplied Holo URL initially refused connections. Its existing local Vite
  preview was started on port 5178 and the medications page was inspected in
  the task-scoped Aven browser.
- A separate signed Aven Dev build launched. The desktop input tool refused an
  action when another application covered it; no input was sent. Further
  desktop input is on hold to avoid interrupting the user. Live sidebar
  appearance, contrast, hover/close behavior and before/after resize timing
  still need verification. Do not describe this as a measured smoothness fix.

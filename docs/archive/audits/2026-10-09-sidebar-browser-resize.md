# Sidebar material and browser resize follow-up

Pre-release audit: source checks and native sidebar visual checks pass.
Browser drag performance verification is still pending; the source-tested
resize deadline does not establish a measured end-to-end performance gain.

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
- A separate signed Aven Dev build launched. The initial desktop click was
  refused because another application covered the preview; no input was sent.
- The follow-up live check reproduced the opaque popped-out sidebar. WebKit
  returned false for both reduced-transparency values (`reduce` and
  `no-preference`), so gating the new material on `no-preference` skipped it.
  The material now applies by default with explicit supported accessibility
  overrides. The live page confirmed the old 94% opaque fill before the fix.
- Native screenshots and interaction checks verified pinned and popped-out
  navigation, popped-out Settings navigation, and closing without changing the
  chat width or leaving transcript text behind the sidebar. Settings was opened
  through the app menu because an existing invisible popup blocked the sidebar
  Settings button. That separate popup issue is not claimed fixed here.
- Focused browser/sidebar tests passed again after the compatibility fix
  (138 tests), followed by a successful production frontend build. A corrected
  fractional-CSS-zoom test also reproduced and fixed a reveal-offset error:
  transform translations must be converted to viewport pixels before subtracting
  them from the measured rectangle.
- The exact Holo medications workload is available in the task-scoped installed
  browser. Aven Dev's separate browser profile stops at the mock sign-in page.
  The 16 ms layout fallback is source-tested; no before/after live drag benchmark
  has established that this resolves all of the reported resize stutter.

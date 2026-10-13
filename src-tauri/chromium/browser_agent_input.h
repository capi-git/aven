#pragma once
#include <algorithm>
#include <cmath>

namespace supermono {

// An agent's fill or click focuses an element inside the page only. For a
// moment afterwards, Chromium's own requests to focus the browser view are
// refused so that never becomes an app-level focus change that takes the
// user's keyboard. Any focus the user asks for releases the guard at once.
class AgentFocusGuard {
 public:
  void Hold(double now, double seconds = 1.5) { until_ = std::max(until_, now + seconds); }
  void Release() { until_ = 0; }
  bool Active(double now) const { return now < until_; }
  // Whether to refuse Chromium's request to focus the browser view.
  bool Blocks(bool system_source, bool view_focused, double now) const {
    return system_source && !view_focused && Active(now);
  }

 private:
  double until_ = 0;
};

// A trusted pointer press only for a pane on screen at 100% page zoom, where
// the page's CSS pixels and the input coordinate space agree exactly. Hidden,
// occluded or zoomed panes keep element.click(). The DOM script separately
// refuses pinch-zoomed pages.
inline bool AgentPointerAllowed(bool pane_shown, bool zoom_pending, double zoom_factor) {
  return pane_shown && !zoom_pending && std::isfinite(zoom_factor) &&
         std::abs(zoom_factor - 1) < 1e-6;
}

// What to do after a trusted press or typed text was sent. A failure that
// proves nothing reached the page may fall back to the DOM path; a timeout
// leaves the outcome unknown, so it is reported as unconfirmed and never
// repeated (a second click could submit twice).
enum class AgentInputOutcome { kDone, kFallBack, kUnconfirmed };
inline AgentInputOutcome AgentAfterInput(bool ok, bool timed_out) {
  if (ok) return AgentInputOutcome::kDone;
  return timed_out ? AgentInputOutcome::kUnconfirmed : AgentInputOutcome::kFallBack;
}

inline constexpr const char* kAgentClickUnconfirmed =
    "The click may have been applied, but the page did not confirm it in time. "
    "Take a snapshot before retrying.";
inline constexpr const char* kAgentFillUnconfirmed =
    "The text may have been entered, but the page did not confirm it in time. "
    "Take a snapshot before retrying.";

}  // namespace supermono

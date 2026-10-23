#pragma once
#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstddef>
#include <optional>
#include <set>
#include <string>
#include <vector>

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

// A trusted pointer (move, press, release) works in every pane: on screen or
// hidden, in any window, at any page zoom. DevTools input reaches the page
// itself, never the Mac's pointer. Only a zoom change still in flight is
// refused, because the scale its points are multiplied by is about to change.
inline bool AgentPointerAllowed(bool zoom_pending, double zoom_factor) {
  return !zoom_pending && std::isfinite(zoom_factor) && zoom_factor > 0;
}

// The DOM script reports points in visual-viewport CSS pixels. Chromium's
// DevTools input takes the widget's points: those times the page zoom (the
// per-tab zoom is an emulation scale; pinch zoom Chromium applies itself).
// Points outside the browser view are refused.
struct AgentInputPoint {
  double x = 0, y = 0;
};
inline std::optional<AgentInputPoint> AgentPointerPoint(double x, double y, double zoom,
                                                        double view_width, double view_height) {
  for (const double value : {x, y, zoom, view_width, view_height})
    if (!std::isfinite(value)) return std::nullopt;
  if (zoom <= 0 || view_width < 1 || view_height < 1 || x < 0 || y < 0) return std::nullopt;
  const AgentInputPoint point{x * zoom, y * zoom};
  if (point.x >= view_width + 1 || point.y >= view_height + 1) return std::nullopt;
  return point;
}

// Pauses of a careful mouse: after moving onto the element (menus and hover
// controls appear), before pressing, and while the button is down.
inline constexpr int kAgentHoverSettleMs = 60;
inline constexpr int kAgentPressDelayMs = 30;
inline constexpr int kAgentPressHoldMs = 40;

// What to do after a trusted press or typed text was sent. A failure that
// proves nothing reached the page may fall back to the DOM path; a timeout
// leaves the outcome unknown, so it is reported as unconfirmed and never
// repeated (a second click could submit twice).
enum class AgentInputOutcome { kDone, kFallBack, kUnconfirmed };
inline AgentInputOutcome AgentAfterInput(bool ok, bool timed_out) {
  if (ok) return AgentInputOutcome::kDone;
  return timed_out ? AgentInputOutcome::kUnconfirmed : AgentInputOutcome::kFallBack;
}

// After a pointer or key press was sent: release it unless the press provably
// never reached the page. A press whose reply timed out may be down, so it is
// released too (never left stuck) and reported as unconfirmed.
inline bool AgentNeedsRelease(bool pressed, bool timed_out) { return pressed || timed_out; }

inline constexpr const char* kAgentClickUnconfirmed =
    "The click may have been applied, but the page did not confirm it in time. "
    "Take a snapshot before retrying.";
inline constexpr const char* kAgentFillUnconfirmed =
    "The text may have been entered, but the page did not confirm it in time. "
    "Take a snapshot before retrying.";
inline constexpr const char* kAgentKeyUnconfirmed =
    "The key press may have been applied, but the page did not confirm it in time. "
    "Take a snapshot before retrying.";
inline constexpr const char* kAgentPointerNoReply =
    "The page did not answer the pointer in time, so nothing was pressed. "
    "Take a snapshot, then retry.";

// Keys an agent may press: DOM key, physical code, Windows key code and the
// text a key-down inserts (Enter and Space activate buttons and type).
struct AgentKey {
  const char* name;
  const char* key;
  const char* code;
  int key_code;
  const char* text;
};
inline const AgentKey* FindAgentKey(const std::string& name) {
  static const AgentKey keys[] = {
      {"Enter", "Enter", "Enter", 13, "\r"},
      {"Space", " ", "Space", 32, " "},
      {"Tab", "Tab", "Tab", 9, nullptr},
      {"Escape", "Escape", "Escape", 27, nullptr},
      {"Backspace", "Backspace", "Backspace", 8, nullptr},
      {"Delete", "Delete", "Delete", 46, nullptr},
      {"ArrowUp", "ArrowUp", "ArrowUp", 38, nullptr},
      {"ArrowDown", "ArrowDown", "ArrowDown", 40, nullptr},
      {"ArrowLeft", "ArrowLeft", "ArrowLeft", 37, nullptr},
      {"ArrowRight", "ArrowRight", "ArrowRight", 39, nullptr},
      {"Home", "Home", "Home", 36, nullptr},
      {"End", "End", "End", 35, nullptr},
      {"PageUp", "PageUp", "PageUp", 33, nullptr},
      {"PageDown", "PageDown", "PageDown", 34, nullptr},
  };
  for (const auto& entry : keys)
    if (name == entry.name) return &entry;
  return nullptr;
}

// Uploads. The user approves each one in Aven; the host then arms this tab's
// next file chooser, clicks, and answers only that chooser with the files.
inline constexpr std::size_t kAgentUploadMaxFiles = 10;
// A chooser may open a little after the click (a site can wait for a menu or
// a request first), within the user activation the click granted.
inline constexpr double kAgentUploadWaitSeconds = 5;

enum class AgentChooserMode { kOpen, kOpenMultiple, kFolder, kSave };
enum class AgentChooserAnswer {
  kLeaveToUser,  // Not armed, a popup window, or not an open-file chooser.
  kRefuseSite,   // The page left the site the user approved.
  kRefuseCount,  // Several files for a single-file chooser.
  kAnswer,       // Continue with the approved files.
};
// Decides one file chooser. Only an armed upload in the tab's own page
// (never a popup window) and only open-file choosers are ever answered; a
// folder or save dialog is always the user's.
inline AgentChooserAnswer DecideAgentChooser(bool armed, bool main_page, AgentChooserMode mode,
                                             std::size_t files, bool same_site) {
  if (!armed || !main_page) return AgentChooserAnswer::kLeaveToUser;
  if (mode != AgentChooserMode::kOpen && mode != AgentChooserMode::kOpenMultiple)
    return AgentChooserAnswer::kLeaveToUser;
  if (!same_site) return AgentChooserAnswer::kRefuseSite;
  if (files == 0 || files > kAgentUploadMaxFiles) return AgentChooserAnswer::kRefuseCount;
  if (mode == AgentChooserMode::kOpen && files != 1) return AgentChooserAnswer::kRefuseCount;
  return AgentChooserAnswer::kAnswer;
}

inline std::string AgentLower(std::string value) {
  for (auto& c : value) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return value;
}

// The page's host must still be the one the user approved (compared without
// case, a trailing dot or IPv6 brackets).
inline bool AgentUploadSameSite(const std::string& approved, const std::string& current) {
  const auto clean = [](std::string host) {
    host = AgentLower(host);
    if (host.size() >= 2 && host.front() == '[' && host.back() == ']') host = host.substr(1, host.size() - 2);
    if (!host.empty() && host.back() == '.') host.pop_back();
    return host;
  };
  return !approved.empty() && clean(approved) == clean(current);
}

// Names of files a chooser's accept list does not mention. Chromium does not
// enforce it for supplied files, so the agent is told rather than refused.
// Empty when a filter's extensions are unknown (for example "*/*").
inline std::vector<std::string> AgentUploadUnaccepted(const std::vector<std::string>& names,
                                                      const std::vector<std::string>& filters,
                                                      const std::vector<std::string>& extensions) {
  std::set<std::string> allowed;
  for (std::size_t i = 0; i < filters.size(); ++i) {
    const auto filter = AgentLower(filters[i]);
    if (!filter.empty() && filter[0] == '.') {
      allowed.insert(filter);
      continue;
    }
    const std::string expanded = i < extensions.size() ? AgentLower(extensions[i]) : "";
    if (expanded.empty()) return {};
    std::size_t start = 0;
    while (start < expanded.size()) {
      const auto end = std::min(expanded.find(';', start), expanded.size());
      if (end > start) allowed.insert(expanded.substr(start, end - start));
      start = end + 1;
    }
  }
  if (allowed.empty()) return {};
  std::vector<std::string> refused;
  for (const auto& name : names) {
    const auto dot = name.rfind('.');
    if (dot == std::string::npos || !allowed.count(AgentLower(name.substr(dot))))
      refused.push_back(name);
  }
  return refused;
}

}  // namespace supermono
